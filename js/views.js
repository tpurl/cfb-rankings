// Rendering: ingest, the Grid and Weeks views, conference summary, and the team panel.

function ingest(data, games, note){
  allGames = games; rawData = data;
  spData = readCache($("#year").value)?.sp || null;
  if(!Array.isArray(data) || !data.length){ setStatus("No rankings were returned for that season.", true); $("#out").innerHTML=""; $("#bar").hidden=true; return; }
  releases = data.map(d => ({
    type: d.seasonType, week: d.week,
    label: d.seasonType==="postseason" ? "Final" : `Wk ${d.week}`,
    polls: Object.fromEntries((d.polls||[]).map(p => [p.poll, (p.ranks||[]).slice().sort((a,b)=>a.rank-b.rank)]))
  })).sort((a,b)=> (a.type===b.type ? a.week-b.week : a.type==="postseason" ? 1 : -1));

  // Record as of each poll: a regular-season poll for week N counts games
  // before week N (the preseason poll is week 1); the final poll counts all games.
  releases.forEach(r => {
    r.rec = null;
    if(!games) return;
    const rec = {};
    const add = (t,win) => { const x = rec[t] ??= {w:0,l:0}; win ? x.w++ : x.l++; };
    games.filter(g => r.type==="postseason" || (r.week>1 && g.s==="regular" && g.w < r.week)).forEach(g => {
      if(g.hp==null || g.ap==null || g.hp===g.ap) return;
      add(g.h, g.hp>g.ap); add(g.a, g.ap>g.hp);
    });
    r.rec = rec;
  });

  const names = [...new Set(releases.flatMap(r=>Object.keys(r.polls)))];
  const pref = ["AP Top 25","Coaches Poll","Playoff Committee Rankings"];
  names.sort((a,b)=>((pref.indexOf(a)+1)||99)-((pref.indexOf(b)+1)||99));
  const sel=$("#poll"), prev=sel.value;
  sel.innerHTML = names.map(n=>`<option>${esc(n)}</option>`).join("");
  if(names.includes(prev)) sel.value=prev;
  const confs=[...new Set(releases.flatMap(r=>Object.values(r.polls).flat().map(t=>t.conference)).filter(Boolean))].sort();
  const csel=$("#conf"), cprev=csel.value || store.get("cfbd-conf") || "SEC";
  csel.innerHTML = `<option value="">No conference highlight</option>` + confs.map(c=>`<option>${esc(c)}</option>`).join("");
  csel.value = confs.includes(cprev) ? cprev : "";
  $("#bar").hidden=false;
  setStatus(`${data[0].season ?? ""} season, ${releases.length} poll releases. ${note || ""}`.trim());
  render();
}

function recStr(r, school){ const x = r.rec?.[school]; return r.rec ? `${x?.w??0}-${x?.l??0}` : ""; }

// ---- Team detail: losses and remaining schedule ----
function latestRanks(){
  const poll=$("#poll").value, weeks=releases.filter(r=>r.polls[poll]?.length);
  const w=weeks[weeks.length-1];
  return { label: w?.label, map: Object.fromEntries((w?.polls[poll]||[]).map(t=>[t.school,t.rank])) };
}
function wkLabel(g){ return g.s==="postseason" ? "Bowl" : `Wk ${g.w}`; }
function fmtDate(d){ return d ? new Date(d).toLocaleDateString([], {weekday:"short", month:"short", day:"numeric"}) : ""; }

function openTeam(school){
  $("#team-name").innerHTML = `${esc(school)}<span class="sub2"></span>`;
  const body=$("#team-body");
  if(!allGames){
    body.innerHTML = `<p class="none">Schedule data isn't available for this view. Load the season from the API to see losses and remaining games.</p>`;
    $("#team").showModal(); return;
  }
  const ranks=latestRanks().map;
  const opp = g => g.h===school ? g.a : g.h;
  const site = g => g.n ? "vs" : g.h===school ? "vs" : "at";
  const oppName = g => `${ranks[opp(g)] ? `<span class="orank">#${ranks[opp(g)]}</span>` : ""}${esc(opp(g))}`;
  const order = (a,b) => (a.s===b.s ? 0 : a.s==="postseason" ? 1 : -1) || (a.w-b.w) || String(a.d).localeCompare(String(b.d));
  const mine = allGames.filter(g=>g.h===school || g.a===school).sort(order);
  const played = mine.filter(g=>g.hp!=null && g.ap!=null);
  const us = g => g.h===school ? g.hp : g.ap, them = g => g.h===school ? g.ap : g.hp;
  const losses = played.filter(g=>us(g)<them(g));
  const wins = played.filter(g=>us(g)>them(g)).length;
  const remaining = mine.filter(g=>g.hp==null || g.ap==null);

  const rank = ranks[school] ? `#${ranks[school]}, ` : "";
  $("#team-name .sub2").textContent = `${rank}${wins}-${losses.length}`;

  const lossList = losses.length
    ? `<ul>${losses.map(g=>`<li><span class="wk">${wkLabel(g)}</span><span>${site(g)} ${oppName(g)}${g.nm?`<span class="note">${esc(g.nm)}</span>`:""}</span><span class="sc">L ${us(g)}-${them(g)}</span></li>`).join("")}</ul>`
    : `<p class="none">Undefeated so far.</p>`;
  const remList = remaining.length
    ? `<ul>${remaining.map(g=>`<li><span class="wk">${wkLabel(g)}</span><span>${site(g)} ${oppName(g)}${g.nm?`<span class="note">${esc(g.nm)}</span>`:""}</span><span class="wk">${fmtDate(g.d)}</span></li>`).join("")}</ul>`
    : `<p class="none">No games left on the schedule.</p>`;
  body.innerHTML = `<h3>Lost to</h3>${lossList}<h3>Remaining schedule</h3>${remList}`;
  $("#team").showModal();
}

