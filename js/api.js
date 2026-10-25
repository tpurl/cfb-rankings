// CollegeFootballData access: quota, fetching, the per-season cache, and refresh rules.

// ---- Call quota ----
// Every CFBD response carries X-CallLimit-Remaining (readable only if CFBD exposes it to
// browsers), and GET /info returns remainingCalls without counting against the limit.
let quotaFromBatch = null;
function showQuota(n, at=Date.now()){
  if(n==null || isNaN(n)) return;
  store.set("cfbd-quota", JSON.stringify({n, at}));
  const el=$("#quota");
  el.textContent = `Calls left this month: ${Number(n).toLocaleString()} (as of ${fmtTime(at)})`;
  el.parentElement.classList.toggle("low", n < 50);
}
function noteHeader(r){
  const v = r.headers.get("X-CallLimit-Remaining");
  if(v!=null && v!==""){ const n=parseInt(v,10); quotaFromBatch = quotaFromBatch==null ? n : Math.min(quotaFromBatch,n); }
}
async function checkQuota(){
  const key=$("#key").value.trim(), base=$("#base").value.replace(/\/$/,"");
  if(!key) return;
  try{
    const r = await fetch(`${base}/info`, { headers:{ Authorization:`Bearer ${key}`, Accept:"application/json" } });
    if(!r.ok) return;
    const j = await r.json();
    showQuota(j.remainingCalls ?? j.remaining_calls);
  }catch{}
}

// All games (played and upcoming), slimmed. Handles v2 camelCase and v1 snake_case.
async function getGames(base, key, year, type){
  const r = await fetch(`${base}/games?year=${year}&seasonType=${type}`,
    { headers:{ Authorization:`Bearer ${key}`, Accept:"application/json" } });
  noteHeader(r);
  if(!r.ok) throw new Error(`The API returned ${r.status} for ${type} games.`);
  return (await r.json()).map(g => ({
    s: g.seasonType ?? g.season_type, w: g.week,
    h: g.homeTeam ?? g.home_team, a: g.awayTeam ?? g.away_team,
    hp: g.homePoints ?? g.home_points, ap: g.awayPoints ?? g.away_points,
    c: (g.completed ?? false) && (g.homePoints ?? g.home_points) == null,
    d: g.startDate ?? g.start_date, n: g.neutralSite ?? g.neutral_site ?? false,
    nm: g.notes || "",
    hc: g.homeConference ?? g.home_conference ?? "", ac: g.awayConference ?? g.away_conference ?? ""
  }));
}

async function getType(base, key, year, type){
  const r = await fetch(`${base}/rankings?year=${year}&seasonType=${type}`,
    { headers:{ Authorization:`Bearer ${key}`, Accept:"application/json" } });
  noteHeader(r);
  if(!r.ok){
    const hint = r.status===401 ? " Check the API key." : r.status===429 ? " Rate limit reached; try again shortly." : "";
    throw new Error(`The API returned ${r.status} for ${type} season.${hint}`);
  }
  return r.json();
}

// ---- Cache: one entry per season, holding every week's polls ----
const cacheKey = y => `cfbd-rankings:${y}`;
function readCache(y){ try{ return JSON.parse(store.get(cacheKey(y))) }catch{ return null } }
// newest = latest poll week in the data; newWeekAt = when this page first saw that week.
function newestWeek(data){ return Math.max(0, ...(data||[]).map(d => (d.seasonType==="postseason" ? 100 : 0) + (d.week||0))); }
function writeCache(y,data,games,gamesAt=Date.now()){
  const prev = readCache(y), now = Date.now(), newest = newestWeek(data);
  const prevNewest = prev ? (prev.newest ?? newestWeek(prev.data)) : -1;
  const newWeekAt = newest > prevNewest ? now : (prev?.newWeekAt ?? prev?.fetchedAt ?? now);
  const sp = prev?.sp;
  store.set(cacheKey(y), JSON.stringify({ v: 2, fetchedAt: now, gamesAt, newest, newWeekAt, data, games, ...(sp?{sp}:{}) }));
}

// Football season year: Aug–Dec belongs to this year, Jan–Jul to last year.
function currentSeason(now=new Date()){ return now.getUTCMonth()>=6 ? now.getUTCFullYear() : now.getUTCFullYear()-1; }

// Most recent scheduled poll release before `now`, in UTC.
// AP/Coaches: Sunday 2 p.m. ET -> Sunday 18:00 UTC (an hour early in winter, which is harmless).
// CFP committee: Tuesday ~7 p.m. CT in Nov–Dec -> Wednesday 00:00 UTC.
function lastRelease(now=new Date()){
  const at = (daysBack, hour) => { const d=new Date(now); d.setUTCDate(d.getUTCDate()-daysBack); d.setUTCHours(hour,0,0,0); return d; };
  const back = (dow, hour) => { let n=(now.getUTCDay()-dow+7)%7, d=at(n,hour); if(d>now) d=at(n+7,hour); return d; };
  let t = back(0,18);
  const m = now.getUTCMonth();
  if(m===10 || m===11){ const cfp=back(3,0); if(cfp>t) t=cfp; }
  return t;
}

