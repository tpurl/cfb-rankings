// Projection: adjustable weights, scoring model, SP+ ratings, and the Projection view.

// ---- Projection: next poll from games since the latest poll ----
// A transparent heuristic, not a vote model. Each ranked team's latest poll points are
// normalized to #1 = 1.0, then adjusted by this week's results using the weights below.
// Every weight is adjustable in the page and saved in localStorage.
const WEIGHT_DEFS = [
  { group: "Wins", items: [
    ["winBase",      "Bonus for any win",                              0.01,  0, 0.05, 0.005],
    ["winOppStr",    "Extra bonus × opponent strength",                0.05,  0, 0.30, 0.01],
    ["winMargin",    "Bonus per point of margin vs ranked opponent",   0,     0, 0.01, 0.0005],
    ["winMarginCap", "Margin cap for that bonus (points)",             21,    1, 50, 1],
    ["closeWinPen",  "Penalty for a close win over unranked",          0.015, 0, 0.08, 0.005],
    ["roadWin",      "Bonus for a road win (not neutral site)",        0,     0, 0.05, 0.005],
    ["closeWinPts",  "Close win means a margin of at most (points)",   7,     1, 21, 1],
  ]},
  { group: "Losses", items: [
    ["lossBase",     "Penalty for any loss",                           0.16,  0, 0.40, 0.01],
    ["lossOppRelief","Relief × strength of the team that won",         0.08,  0, 0.30, 0.01],
    ["lossUnranked", "Extra penalty for losing to an unranked team",   0.05,  0, 0.20, 0.01],
    ["blowoutPen",   "Extra penalty for a blowout loss",               0.04,  0, 0.20, 0.01],
    ["blowoutPts",   "Blowout means a margin of at least (points)",    21,    7, 50, 1],
    ["closeLossRel", "Relief for a close loss",                        0.02,  0, 0.10, 0.005],
    ["closeLossPts", "Close loss means a margin of at most (points)",  3,     1, 14, 1],
    ["homeLoss",     "Extra penalty for a home loss (not neutral site)", 0,   0, 0.05, 0.005],
  ]},
  { group: "Opponent strength", items: [
    ["unrankedStr",  "Strength of an unranked opponent",               0.15,  0, 0.5, 0.01],
    ["oppRecordWt",  "How much an unranked opponent's record moves that", 0.15, 0, 0.5, 0.01],
    ["spBlend",      "Use SP+ for opponent strength (0 = polls, 1 = SP+)", 0, 0, 1, 0.05],
  ]},
  { group: "Season resume", note: "These re-weigh the whole season, which voters already saw once. Useful for leaning toward how the CFP committee thinks.", items: [
    ["unbeatenBonus","Bonus for being unbeaten after this week",       0,     0, 0.15, 0.005],
    ["sosWt",        "Strength of schedule weight",                    0,     0, 0.5, 0.01],
    ["qualityWin",   "Bonus per win over a currently ranked team",     0,     0, 0.05, 0.005],
    ["badLoss",      "Penalty per loss to an unranked team",           0,     0, 0.10, 0.005],
  ]},
  { group: "Unranked teams and head-to-head", items: [
    ["upsetBase",    "Bonus when an unranked team beats a ranked one", 0.02,  0, 0.10, 0.005],
    ["upsetOppStr",  "Extra upset bonus × opponent strength",          0.15,  0, 0.50, 0.01],
    ["entryFactor",  "Unranked starting score, as a share of #25's",   0.6,   0, 1, 0.05],
    ["h2hWindow",    "Head-to-head winner jumps loser if within (spots)", 8,   0, 25, 1],
  ]},
];
const WEIGHT_DEFAULTS = Object.fromEntries(WEIGHT_DEFS.flatMap(g=>g.items.map(i=>[i[0], i[2]])));
let W = { ...WEIGHT_DEFAULTS };
try{ Object.assign(W, JSON.parse(store.get("cfbd-weights")) || {}); }catch{}
let weightsOpen = false;

