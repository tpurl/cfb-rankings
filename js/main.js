// Startup and event wiring. Loaded last, after every function it uses is defined.

const DEFAULT_KEY = ""; // each person enters their own free key
$("#key").value = store.get("cfbd-key") || DEFAULT_KEY;
$("#keyhint").hidden = !!$("#key").value;
$("#key").oninput = e => { $("#keyhint").hidden = !!e.target.value.trim(); };
$("#year").value = store.get("cfbd-year") || new Date().getFullYear();

$("#checkquota").onclick = checkQuota;
{ try{ const q=JSON.parse(store.get("cfbd-quota")); if(q) showQuota(q.n, q.at); }catch{} }

$("#load").onclick = () => load(false);
$("#refresh").onclick = () => load(true);
$("#save").onclick = () => {
  const y=$("#year").value, c=readCache(y); if(!c) return;
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(c.data,null,2)],{type:"application/json"}));
  a.download=`cfbd-rankings-${y}.json`; a.click(); URL.revokeObjectURL(a.href);
};

checkQuota(); // free call

// Show the saved season immediately on open, without spending calls.
{ const c=readCache($("#year").value); if(c) ingest(c.data, c.games, `Showing saved copy from ${fmtTime(c.fetchedAt)}.`); }

$("#file").onchange = async e => {
  const f=e.target.files[0]; if(!f) return;
  try{ ingest(JSON.parse(await f.text()), null); }
  catch{ setStatus("That file isn't a rankings JSON response from the API.", true); }
};

$("#poll").onchange = render;
$("#conf").onchange = () => { store.set("cfbd-conf", $("#conf").value); render(); };
$("#confsum").onclick = e => {
  const b=e.target.closest("button[data-conf]"); if(!b) return;
  $("#conf").value = $("#conf").value===b.dataset.conf ? "" : b.dataset.conf;
  $("#conf").onchange();
};
document.querySelectorAll(".seg button").forEach(b => b.onclick = () => {
  view=b.dataset.view;
  document.querySelectorAll(".seg button").forEach(x=>x.setAttribute("aria-pressed", x===b));
  render();
});

$("#out").addEventListener("click", e => { const b=e.target.closest("button.tl"); if(b) openTeam(b.dataset.team); });
$("#team-close").onclick = () => $("#team").close();
$("#team").addEventListener("click", e => { if(e.target.id==="team") $("#team").close(); });

document.addEventListener("click", e => { if(e.target.id==="loadsp") loadSP(); });

// Live updates: redraw only the list so the panel keeps its state.
document.addEventListener("input", e => {
  const k = e.target.dataset?.w; if(!k) return;
  W[k] = Number(e.target.value);
  const o = $("#o-"+k); o.textContent = W[k]; o.classList.toggle("chg", W[k]!==WEIGHT_DEFAULTS[k]);
  store.set("cfbd-weights", JSON.stringify(W));
  const poll=$("#poll").value, conf=$("#conf").value, p=project(poll);
  if(!p.msg){
    $("#projlist").innerHTML = projList(p, conf);
    const cnt=$("#projcnt"); if(cnt) cnt.textContent = `${conf}: ${p.list.filter(t=>t.conference===conf).length}`;
  }
  const n = Object.keys(W).filter(x=>W[x]!==WEIGHT_DEFAULTS[x]).length;
  $("#weights summary").textContent = `Adjust weights${n?` (${n} changed)`:""}`;
});
document.addEventListener("toggle", e => { if(e.target.id==="weights") weightsOpen = e.target.open; }, true);
document.addEventListener("click", e => {
  if(e.target.id!=="wreset") return;
  W = { ...WEIGHT_DEFAULTS }; store.set("cfbd-weights", JSON.stringify(W)); render();
});

document.addEventListener("click", e => { if(e.target.id==="updscores") updateScores(); });
