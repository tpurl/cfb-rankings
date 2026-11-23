// Team metrics shown next to each team: SP+, FPI, SOR, KPI-style resume, schedule strength, quality wins.
// SP+ and FPI (with ESPN's SOR and SOS ranks) come from CFBD's ratings endpoints, 1 call each,
// cached with the season. KPI-style, the fallback schedule strength and quality wins are computed
// here from the cached games, so they cost no calls.

let fpiData = null;              // { at, rows: { team: { fpi, rank, sor, sos } } }
let showMetrics = store.get("cfbd-metrics") !== "0";

// ---- Loading ----
// Status shows next to every ratings button, since the page-level status is usually out of view.
let spMsg = "", spErr = false;
function spSay(msg, err=false){
  spMsg = msg; spErr = err;
  document.querySelectorAll(".spstatus").forEach(el => { el.textContent = msg; el.classList.toggle("err", err); });
}

async function fetchRatings(base, key, year, path){
  const r = await fetch(`${base}/ratings/${path}?year=${year}`, { headers:{ Authorization:`Bearer ${key}`, Accept:"application/json" } });
  noteHeader(r);
  const name = path==="sp" ? "SP+" : "FPI";
  if(r.status===401 || r.status===403) throw new Error(`CFBD refused ${name} (${r.status}); your key's tier may not include it.`);
  if(r.status===429) throw new Error("CFBD says the monthly call limit is used up (429).");
  if(!r.ok) throw new Error(`CFBD returned ${r.status} for ${name}.`);
  const body = await r.json();
  return Array.isArray(body) ? body : [];
}

// Ratings change after each week's games. Re-fetch when missing, or when the saved copy predates
// a day after the latest poll release (CFBD posts new ratings around then), at most every 6 hours.
function ratingsStale(c, year){
  const ats = [c?.sp?.at, c?.fpi?.at].filter(Boolean);
  if(ats.length < 2) return true;
  if(Number(year) < currentSeason()) return false;
  const at = Math.min(...ats);
  return at < lastRelease().getTime() + 24*3600e3 && Date.now() - at > 6*3600e3;
}

async function loadRatings(auto=false){
  const key=$("#key").value.trim(), year=$("#year").value, base=$("#base").value.replace(/\/$/,"");
  const c = readCache(year);
  if(!key){ if(!auto) spSay("Add your API key at the top of the page first.", true); return; }
  if(!c){ if(!auto) spSay(`Load the ${year} season first. Ratings are saved alongside it.`, true); return; }
  if(auto && !ratingsStale(c, year)) return;
  document.querySelectorAll(".loadratings").forEach(b => b.disabled = true);
  spSay("Loading SP+ and FPI ratings…");
  const [sp, fpi] = await Promise.allSettled([ fetchRatings(base,key,year,"sp"), fetchRatings(base,key,year,"fpi") ]);
  const msgs = [], now = Date.now();
  if(sp.status==="fulfilled"){
    const ratings = {};
    for(const x of sp.value) if(typeof x.rating==="number" && x.team && x.team!=="nationalAverages") ratings[x.team]=x.rating;
    if(Object.keys(ratings).length){ c.sp = { at: now, ratings }; msgs.push(`SP+ for ${Object.keys(ratings).length} teams`); }
    else msgs.push("no SP+ ratings posted yet");
  } else msgs.push(sp.reason?.message || "SP+ failed");
  if(fpi.status==="fulfilled"){
    const rows = {};
    for(const x of fpi.value){
      if(!x.team || typeof x.fpi!=="number") continue;
      const rr = x.resumeRanks ?? x.resume_ranks ?? {};
      rows[x.team] = { fpi: x.fpi, rank: rr.fpi ?? null,
        sor: rr.strengthOfRecord ?? rr.strength_of_record ?? null,
        sos: rr.strengthOfSchedule ?? rr.strength_of_schedule ?? null };
    }
    if(Object.keys(rows).length){ c.fpi = { at: now, rows }; msgs.push(`FPI for ${Object.keys(rows).length} teams`); }
    else msgs.push("no FPI ratings posted yet");
  } else msgs.push(fpi.reason?.message || "FPI failed");
  store.set(cacheKey(year), JSON.stringify(c));
  spData = c.sp || null; fpiData = c.fpi || null;
  const failed = sp.status!=="fulfilled" || fpi.status!=="fulfilled";
  spSay(`Loaded ${msgs.join("; ")}.`.replace("Loaded no","No"), failed);
  document.querySelectorAll(".loadratings").forEach(b => b.disabled = false);
  checkQuota();
  render();
}

