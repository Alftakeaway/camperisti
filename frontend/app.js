const API = 'http://127.0.0.1:3001';
const REGIONS = ['campania','lazio','sardegna','sicilia'];
let DB = {}; let ITINS = [];
let curReg = 'campania';
let user = JSON.parse(localStorage.getItem('camperisti_user') || 'null');
let favs = JSON.parse(localStorage.getItem('camperisti_favs') || '{}'); // id -> nota
let trips = JSON.parse(localStorage.getItem('camperisti_trips') || '[]');

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function loadAll(){
  for (const r of REGIONS){
    try{
      let data = null;
      try{ const res = await fetch(API + '/api/areas?regione=' + r); if(res.ok) data = await res.json(); }catch(e){}
      if(!data){ const res2 = await fetch('data/' + r + '.json'); data = await res2.json(); }
      DB[r] = data;
    }catch(e){ DB[r] = []; }
  }
  try{ const ri = await fetch('data/itinerari.json'); ITINS = await ri.json(); }catch(e){ ITINS = []; }
  $('#statStrutture').textContent = REGIONS.reduce((a,r)=>a+(DB[r]?.length||0),0);
  $('#statItin').textContent = ITINS.length;
  buildMarquee(); render(); renderItins();
  if(user) syncFromBackend();
}
function allItems(){ return REGIONS.flatMap(r => (DB[r]||[]).map(x => ({...x, regione:r}))); }
function mapsUrl(it){ return `https://www.google.com/maps/search/?api=1&query=${it.lat},${it.lng}`; }

function render(){
  const q = ($('#q').value||'').toLowerCase();
  const tipo = $('#fTipo').value;
  const onlyF = $('#onlyFavs').checked;
  let items = (DB[curReg]||[]).map(x=>({...x,regione:curReg}));
  if(tipo) items = items.filter(i=>i.tipo===tipo);
  if(q) items = items.filter(i=>(i.nome+i.comune+i.indirizzo+(i.servizi||[]).join(' ')).toLowerCase().includes(q));
  if(onlyF) items = items.filter(i=>favs[i.id]);
  $('#count').textContent = `${items.length} strutture — ${curReg[0].toUpperCase()+curReg.slice(1)}`;
  $('#grid').innerHTML = items.map(card).join('') || '<p class="muted">Nessun risultato. Prova a cambiare filtro.</p>';
}
function card(it){
  const saved = favs[it.id] ? '♥' : '♡';
  return `<div class="card">
    <div><span class="badge ${it.tipo}">${esc(it.tipo.replace('_',' '))}</span><span class="muted small">${esc(it.regione)}</span></div>
    <h3>${esc(it.nome)}</h3>
    <p class="muted small">${esc(it.comune)} · ${esc(it.indirizzo||'')}</p>
    <div class="chips">${(it.servizi||[]).slice(0,6).map(s=>`<span>${esc(s)}</span>`).join('')}</div>
    <p><span class="price">${esc(it.prezzo||'n.d.')}</span> <span class="muted small">· verificato ${esc(it.verificato||'—')}</span></p>
    <div class="row">
      <button class="btn ghost" onclick="detail('${it.id}','${it.regione}')">Dettagli</button>
      <button class="btn ghost" onclick="toggleFav('${it.id}')">${saved}</button>
      <a class="btn ghost" target="_blank" href="${mapsUrl(it)}">Vai →</a>
    </div>
  </div>`;
}
window.detail = id => {
  const it = allItems().find(x=>x.id===id); if(!it) return;
  $('#sheet').innerHTML = `
    <h2>${esc(it.nome)}</h2>
    <p class="muted">${esc(it.comune)} · ${esc(it.indirizzo||'')} · ${esc(it.regione)}</p>
    <div class="chips">${(it.servizi||[]).map(s=>`<span>${esc(s)}</span>`).join('')}</div>
    <p>Prezzo: <b class="price">${esc(it.prezzo||'n.d.')}</b> · Verificato: ${esc(it.verificato||'—')}</p>
    <p>${esc(it.note||'')}</p>
    ${it.tel?`<p>Tel: <a href="tel:${esc(it.tel)}">${esc(it.tel)}</a></p>`:''}
    <label>La mia nota <textarea id="notaFav" placeholder="es. piazzola ombra, chiamare prima…">${esc(favs[it.id]||'')}</textarea></label>
    <div class="row">
      <button class="btn primary" onclick="saveNota('${it.id}')">Salva ♥</button>
      <a class="btn ghost" target="_blank" href="${mapsUrl(it)}">Naviga →</a>
      <a class="btn ghost" target="_blank" href="https://wa.me/?text=${encodeURIComponent('Segnalo errore scheda '+it.nome+' '+it.comune)}">Segnala errore</a>
      <button class="btn ghost" onclick="closeModal()">Chiudi</button>
    </div>`;
  $('#modal').classList.remove('hidden');
};
window.closeModal = () => $('#modal').classList.add('hidden');
$('#modal').addEventListener('click', e => { if(e.target.id==='modal') closeModal(); });