// Win percentage from games before the projection week, for unranked-opponent strength.
function recordsBefore(week){
  const r = {};
  for(const g of allGames||[]){
    if(g.s!=="regular" || g.w>=week || g.hp==null || g.ap==null || g.hp===g.ap) continue;
    const [win,lose] = g.hp>g.ap ? [g.h,g.a] : [g.a,g.h];
    (r[win] ??= {w:0,l:0}).w++; (r[lose] ??= {w:0,l:0}).l++;
  }
  return r;
}

function project(poll){
  const reg = releases.filter(r=>r.polls[poll]?.length && r.type==="regular");
  const cur = reg[reg.length-1];
  if(!cur) return { msg: "No regular-season poll to project from yet." };
  if(releases.some(r=>r.type==="postseason" && r.polls[poll]?.length)) return { msg: "The final poll is out, so there's nothing left to project." };
  if(!allGames) return { msg: "Projection needs game results. Load the season from the API." };

  const ranks = cur.polls[poll];
  const hasPts = ranks.some(t=>t.points>0);
  const top = hasPts ? ranks[0].points : 25;
  const pre = Object.fromEntries(ranks.map(t=>[t.school, hasPts ? t.points/top : (26-t.rank)/25]));
  const curRank = Object.fromEntries(ranks.map(t=>[t.school, t.rank]));
  const conf = {}; ranks.forEach(t=>conf[t.school]=t.conference);
  const entry = pre[ranks[ranks.length-1].school]*W.entryFactor;
  const recs = recordsBefore(cur.week===1 ? 0 : cur.week);
  const pollStr = t => {
    if(pre[t]!=null) return pre[t];
    const r = recs[t], n = r ? r.w+r.l : 0;
    const pct = n ? r.w/n : 0.5;
    return Math.max(0, W.unrankedStr + W.oppRecordWt*(pct-0.5));
  };
  const sp = spStrength();
  const str = t => (W.spBlend>0 && sp && sp[t]!=null) ? (1-W.spBlend)*pollStr(t) + W.spBlend*sp[t] : pollStr(t);
  const recTxt = t => { const r=recs[t]; return pre[t]==null && r ? ` (${r.w}-${r.l})` : ""; };

  const games = allGames.filter(g => g.s==="regular" && g.w<=cur.week && (cur.week===1 || g.w>=cur.week)
                                    && (pre[g.h]!=null || pre[g.a]!=null));
  const delta={}, why={}, h2h=[]; let finals=0, pending=0;
  const note=(t,txt,cls)=>{ (why[t] ??= []).push({txt,cls}); };
  const rk = t => curRank[t] ? `#${curRank[t]} ` : "";

  for(const g of games){
    if(g.hp==null || g.ap==null){
      pending++;
      [g.h,g.a].forEach(t=>{ if(pre[t]!=null){ const o=t===g.h?g.a:g.h; note(t, `Not final: ${t===g.h?"vs":"at"} ${rk(o)}${o}`, ""); } });
      continue;
    }
    if(g.hp===g.ap) continue;
    finals++;
    const [Wn,L,wp,lp] = g.hp>g.ap ? [g.h,g.a,g.hp,g.ap] : [g.a,g.h,g.ap,g.hp];
    const m = wp-lp;
    let dw;
    if(pre[Wn]==null) dw = W.upsetBase + W.upsetOppStr*str(L);
    else {
      dw = W.winBase + W.winOppStr*str(L);
      if(pre[L]!=null) dw += W.winMargin*Math.min(m, W.winMarginCap);
      else if(m<=W.closeWinPts) dw -= W.closeWinPen;
    }
    const roadWin = !g.n && Wn===g.a, homeLoss = !g.n && L===g.h;
    if(roadWin) dw += W.roadWin;
    let dl = -(W.lossBase - W.lossOppRelief*str(Wn));
    if(pre[Wn]==null) dl -= W.lossUnranked;
    if(m>=W.blowoutPts) dl -= W.blowoutPen;
    if(m<=W.closeLossPts) dl += W.closeLossRel;
    if(homeLoss) dl -= W.homeLoss;

    delta[Wn]=(delta[Wn]||0)+dw; note(Wn, `Beat ${rk(L)}${L}${recTxt(L)} ${wp}-${lp}${roadWin?" (road)":""}`, "w");
    if(pre[L]!=null){ delta[L]=(delta[L]||0)+dl; note(L, `Lost to ${rk(Wn)}${Wn}${recTxt(Wn)} ${lp}-${wp}${homeLoss?" (home)":""}`, "l"); }
    if(pre[Wn]!=null && pre[L]!=null) h2h.push([Wn,L]);
    if(pre[Wn]==null && !conf[Wn]) conf[Wn] = Wn===g.h ? g.hc : g.ac;
  }
  const score = {};
  for(const t of new Set([...Object.keys(pre), ...Object.keys(delta)]))
    score[t] = (pre[t] ?? entry) + (delta[t]||0);
  ranks.forEach(t=>{ if(!why[t.school]) note(t.school, "Bye or no result yet", ""); });
  // Season resume, through this week's games (including ones just played).
  if(W.unbeatenBonus>0 || W.sosWt>0 || W.qualityWin>0 || W.badLoss>0){
    const thru = recordsBefore(cur.week+1);
    const played = allGames.filter(g => g.s==="regular" && g.w<=cur.week && g.hp!=null && g.ap!=null && g.hp!==g.ap);
    const opps = {};
    for(const g of played){ (opps[g.h] ??= []).push(g); (opps[g.a] ??= []).push(g); }
    const pct = r => r && (r.w+r.l) ? r.w/(r.w+r.l) : 0.5;
    // Opponent's win% with games against `t` removed (the RPI convention).
    const oppPctExcl = (o, t) => {
      let w=0, l=0;
      for(const g of opps[o]||[]){ if(g.h===t || g.a===t) continue; const won = (g.h===o) === (g.hp>g.ap); won ? w++ : l++; }
      return w+l ? w/(w+l) : 0.5;
    };
    const owp = t => { const gs=opps[t]||[]; if(!gs.length) return 0.5; return gs.reduce((a,g)=>a+oppPctExcl(g.h===t?g.a:g.h, t),0)/gs.length; };
    const oowp = t => { const gs=opps[t]||[]; if(!gs.length) return 0.5; return gs.reduce((a,g)=>{ const o=g.h===t?g.a:g.h; const og=opps[o]||[]; return a + (og.length ? og.reduce((b,h)=>b+pct(thru[h.h===o?h.a:h.h]),0)/og.length : 0.5); },0)/gs.length; };
    for(const t of Object.keys(score)){
      const r = thru[t];
      if(W.unbeatenBonus>0 && r && r.w>0 && r.l===0){ score[t] += W.unbeatenBonus; note(t, `Unbeaten (${r.w}-0) +${W.unbeatenBonus}`, "w"); }
      if(W.sosWt>0 && opps[t]){
        const sos = (2*owp(t) + oowp(t))/3, adj = W.sosWt*(sos-0.5);
        score[t] += adj; note(t, `Schedule strength ${sos.toFixed(3)} (${adj>=0?"+":""}${adj.toFixed(3)})`, adj>=0?"w":"l");
      }
      if((W.qualityWin>0 || W.badLoss>0) && opps[t]){
        let q=0, b=0;
        for(const g of opps[t]){ const won=(g.h===t)===(g.hp>g.ap), o=g.h===t?g.a:g.h; if(won && curRank[o]) q++; if(!won && !curRank[o]) b++; }
        if(W.qualityWin>0 && q){ score[t] += q*W.qualityWin; note(t, `${q} win${q>1?"s":""} over ranked teams (+${(q*W.qualityWin).toFixed(3)})`, "w"); }
        if(W.badLoss>0 && b){ score[t] -= b*W.badLoss; note(t, `${b} loss${b>1?"es":""} to unranked teams (-${(b*W.badLoss).toFixed(3)})`, "l"); }
      }
    }
  }
  for(const [Wn,L] of h2h)
    if(score[Wn] <= score[L] && Math.abs(curRank[Wn]-curRank[L]) <= W.h2hWindow) score[Wn] = score[L] + 0.001;

  const allConf = {}; releases.forEach(r=>Object.values(r.polls).flat().forEach(t=>allConf[t.school]=t.conference));
  const recNow = recordsBefore(cur.week+1); // record including this week's games
  const list = Object.entries(score).sort((a,b)=>b[1]-a[1]).slice(0,25)
    .map(([school,sc],i)=>({ school, rank:i+1, prev:curRank[school], score:sc, rec: `${recNow[school]?.w??0}-${recNow[school]?.l??0}`,
                             conference: conf[school] || allConf[school] || "", why: why[school]||[] }));
  const inSet = new Set(list.map(t=>t.school));
  const dropped = ranks.filter(t=>!inSet.has(t.school));
  return { cur, next: cur.week+1, list, dropped, finals, pending };
}