// ---- Computed metrics ----
let metricsMemo = null;
function teamMetrics(){
  const poll = $("#poll").value;
  const memoKey = [allGames, spData, fpiData, poll, releases];
  if(metricsMemo && metricsMemo.key.every((v,i)=>v===memoKey[i])) return metricsMemo.val;

  const played = (allGames||[]).filter(g => g.hp!=null && g.ap!=null && g.hp!==g.ap);
  const byTeam = {};
  for(const g of played){ (byTeam[g.h] ??= []).push(g); (byTeam[g.a] ??= []).push(g); }
  const won = (g,t) => (g.h===t) === (g.hp>g.ap);
  const opp = (g,t) => g.h===t ? g.a : g.h;

  // SP+ value and rank.
  const spRank = {};
  if(spData?.ratings) Object.entries(spData.ratings).sort((a,b)=>b[1]-a[1]).forEach(([t],i)=>spRank[t]=i+1);

  // Opponent quality in [0,1]: FPI rank percentile, else SP+ rank percentile, else win %.
  const fpiTeams = fpiData ? Object.keys(fpiData.rows) : [];
  const fpiRankOf = {};
  if(fpiData) fpiTeams.slice().sort((a,b)=>fpiData.rows[b].fpi-fpiData.rows[a].fpi).forEach((t,i)=>fpiRankOf[t]=i+1);
  const nF = fpiTeams.length, nS = Object.keys(spRank).length;
  const winPctExcl = (o, t) => {
    let w=0, l=0; for(const g of byTeam[o]||[]){ if(g.h===t || g.a===t) continue; won(g,o) ? w++ : l++; }
    return w+l ? w/(w+l) : 0.5;
  };
  const quality = (o, t) => {
    if(nF>1) return fpiRankOf[o] ? 1-(fpiRankOf[o]-1)/(nF-1) : 0;   // not rated = non-FBS
    if(nS>1) return spRank[o] ? 1-(spRank[o]-1)/(nS-1) : 0;
    return winPctExcl(o, t);
  };

  // Current poll for quality wins.
  const weeks = releases.filter(r=>r.polls[poll]?.length);
  const ranked = new Set((weeks[weeks.length-1]?.polls[poll]||[]).map(t=>t.school));

  // Who to rank among: FBS teams when ratings are loaded, otherwise every team with a game.
  const pool = nF ? fpiTeams : nS ? Object.keys(spRank) : Object.keys(byTeam);

  const kpi = {}, rpi = {}, qw = {};
  for(const t of pool){
    const gs = byTeam[t] || [];
    if(!gs.length) continue;
    // KPI-style: each game scored -1..+1 by result, opponent quality, site and margin; then averaged.
    let sum = 0, q = 0;
    for(const g of gs){
      const o = opp(g,t), oq = quality(o,t), m = Math.abs(g.hp-g.ap);
      const home = !g.n && g.h===t, road = !g.n && g.a===t;
      let v;
      if(won(g,t)) v = 0.4 + 0.5*oq + (road?0.05:home?-0.05:0) + 0.05*Math.min(m,21)/21;
      else         v = -1 + 0.9*oq + (road?0.05:home?-0.05:0) + (m<=3?0.05:0);
      sum += Math.max(-1, Math.min(1, v));
      if(won(g,t) && ranked.has(o)) q++;
    }
    kpi[t] = sum/gs.length;
    qw[t] = q;
    // RPI-style schedule strength: 2/3 opponents' win % (minus games vs t) + 1/3 opponents' opponents'.
    const owp = gs.reduce((a,g)=>a+winPctExcl(opp(g,t),t),0)/gs.length;
    const oowp = gs.reduce((a,g)=>{ const o=opp(g,t), og=byTeam[o]||[];
      return a + (og.length ? og.reduce((b,h)=>b+winPctExcl(opp(h,o),o),0)/og.length : 0.5); },0)/gs.length;
    rpi[t] = (2*owp + oowp)/3;
  }
  const rankOf = obj => { const r={}; Object.entries(obj).sort((a,b)=>b[1]-a[1]).forEach(([t],i)=>r[t]=i+1); return r; };
  const val = { spRank, kpi, kpiRank: rankOf(kpi), rpiRank: rankOf(rpi), qw };
  metricsMemo = { key: memoKey, val };
  return val;
}

// One compact line of metrics for a team; parts that aren't available are left out.
function metricsLine(team){
  if(!showMetrics || !allGames) return "";
  const m = teamMetrics(), parts = [];
  const sp = spData?.ratings?.[team];
  if(sp!=null) parts.push(`SP+ ${sp.toFixed(1)} <i>#${m.spRank[team]}</i>`);
  const f = fpiData?.rows?.[team];
  if(f){
    parts.push(`FPI ${f.fpi.toFixed(1)}${f.rank?` <i>#${f.rank}</i>`:""}`);
    if(f.sor) parts.push(`SOR <i>#${f.sor}</i>`);
  }
  if(m.kpi[team]!=null) parts.push(`KPI* ${m.kpi[team].toFixed(2)} <i>#${m.kpiRank[team]}</i>`);
  if(f?.sos) parts.push(`SOS <i>#${f.sos}</i>`);
  else if(m.rpiRank[team]) parts.push(`SOS* <i>#${m.rpiRank[team]}</i>`);
  if(m.qw[team]!=null) parts.push(`QW ${m.qw[team]}`);
  return parts.length ? `<span class="mx">${parts.map(x=>`<span>${x}</span>`).join(" · ")}</span>` : "";
}

// Legend above the views explaining the line, with a load button when ratings are missing.
function metricsLegend(poll){
  if(!showMetrics || !allGames) return "";
  const have = spData && fpiData;
  const asOf = have ? ` SP+ and FPI as of ${fmtTime(Math.min(spData.at, fpiData.at))}.` : "";
  const btn = `<button class="tool small loadratings">${have?"Reload":"Load"} SP+ and FPI (2 calls)</button>`;
  return `<div class="mlegend"><details><summary>What the metrics mean</summary>
    Season-to-date, on every view.${asOf} SOR and SOS are ESPN's ranks via FPI.
    KPI* is this page's estimate using the KPI method (official KPI has no public feed).
    SOS* is this page's schedule strength, used when FPI isn't loaded. QW = wins over teams in the current ${esc(poll)}.</details>
    ${btn}<span class="spstatus${spErr?" err":""}">${esc(spMsg)}</span></div>`;
}