window.toggleFav = id => {
  if(favs[id]) delete favs[id]; else favs[id] = '';
  persist(); render(); renderDash();
  toast(favs[id]!==undefined ? 'Salvato ♥' : 'Rimosso');
};
window.saveNota = id => {
  favs[id] = $('#notaFav').value || '';
  persist(); renderDash(); toast('Nota salvata');
};
function persist(){
  localStorage.setItem('camperisti_favs', JSON.stringify(favs));
  localStorage.setItem('camperisti_trips', JSON.stringify(trips));
  if(user?.email){
    fetch(API+'/api/favorites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,favs})}).catch(()=>{});
    fetch(API+'/api/trips',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,trips})}).catch(()=>{});
  }
}
async function syncFromBackend(){
  if(!user?.email) return;
  try{
    const rf = await fetch(API+'/api/favorites?email='+encodeURIComponent(user.email));
    if(rf.ok){ const j = await rf.json(); if(j.favs && Object.keys(j.favs).length) { favs = j.favs; } }
    const rt = await fetch(API+'/api/trips?email='+encodeURIComponent(user.email));
    if(rt.ok){ const j = await rt.json(); if(j.trips && j.trips.length) { trips = j.trips; } }
    localStorage.setItem('camperisti_favs', JSON.stringify(favs));
    localStorage.setItem('camperisti_trips', JSON.stringify(trips));
    renderDash();
  }catch(e){}
}

// itinerari
function renderItins(){
  $('#itinGrid').innerHTML = ITINS.map(t=>`<div class="card">
    <span class="badge">${esc(t.regione)}</span>
    <h3>${esc(t.titolo)}</h3>
    <p class="muted small">${esc(t.tappe.join(' → '))}</p>
    <p class="small">≈ ${esc(t.km)} · ${esc(t.note||'')}</p>
    <div class="row"><button class="btn ghost" onclick="useItin('${t.id}')">Usa come viaggio</button></div>
  </div>`).join('');
}
window.useItin = id => {
  if(!user) return openAuth();
  const t = ITINS.find(x=>x.id===id);
  trips.push({name:t.titolo, notes:t.tappe.join('\n'), created:new Date().toISOString()});
  persist(); renderDash(); nav('dashboard'); toast('Itinerario copiato nei tuoi viaggi');
};

// dashboard
function renderDash(){
  const logged = !!user;
  $('#dashLock').classList.toggle('hidden', logged);
  $('#dashBody').classList.toggle('hidden', !logged);
  if(!logged) return;
  const items = allItems().filter(x=>favs[x.id]!==undefined);
  $('#favCount').textContent = `(${items.length})`;
  $('#favList').innerHTML = items.map(i=>`<div class="favrow"><b>${esc(i.nome)}</b><span class="muted small">${esc(i.comune)}</span><button class="btn ghost" onclick="toggleFav('${i.id}')">✕</button></div>`).join('') || '<p class="muted">Nessun salvato. Tocca ♡ sulle schede.</p>';
  $('#tripList').innerHTML = trips.map((t,ix)=>`<div class="favrow"><b>${esc(t.name)}</b><span class="muted small">${esc((t.notes||'').split('\n')[0]||'')}</span><button class="btn ghost" onclick="delTrip(${ix})">✕</button></div>`).join('') || '<p class="muted">Nessun viaggio. Crea o importa un itinerario.</p>';
}
window.delTrip = ix => { trips.splice(ix,1); persist(); renderDash(); };
$('#saveTrip').onclick = () => {
  if(!user) return openAuth();
  const n = $('#tripName').value.trim() || 'Viaggio senza nome';
  trips.push({name:n, notes:$('#tripNotes').value||'', favs:Object.keys(favs), created:new Date().toISOString()});
  $('#tripName').value=''; $('#tripNotes').value='';
  persist(); renderDash(); toast('Viaggio salvato');
};
$('#exportTxt').onclick = () => {
  const items = allItems().filter(x=>favs[x.id]!==undefined);
  const txt = `CAMPERISTI — ${new Date().toLocaleDateString('it-IT')}\n\nSALVATI:\n` + items.map(i=>`- ${i.nome} (${i.comune}) ${i.lat},${i.lng} [${(i.servizi||[]).join(', ')}] nota: ${favs[i.id]||''}`).join('\n') + `\n\nVIAGGI:\n` + trips.map(t=>`## ${t.name}\n${t.notes}`).join('\n');
  dl('camperisti.txt', txt, 'text/plain');
};
$('#exportGpx').onclick = () => {
  const items = allItems().filter(x=>favs[x.id]!==undefined);
  const wpts = items.map(i=>`<wpt lat="${i.lat}" lon="${i.lng}"><name>${esc(i.nome)}</name><desc>${esc(i.comune)}</desc></wpt>`).join('\n');
  dl('camperisti.gpx', `<?xml version="1.0"?><gpx version="1.1" creator="camperisti">${wpts}</gpx>`, 'application/gpx+xml');
};
function dl(name, text, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text],{type})); a.download = name; a.click();
}