// SP+ ratings, normalized so the median team is 0 and the best team is 1.
function spStrength(){
  if(!spData?.ratings) return null;
  if(spData._norm) return spData._norm;
  const vals = Object.values(spData.ratings).sort((a,b)=>a-b);
  const med = vals[Math.floor(vals.length/2)], max = vals[vals.length-1];
  const n = {}; for(const [t,v] of Object.entries(spData.ratings)) n[t] = Math.max(0, Math.min(1, (v-med)/(max-med)));
  return spData._norm = n;
}
// Status for SP+ is shown next to its button, since the page-level status is usually scrolled out of view.
let spMsg = "", spErr = false;
function spSay(msg, err=false){
  spMsg = msg; spErr = err;
  const el = $("#spstatus"); if(el){ el.textContent = msg; el.classList.toggle("err", err); }
}
async function loadSP(){
  const key=$("#key").value.trim(), year=$("#year").value, base=$("#base").value.replace(/\/$/,"");
  if(!key){ spSay("Add your API key at the top of the page first.", true); return; }
  const c = readCache(year);
  if(!c){ spSay(`Load the ${year} season from the API first. SP+ is saved alongside it.`, true); return; }
  const btn = $("#loadsp"); if(btn) btn.disabled = true;
  spSay("Loading SP+ ratings…");
  try{
    const r = await fetch(`${base}/ratings/sp?year=${year}`, { headers:{ Authorization:`Bearer ${key}`, Accept:"application/json" } });
    noteHeader(r);
    if(r.status===401 || r.status===403) throw new Error(`CFBD refused SP+ (${r.status}). Your key's tier may not include ratings, or the key is wrong.`);
    if(r.status===429) throw new Error("CFBD says the monthly call limit is used up (429).");
    if(!r.ok) throw new Error(`CFBD returned ${r.status} for SP+ ratings.`);
    const body = await r.json();
    const ratings = {};
    for(const x of Array.isArray(body) ? body : []) if(typeof x.rating==="number" && x.team && x.team!=="nationalAverages") ratings[x.team]=x.rating;
    const n = Object.keys(ratings).length;
    if(!n) throw new Error(`CFBD returned no SP+ ratings for ${year} yet. Try again later in the week.`);
    c.sp = { at: Date.now(), ratings }; store.set(cacheKey(year), JSON.stringify(c));
    spData = c.sp; checkQuota();
    spSay(`Loaded SP+ for ${n} teams.`); render();
  }catch(e){
    spSay(e instanceof TypeError ? "The request was blocked before it reached CFBD (network or browser)." : e.message, true);
  }finally{ const b2=$("#loadsp"); if(b2) b2.disabled=false; }
}

