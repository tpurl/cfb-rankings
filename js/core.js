// Shared helpers and page state. Loaded first.

const $ = s => document.querySelector(s);
const store = {
  get(k){ try{ return localStorage.getItem(k) }catch{ return null } },
  set(k,v){ try{ localStorage.setItem(k,v) }catch{} }
};
let releases = [], view = "grid", allGames = null, rawData = null, spData = null;

function setStatus(msg, err=false){ const s=$("#status"); s.textContent=msg; s.className="status"+(err?" err":""); }