function esc(s){ return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function render(){
  const poll=$("#poll").value;
  const weeks = releases.filter(r=>r.polls[poll]?.length);
  const conf=$("#conf").value;
  if(!weeks.length){ $("#confsum").innerHTML=""; $("#out").innerHTML=`<p class="empty">No releases for ${esc(poll)} yet this season.</p>`; return; }
  $("#confsum").innerHTML = confSummary(weeks[weeks.length-1], poll, conf);
  $("#out").innerHTML = view==="grid" ? grid(weeks,poll,conf) : view==="proj" ? projView(poll,conf) : weekCards(weeks,poll,conf);
}

// Ranked teams per conference in the latest release, most first. Click to highlight.
function confSummary(w, poll, conf){
  const counts={};
  w.polls[poll].forEach(t=>{ const c=t.conference||"Other"; counts[c]=(counts[c]||0)+1; });
  const chips=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .map(([c,n])=>`<button data-conf="${esc(c)}" aria-pressed="${c===conf}">${esc(c)}<b>${n}</b></button>`).join("");
  return `<span class="lead">${w.label}, teams ranked by conference:</span>${chips}`;
}

function grid(weeks,poll,conf){
  const teams = new Map();
  weeks.forEach((w,i)=> w.polls[poll].forEach(t=>{
    if(!teams.has(t.school)) teams.set(t.school,{school:t.school,conf:t.conference,ranks:Array(weeks.length).fill(null)});
    teams.get(t.school).ranks[i]=t.rank;
  }));
  const last=weeks.length-1;
  const rows=[...teams.values()].sort((a,b)=>{
    const la=a.ranks[last]??99, lb=b.ranks[last]??99;
    if(la!==lb) return la-lb;
    return Math.min(...a.ranks.map(r=>r??99)) - Math.min(...b.ranks.map(r=>r??99));
  });
  const head = `<tr><th class="team">Team</th>${weeks.map(w=>`<th>${w.label}</th>`).join("")}</tr>`;
  const body = rows.map(t=>`<tr${conf && t.conf===conf ? ' class="hl"' : ""}><td class="team"><button class="tl" data-team="${esc(t.school)}">${esc(t.school)}</button><small>${esc(recStr(weeks[last], t.school))}${weeks[last].rec ? ", " : ""}${esc(t.conf)}</small></td>${
    t.ranks.map(r=>{
      if(r==null) return `<td class="c"></td>`;
      const a=(1-(r-1)/25)*0.85+0.1;
      const light=a>0.5;
      return `<td class="c" style="background:rgba(var(--heat),${a.toFixed(2)});color:${light?"#F2F4EE":"inherit"}"><span>${r}</span></td>`;
    }).join("")}</tr>`).join("");
  const foot = conf ? `<tfoot><tr><td class="team">${esc(conf)} teams ranked</td>${
    weeks.map(w=>`<td class="c">${w.polls[poll].filter(t=>t.conference===conf).length}</td>`).join("")}</tr></tfoot>` : "";
  return `<div class="scroll"><table class="${conf?"hl-on":""}"><thead>${head}</thead><tbody>${body}</tbody>${foot}</table></div>`;
}

function weekCards(weeks,poll,conf){
  return `<div class="weeks">${weeks.slice().reverse().map(w=>{
    const i=weeks.indexOf(w), prev=i>0 ? weeks[i-1].polls[poll] : null;
    const prevRank = prev ? Object.fromEntries(prev.map(t=>[t.school,t.rank])) : {};
    const items = w.polls[poll].map(t=>{
      let mv="", cls="";
      if(prev){
        const p=prevRank[t.school];
        if(p==null){ mv="New"; cls="new"; }
        else if(p>t.rank){ mv=`▲${p-t.rank}`; cls="up"; }
        else if(p<t.rank){ mv=`▼${t.rank-p}`; cls="down"; }
      }
      const fp = t.firstPlaceVotes ? ` (${t.firstPlaceVotes})` : "";
      const pts = t.points ? `${t.points} pts${fp}` : "";
      return `<li${conf && t.conference===conf ? ' class="hl"' : ""}><span class="rk">${t.rank}</span><span><button class="tl" data-team="${esc(t.school)}">${esc(t.school)}</button> <span class="rec">${esc(recStr(w, t.school))}</span> <span class="meta">${esc(t.conference)}${pts?", "+pts:""}</span></span><span class="mv ${cls}">${mv}</span></li>`;
    }).join("");
    const now=new Set(w.polls[poll].map(t=>t.school));
    const dropped = prev ? prev.filter(t=>!now.has(t.school)).map(t=>`${esc(t.school)} (${t.rank})`) : [];
    const cnt = conf ? `<span class="cnt">${esc(conf)}: ${w.polls[poll].filter(t=>t.conference===conf).length}</span>` : "";
    return `<section class="week${conf?" hl-on":""}"><h2>${w.label}${cnt}</h2><ol>${items}</ol>${dropped.length?`<p class="out">Dropped out: ${dropped.join(", ")}</p>`:""}</section>`;
  }).join("")}</div>`;
}