function projList(p, conf){
  const items = p.list.map(t=>{
    let mv="", cls="";
    if(t.prev==null){ mv="New"; cls="new"; }
    else if(t.prev>t.rank){ mv=`▲${t.prev-t.rank}`; cls="up"; }
    else if(t.prev<t.rank){ mv=`▼${t.rank-t.prev}`; cls="down"; }
    const why = t.why.map(w=>`<span class="why ${w.cls}">${esc(w.txt)}</span>`).join("");
    return `<li${conf && t.conference===conf ? ' class="hl"' : ""}><span class="rk">${t.rank}</span><span><button class="tl" data-team="${esc(t.school)}">${esc(t.school)}</button> <span class="rec">${esc(t.rec)}</span> <span class="meta">${esc(t.conference)}, score ${t.score.toFixed(3)}</span>${why}</span><span class="mv ${cls}">${mv}</span></li>`;
  }).join("");
  const dropped = p.dropped.length ? `<p class="out">Projected to drop out: ${p.dropped.map(t=>`${esc(t.school)} (${t.rank})`).join(", ")}</p>` : "";
  return `<section class="week proj${conf?" hl-on":""}"><ol>${items}</ol>${dropped}</section>`;
}

function weightsPanel(){
  const changed = Object.keys(W).filter(k=>W[k]!==WEIGHT_DEFAULTS[k]).length;
  const spBase = spData ? `SP+ ratings for ${Object.keys(spData.ratings).length} teams, as of ${fmtTime(spData.at)}.`
                        : `SP+ isn't loaded, so that slider has no effect yet.`;
  const spLine = `<p class="wnote">${spBase} <button id="loadsp" class="tool small">${spData?"Reload":"Load"} SP+ (1 call)</button>
    <span id="spstatus" class="spstatus${spErr?" err":""}">${esc(spMsg)}</span></p>`;
  const groups = WEIGHT_DEFS.map(g=>`<fieldset><legend>${g.group}</legend>${g.note?`<p class="wnote">${g.note}</p>`:""}${g.group==="Opponent strength"?spLine:""}${g.items.map(([k,label,def,min,max,step])=>
    `<label class="wt"><span>${label}</span><input type="range" data-w="${k}" min="${min}" max="${max}" step="${step}" value="${W[k]}"><output id="o-${k}"${W[k]!==def?' class="chg"':""}>${W[k]}</output></label>`).join("")}</fieldset>`).join("");
  return `<details id="weights"${weightsOpen?" open":""}><summary>Adjust weights${changed?` (${changed} changed)`:""}</summary>
    <p class="wnote">Scores start at each team's share of #1's poll points (#1 = 1.000). These add to or subtract from that score. Changes apply instantly and are saved.</p>
    ${groups}<button id="wreset" class="tool">Reset to defaults</button></details>`;
}