// nav + filtri + marquee + reveal
function nav(v){
  document.querySelectorAll('.view').forEach(s=>s.classList.add('hidden'));
  $('#view-'+v).classList.remove('hidden');
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===v));
  if(v==='dashboard') renderDash();
}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>nav(b.dataset.nav));
document.querySelectorAll('#regionTabs button').forEach(b=>b.onclick=()=>{
  curReg=b.dataset.reg;
  document.querySelectorAll('#regionTabs button').forEach(x=>x.classList.toggle('active',x===b));
  render();
});
$('#q').oninput = render; $('#fTipo').onchange = render; $('#onlyFavs').onchange = render;
function buildMarquee(){
  const names = allItems().slice(0,30).map(i=>i.comune).filter(Boolean);
  $('#marqueeTrack').textContent = ' · '.repeat(2) + [...new Set(names)].join('  ·  ') + '  ·  ';
}

// auth
function openAuth(){ $('#authModal').classList.remove('hidden'); }
window.openAuth = openAuth;
$('#authBtn').onclick = openAuth;
$('#closeAuth').onclick = () => $('#authModal').classList.add('hidden');
$('#logoutBtn').onclick = () => { user=null; localStorage.removeItem('camperisti_user'); paintAuth(); renderDash(); };
async function authCall(mode){
  const email = $('#aEmail').value.trim().toLowerCase();
  const pass = $('#aPass').value; const nome = $('#aNome').value.trim();
  if(!email || !pass){ $('#authMsg').textContent = 'Inserisci email e password.'; return; }
  try{
    const r = await fetch(API + '/api/auth/' + mode, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,pass,nome})});
    const j = await r.json();
    if(!r.ok){ $('#authMsg').textContent = j.error || 'Errore'; return; }
    user = {email:j.email, nome:j.nome||nome||email, token:j.token};
  }catch(e){
    // fallback locale: nessun backend
    if(mode==='register' || !localStorage.getItem('camperisti_pw_'+email)){
      localStorage.setItem('camperisti_pw_'+email, pass);
      user = {email, nome:nome||email, token:'local'};
    } else if(localStorage.getItem('camperisti_pw_'+email)===pass){
      user = {email, nome:email, token:'local'};
    } else { $('#authMsg').textContent = 'Password errata (locale).'; return; }
  }
  localStorage.setItem('camperisti_user', JSON.stringify(user));
  $('#authModal').classList.add('hidden'); paintAuth(); renderDash(); syncFromBackend();
  toast('Ciao ' + (user.nome||'') + ' ✓');
}
$('#doLogin').onclick = () => authCall('login');
$('#doReg').onclick = () => authCall('register');
function paintAuth(){
  $('#userLabel').textContent = user ? user.nome || user.email : '';
  $('#userLabel').classList.toggle('hidden', !user);
  $('#authBtn').classList.toggle('hidden', !!user);
  $('#logoutBtn').classList.toggle('hidden', !user);
}

// extra: checklist + costi
const CHECKS = ['Acqua potabile piena','Scarico grigie/nere vuoto','Gas / bombole','Elettricità / cavo','Documenti + assicurazione','Farmaci + cane','Cibo base + torce','Gomme / ruotino / triangolo','Prenota area prima sera','Moneta / bancomat / offline mappe'];
let checks = JSON.parse(localStorage.getItem('camperisti_checks')||'[]');
function renderChecks(){
  $('#checklist').innerHTML = CHECKS.map((c,i)=>`<label class="favrow"><input type="checkbox" data-i="${i}" ${checks.includes(i)?'checked':''}> ${esc(c)}</label>`).join('');
  document.querySelectorAll('#checklist input').forEach(cb=>cb.onchange=()=>{
    const i = +cb.dataset.i;
    checks = cb.checked ? [...new Set([...checks,i])] : checks.filter(x=>x!==i);
    localStorage.setItem('camperisti_checks', JSON.stringify(checks));
  });
}
$('#resetCheck').onclick = () => { checks=[]; localStorage.removeItem('camperisti_checks'); renderChecks(); };
function calc(){ const t = (+$('#cNotti').value||0)*(+$('#cPrezzo').value||0)+(+$('#cFuel').value||0); $('#cTot').textContent = t.toFixed(0)+' €'; }
['cNotti','cPrezzo','cFuel'].forEach(id=>document.addEventListener('input',e=>{ if(e.target.id===id) calc(); }));

function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'),1800); }

paintAuth(); renderChecks(); calc(); loadAll();