// Fresh if it's a finished season, or the page already has the poll released most
// recently (it first saw the newest week after that release). Once the release time
// passes, Load checks CFBD; if CFBD hasn't posted the new poll yet, it checks again
// on a later Load, at most once every 30 minutes.
const RETRY_MS = 30*60e3;
function isFresh(entry, year){
  if(!entry || !entry.games || entry.v!==2) return false;
  if(Number(year) < currentSeason()) return true;
  const rel = lastRelease().getTime();
  if((entry.newWeekAt ?? 0) >= rel) return true;
  return entry.fetchedAt >= rel && Date.now() - entry.fetchedAt < RETRY_MS;
}
function freshNote(entry){
  const rel = lastRelease().getTime();
  if((entry.newWeekAt ?? 0) >= rel || Number($("#year").value) < currentSeason())
    return `Showing saved copy from ${fmtTime(entry.fetchedAt)}. You have the latest poll, so no API calls were used.`;
  return `Checked CFBD at ${fmtTime(entry.fetchedAt)} and the new poll wasn't posted yet. Load will check again after ${fmtTime(entry.fetchedAt + RETRY_MS)}.`;
}

function fmtTime(ms){ return new Date(ms).toLocaleString([], {weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}); }

// Games that have kicked off but have no final score yet. Final scores never change,
// so if none are pending the saved results are complete and the games endpoint isn't called.
// Only games involving a team that has appeared in a poll this season count; the games
// feed covers every division, and small-school scores can lag or never arrive.
// Skipped: games CFBD marks completed without a score, and games 7+ days past kickoff
// (canceled or postponed).
function gamesPending(games, data, now=Date.now()){
  if(!games) return null;
  const polled = new Set((data||[]).flatMap(d=>(d.polls||[]).flatMap(p=>(p.ranks||[]).map(t=>t.school))));
  return games.filter(g => (g.hp==null || g.ap==null) && !g.c && g.d &&
    (polled.has(g.h) || polled.has(g.a)) &&
    Date.parse(g.d) <= now && now - Date.parse(g.d) < 7*864e5);
}
const needsScores = (games, data) => { const p=gamesPending(games, data); return p==null || p.length>0; };

async function load(force=false){
  const key=$("#key").value.trim(), year=$("#year").value, base=$("#base").value.replace(/\/$/,"");
  store.set("cfbd-year",year);
  const cached = readCache(year);

  if(!force && isFresh(cached, year)){
    ingest(cached.data, cached.games, freshNote(cached));
    return;
  }
  if(!key){ setStatus("Add a CollegeFootballData API key first. Keys are free at collegefootballdata.com/key.", true); return; }
  store.set("cfbd-key",key);
  quotaFromBatch = null;
  if(cached) ingest(cached.data, cached.games, `Showing saved copy from ${fmtTime(cached.fetchedAt)} while checking for a new week…`);
  else setStatus(`Loading ${year} rankings…`);

  try{
    const haveGames = cached?.v===2 && cached.games;
    const needGames = !haveGames || needsScores(cached.games, cached.data);
    const [reg, post, gReg, gPost] = await Promise.all([
      getType(base,key,year,"regular"),
      getType(base,key,year,"postseason").catch(()=>[]),
      needGames ? getGames(base,key,year,"regular").catch(()=>null) : null,
      needGames ? getGames(base,key,year,"postseason").catch(()=>[]) : []
    ]);
    const data=[...reg, ...post];
    const games = gReg ? [...gReg, ...gPost] : (haveGames ? cached.games : null);
    writeCache(year, data, games, gReg ? Date.now() : cached?.gamesAt);
    if(quotaFromBatch!=null) showQuota(quotaFromBatch);
    quotaFromBatch = null;
    checkQuota();
    const before = cached ? newestWeek(cached.data) : -1, after = newestWeek(data);
    const waiting = cached && after <= before && Date.now() >= lastRelease().getTime() && (cached.newWeekAt ?? 0) < lastRelease().getTime();
    ingest(data, games, after > before && cached ? `New poll release loaded and saved (${fmtTime(Date.now())}).`
      : waiting ? `CFBD hasn't posted this week's poll yet (checked ${fmtTime(Date.now())}). Try Load again in 30 minutes or so.`
      : `Loaded from the API and saved (${fmtTime(Date.now())}).`);
  }catch(e){
    const msg = e instanceof TypeError
      ? "The browser blocked the request before it reached the API. Serve this file from a local web server (for example `npx serve`) or open a saved JSON response instead."
      : e.message;
    setStatus(cached ? `${msg} Showing the saved copy from ${fmtTime(cached.fetchedAt)}.` : msg, true);
  }
}

// Re-fetch just the games (2 calls) so Saturday results show before Sunday's poll.
async function updateScores(){
  const key=$("#key").value.trim(), year=$("#year").value, base=$("#base").value.replace(/\/$/,"");
  const c = readCache(year);
  if(!key || !c) return;
  if(!needsScores(c.games, c.data)){
    setStatus(`All games that have kicked off are final as of ${fmtTime(c.gamesAt ?? c.fetchedAt)}. Using saved scores; no API calls were used.`);
    return;
  }
  setStatus("Updating scores…");
  quotaFromBatch = null;
  try{
    const [gReg, gPost] = await Promise.all([ getGames(base,key,year,"regular"), getGames(base,key,year,"postseason").catch(()=>[]) ]);
    c.games = [...gReg, ...gPost]; c.gamesAt = Date.now();
    store.set(cacheKey(year), JSON.stringify(c));
    if(quotaFromBatch!=null) showQuota(quotaFromBatch);
    checkQuota();
    ingest(c.data, c.games, `Scores updated ${fmtTime(c.gamesAt)}.`);
  }catch(e){ setStatus(e instanceof TypeError ? "The browser blocked the request before it reached the API." : e.message, true); }
}