function projView(poll, conf){
  const pendList = gamesPending(allGames, rawData) || [];
  const pend = pendList.length;
  const pendTxt = pendList.map(g=>`${g.a} at ${g.h}, kicked off ${fmtTime(Date.parse(g.d))}`).join("; ");
  const upd = pend > 0
    ? `<button id="updscores" class="tool" title="${esc(pendTxt)}">Update scores, ${pend} not final (2 calls)</button>`
    : `<button id="updscores" class="tool" disabled title="Every game that has started has a final score">All results in</button>`;
  const p = project(poll);
  if(p.msg) return `<div class="proj-head"><h2>Projection</h2>${allGames?upd:""}</div><p class="empty">${esc(p.msg)}</p>`;
  const c = readCache($("#year").value), at = c?.gamesAt ?? c?.fetchedAt;
  const status = p.finals
    ? `Based on ${p.finals} final game${p.finals>1?"s":""} involving ranked teams since the ${p.cur.label} poll${p.pending?`; ${p.pending} still in progress or upcoming`:""}. Scores as of ${at?fmtTime(at):"last load"}.`
    : `No games involving ranked teams have finished since the ${p.cur.label} poll${p.pending?` (${p.pending} upcoming)`:""}. Update scores after games end.`;
  const cnt = conf ? `<span class="cnt" id="projcnt">${esc(conf)}: ${p.list.filter(t=>t.conference===conf).length}</span>` : "";
  const pendLine = pend ? `<p>Waiting on: ${esc(pendTxt)}.</p>` : "";
  return `<div class="proj-head"><h2>Projected Wk ${p.next}${cnt}</h2>${upd}<p>${esc(status)} Unofficial estimate.</p>${pendLine}</div>
    ${weightsPanel()}
    <div id="projlist">${projList(p, conf)}</div>
    <p class="method">Real voters weigh things this can't see, like injuries and how a game looked, so treat it as a ballpark. Records next to each team include this week's games; records in the reason lines for unranked opponents are before this week.</p>`;
}
