// Camperisti beta — frontend statico, zero dipendenze.
// Auth: ospite (nessuna password) | account dispositivo (demo locale) | account backend (token Bearer).
const REGIONS = ['campania', 'lazio', 'sardegna', 'sicilia'];
const QFILTERS = ['acqua', 'scarico', 'luce', 'docce', 'wifi', 'mare', 'pet', 'ombra', 'service'];
let DB = {}, ITINS = [];
let curReg = 'campania';
let qf = new Set();
let HAS_API = false;
let user = JSON.parse(localStorage.getItem('camperisti_user') || 'null');
let favs = JSON.parse(localStorage.getItem('camperisti_favs') || '{}');
let trips = JSON.parse(localStorage.getItem('camperisti_trips') || []);

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hasFav = id => Object.prototype.hasOwnProperty.call(favs, id);

// ---- API same-origin con timeout (niente più tentativi verso 127.0.0.1) ----
async function api(path, opts = {}, ms = 1800) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(path, { ...opts, signal: c.signal });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, err: 'offline' };
  } finally {
    clearTimeout(t);
  }
}
const authH = () => (user && user.token ? { 'Authorization': 'Bearer ' + user.token } : {});

async function detectApi() {
  const r = await api('/api/health');
  HAS_API = !!(r.ok && r.data && r.data.ok);
}

// ---- caricamento dati (parallelo, solo file statici) ----
async function loadAll() {
  const load = async r => {
    try {
      const res = await fetch('data/' + r + '.json');
      DB[r] = await res.json();
    } catch (e) { DB[r] = []; }
  };
  await Promise.all([...REGIONS.map(load),
    fetch('data/itinerari.json').then(r => r.json()).then(j => ITINS = j).catch(() => ITINS = [])]);
  $('#statStrutture').textContent = REGIONS.reduce((a, r) => a + (DB[r]?.length || 0), 0);
  $('#statItin').textContent = ITINS.length;
  buildMarquee();
  routeFromHash();
  render(); renderItins(); renderDash();
  detectApi().then(() => { if (user && user.token) syncFromBackend(); });
}

function allItems() { return REGIONS.flatMap(r => (DB[r] || []).map(x => ({ ...x, regione: r }))); }
const findItem = id => allItems().find(x => x.id === id);
const mapsUrl = it => `https://www.google.com/maps/search/?api=1&query=${it.lat},${it.lng}`;
const issueUrl = it => 'https://github.com/Alftakeaway/camperisti/issues/new?title='
  + encodeURIComponent(`Scheda da correggere: ${it.nome} (${it.id})`)
  + '&body=' + encodeURIComponent(`Comune: ${it.comune}\nScheda: ${it.id}\nProblema:\nDato corretto:`);

// ---- ricerca: con testo cerca in TUTTE le regioni, senza testo filtra per tab ----
function scopedItems() {
  const q = ($('#q').value || '').toLowerCase().trim();
  const tipo = $('#fTipo').value;
  const onlyF = $('#onlyFavs').checked;
  let pool = q ? allItems() : (DB[curReg] || []).map(x => ({ ...x, regione: curReg }));
  if (tipo) pool = pool.filter(i => i.tipo === tipo);
  if (qf.size) pool = pool.filter(i => [...qf].every(f => (i.servizi || []).includes(f)));
  if (q) pool = pool.filter(i => (i.nome + ' ' + i.comune + ' ' + (i.indirizzo || '') + ' ' + (i.servizi || []).join(' ')).toLowerCase().includes(q));
  if (onlyF) pool = pool.filter(i => hasFav(i.id));
  return { pool, q };
}

function statoBadge(it) {
  return it.stato === 'verificato'
    ? '<span class="badge ok">verificato</span>'
    : '<span class="badge warn">da riconfermare</span>';
}

function card(it) {
  const saved = hasFav(it.id);
  return `<article class="card">
    <div><span class="badge ${esc(it.tipo)}">${esc(String(it.tipo).replace('_', ' '))}</span>
    <span class="muted small">${esc(it.regione)}</span> ${statoBadge(it)}</div>
    <h3>${esc(it.nome)}</h3>
    <p class="muted small">${esc(it.comune)} · ${esc(it.indirizzo || '')}</p>
    <div class="chips">${(it.servizi || []).slice(0, 6).map(s => `<span>${esc(s)}</span>`).join('')}</div>
    <p><span class="price">${esc(it.prezzo || 'n.d.')}</span>
    <span class="muted small"> · controllo ${esc(it.verificato || '—')}${it.stagione ? ' · ' + esc(it.stagione) : ''}</span></p>
    <div class="row">
      <button class="btn ghost" data-act="detail" data-id="${esc(it.id)}">Dettagli</button>
      <button class="btn ghost" data-act="fav" data-id="${esc(it.id)}"
        aria-label="${saved ? 'Rimuovi dai preferiti: ' : 'Salva nei preferiti: '}${esc(it.nome)}"
        aria-pressed="${saved}">${saved ? '♥' : '♡'}</button>
      <a class="btn ghost" target="_blank" rel="noopener" href="${mapsUrl(it)}" aria-label="Naviga verso ${esc(it.nome)}">Vai →</a>
    </div>
  </article>`;
}

function render() {
  const { pool, q } = scopedItems();
  $('#count').textContent = q
    ? `${pool.length} risultati per “${q}” — in tutte le regioni`
    : `${pool.length} strutture — ${curReg[0].toUpperCase() + curReg.slice(1)}`;
  $('#grid').innerHTML = pool.map(card).join('') || '<p class="muted">Nessun risultato. Prova a cambiare regione o filtri.</p>';
}
$('#grid').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'fav') toggleFav(b.dataset.id);
  else openDetail(b.dataset.id);
});

// ---- dettaglio accessibile ----
let lastFocus = null;
function openDetail(id) {
  const it = findItem(id);
  if (!it) return;
  lastFocus = document.activeElement;
  const saved = hasFav(it.id);
  $('#sheet').innerHTML = `
    <h2 id="sheetTitle">${esc(it.nome)}</h2>
    <p class="muted">${esc(it.comune)} · ${esc(it.indirizzo || '')} · ${esc(it.regione)} ${statoBadge(it)}</p>
    <div class="chips">${(it.servizi || []).map(s => `<span>${esc(s)}</span>`).join('')}</div>
    <p>Prezzo: <b class="price">${esc(it.prezzo || 'n.d.')}</b></p>
    <p class="small muted">Stagione: ${esc(it.stagione || 'n.d.')} · Ultimo controllo: ${esc(it.verificato || '—')}</p>
    <p class="small muted">Fonte: ${esc(it.fonte || '—')}</p>
    <p>${esc(it.note || '')}</p>
    ${it.tel ? `<p>Tel: <a href="tel:${esc(it.tel)}">${esc(it.tel)}</a></p>` : '<p class="small muted">Telefono non in scheda — riconferma prima di partire.</p>'}
    <label for="notaFav">La mia nota</label>
    <textarea id="notaFav" placeholder="es. piazzola ombra, chiamare prima…">${esc(favs[it.id] || '')}</textarea>
    <div class="row">
      <button class="btn primary" data-d="save">${saved ? 'Aggiorna nota ♥' : 'Salva ♥'}</button>
      <a class="btn ghost" target="_blank" rel="noopener" href="${mapsUrl(it)}">Naviga →</a>
      <a class="btn ghost" target="_blank" rel="noopener" href="${issueUrl(it)}">Segnala errore</a>
      <button class="btn ghost" data-d="close">Chiudi</button>
    </div>`;
  $('#sheet').dataset.id = id;
  $('#modal').classList.remove('hidden');
  $('#sheet').querySelector('button, textarea, a').focus();
  if (location.hash !== '#/s/' + id) history.replaceState(null, '', '#/s/' + id);
}
$('#sheet').addEventListener('click', e => {
  const b = e.target.closest('[data-d]');
  if (!b) return;
  const id = $('#sheet').dataset.id;
  if (b.dataset.d === 'close') closeModal();
  if (b.dataset.d === 'save') {
    favs[id] = $('#notaFav').value || '';
    // normalizza: chiave presente = salvato (anche con nota vuota)
    persist();
    toast(whereSaved());
    openDetail(id);
    render(); renderDash();
  }
});
function closeModal() {
  $('#modal').classList.add('hidden');
  if (lastFocus && lastFocus.focus) lastFocus.focus();
  if (location.hash.startsWith('#/s/')) history.replaceState(null, '', '#/r/' + curReg);
}
window.closeModal = closeModal;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#modal').classList.contains('hidden')) closeModal();
    else if (!$('#authModal').classList.contains('hidden')) $('#authModal').classList.add('hidden');
  }
});

// ---- preferiti (coerenti: chiave presente = salvato) ----
function toggleFav(id) {
  if (hasFav(id)) delete favs[id]; else favs[id] = '';
  persist(); render(); renderDash();
  toast(hasFav(id) ? 'Salvato ♥ · ' + whereSaved() : 'Rimosso dai salvati');
}
function whereSaved() {
  if (user && user.token && HAS_API) return 'sincronizzato';
  if (user) return 'solo su questo dispositivo';
  return 'solo su questo dispositivo (accedi per sincronizzare)';
}
function persist() {
  localStorage.setItem('camperisti_favs', JSON.stringify(favs));
  localStorage.setItem('camperisti_trips', JSON.stringify(trips));
  if (user && user.token && HAS_API) {
    fetch('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authH() }, body: JSON.stringify({ favs }) }).catch(() => {});
    fetch('/api/trips', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authH() }, body: JSON.stringify({ trips }) }).catch(() => {});
  }
}
async function syncFromBackend() {
  if (!user || !user.token || !HAS_API) return;
  try {
    const rf = await api('/api/favorites', { headers: authH() });
    if (rf.ok && rf.data && rf.data.favs && Object.keys(rf.data.favs).length) favs = rf.data.favs;
    const rt = await api('/api/trips', { headers: authH() });
    if (rt.ok && rt.data && rt.data.trips && rt.data.trips.length) trips = rt.data.trips;
    localStorage.setItem('camperisti_favs', JSON.stringify(favs));
    localStorage.setItem('camperisti_trips', JSON.stringify(trips));
    renderDash();
  } catch (e) {}
}

// ---- itinerari: tappe ordinate, importabili ----
function renderItins() {
  $('#itinGrid').innerHTML = ITINS.map(t => `<article class="card">
    <span class="badge">${esc(t.regione)}</span>
    <h3>${esc(t.titolo)}</h3>
    <p class="muted small">${esc(t.tappe.join(' → '))}</p>
    <p class="small">≈ ${esc(t.km)} · ${esc(t.note || '')}</p>
    <div class="row"><button class="btn ghost" data-itin="${esc(t.id)}">Usa come viaggio</button></div>
  </article>`).join('');
}
$('#itinGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-itin]');
  if (!b) return;
  if (!user) return openAuth();
  const t = ITINS.find(x => x.id === b.dataset.itin);
  trips.push({ name: t.titolo, notes: (t.note || '') + ' — ' + t.km, stops: [], created: new Date().toISOString() });
  persist(); renderDash(); nav('dashboard');
  toast('Viaggio creato — aggiungi le tappe dai salvati');
});

// ---- dashboard: viaggi con tappe ordinabili + export ----
function renderDash() {
  const logged = !!user;
  $('#dashLock').classList.toggle('hidden', logged);
  $('#dashBody').classList.toggle('hidden', !logged);
  if (!logged) return;
  const items = allItems().filter(x => hasFav(x.id));
  const syncLabel = user.token && HAS_API ? 'sincronizzato' : (user.guest ? 'ospite · solo dispositivo' : 'solo su questo dispositivo');
  $('#favCount').textContent = `(${items.length}) · ${syncLabel}`;
  $('#favList').innerHTML = items.map(i => `<div class="favrow"><b>${esc(i.nome)}</b><span class="muted small">${esc(i.comune)}</span><button class="btn ghost" data-unfav="${esc(i.id)}" aria-label="Rimuovi ${esc(i.nome)}">✕</button></div>`).join('')
    || '<p class="muted">Nessun salvato. Tocca ♡ sulle schede.</p>';
  $('#tripList').innerHTML = trips.map((t, ix) => {
    const stops = (t.stops || []).map((sid, six) => {
      const s = findItem(sid);
      return `<div class="favrow small"><span>${six + 1}. <b>${esc(s ? s.nome : sid)}</b></span>
        <span class="mover"><button class="btn ghost" data-mv="${ix},${six},-1" aria-label="Sposta su">↑</button><button class="btn ghost" data-mv="${ix},${six},1" aria-label="Sposta giù">↓</button><button class="btn ghost" data-rmstop="${ix},${six}" aria-label="Togli tappa">✕</button></span></div>`;
    }).join('');
    const addOpts = items.filter(i => !(t.stops || []).includes(i.id))
      .map(i => `<option value="${esc(i.id)}">${esc(i.nome)} — ${esc(i.comune)}</option>`).join('');
    return `<div class="trip"><b>${esc(t.name)}</b>
      <p class="muted small">${esc(t.notes || '')}</p>${stops}
      <div class="row"><select data-addstop="${ix}" aria-label="Aggiungi tappa a ${esc(t.name)}"><option value="">+ aggiungi tappa…</option>${addOpts}</select>
      <button class="btn ghost" data-gpx="${ix}">GPX viaggio</button>
      <button class="btn ghost" data-deltrip="${ix}">Elimina</button></div></div>`;
  }).join('') || '<p class="muted">Nessun viaggio. Creane uno o importa un itinerario.</p>';
}
$('#favList').addEventListener('click', e => {
  const b = e.target.closest('[data-unfav]');
  if (b) toggleFav(b.dataset.unfav);
});
$('#tripList').addEventListener('click', e => {
  const mv = e.target.closest('[data-mv]');
  const rm = e.target.closest('[data-rmstop]');
  const gx = e.target.closest('[data-gpx]');
  const del = e.target.closest('[data-deltrip]');
  if (mv) {
    const [ix, six, d] = mv.dataset.mv.split(',').map(Number);
    const st = trips[ix].stops;
    const j = six + d;
    if (j >= 0 && j < st.length) { [st[six], st[j]] = [st[j], st[six]]; persist(); renderDash(); }
  }
  if (rm) {
    const [ix, six] = rm.dataset.rmstop.split(',').map(Number);
    trips[ix].stops.splice(six, 1); persist(); renderDash();
  }
  if (gx) exportTripGpx(+gx.dataset.gpx);
  if (del) { trips.splice(+del.dataset.deltrip, 1); persist(); renderDash(); }
});
$('#tripList').addEventListener('change', e => {
  const s = e.target.closest('[data-addstop]');
  if (s && s.value) {
    const ix = +s.dataset.addstop;
    trips[ix].stops = trips[ix].stops || [];
    trips[ix].stops.push(s.value);
    persist(); renderDash();
  }
});
$('#saveTrip').onclick = () => {
  if (!user) return openAuth();
  const n = $('#tripName').value.trim() || 'Viaggio senza nome';
  trips.push({ name: n, notes: $('#tripNotes').value || '', stops: Object.keys(favs), created: new Date().toISOString() });
  $('#tripName').value = ''; $('#tripNotes').value = '';
  persist(); renderDash(); toast('Viaggio salvato · ' + whereSaved());
};
const gpxEsc = s => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
function exportTripGpx(ix) {
  const t = trips[ix];
  if (!t || !(t.stops || []).length) return toast('Aggiungi almeno una tappa');
  const wpts = t.stops.map((sid, k) => {
    const i = findItem(sid);
    if (!i || i.lat == null) return '';
    return `<wpt lat="${i.lat}" lon="${i.lng}"><name>${gpxEsc((k + 1) + '. ' + i.nome)}</name><desc>${gpxEsc(i.comune + ' — ' + (i.servizi || []).join(', '))}</desc></wpt>`;
  }).join('\n');
  dl(t.name.replace(/\s+/g, '-').toLowerCase() + '.gpx',
    `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="camperisti" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${gpxEsc(t.name)}</name></metadata>\n${wpts}\n</gpx>`,
    'application/gpx+xml');
  toast('GPX del viaggio esportato');
}
$('#exportTxt').onclick = () => {
  const items = allItems().filter(x => hasFav(x.id));
  const txt = `CAMPERISTI — ${new Date().toLocaleDateString('it-IT')}\nCatalogo in verifica: riconferma sempre telefono e prezzi.\n\nSALVATI:\n`
    + items.map(i => `- ${i.nome} (${i.comune}) ${i.lat},${i.lng} [${(i.servizi || []).join(', ')}] nota: ${favs[i.id] || ''}`).join('\n')
    + `\n\nVIAGGI:\n` + trips.map(t => `## ${t.name}\n${t.notes}\nTappe: ${(t.stops || []).join(' → ')}`).join('\n');
  dl('camperisti.txt', txt, 'text/plain');
};
function dl(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- navigazione + hash condivisibili ----
function nav(v) {
  document.querySelectorAll('.view').forEach(s => s.classList.add('hidden'));
  $('#view-' + v).classList.remove('hidden');
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === v));
  document.body.classList.toggle('ops', v !== 'esplora');
  if (v === 'dashboard') renderDash();
  if (!location.hash.startsWith('#/s/')) history.replaceState(null, '', v === 'esplora' ? '#/r/' + curReg : '#/' + v);
}
document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => nav(b.dataset.nav === 'esplora' ? 'esplora' : b.dataset.nav));
document.querySelectorAll('#regionTabs button').forEach(b => b.onclick = () => {
  curReg = b.dataset.reg;
  document.querySelectorAll('#regionTabs button').forEach(x => x.classList.toggle('active', x === b));
  history.replaceState(null, '', '#/r/' + curReg);
  render();
});
function routeFromHash() {
  const h = location.hash;
  let m = h.match(/^#\/r\/(\w+)/);
  if (m && REGIONS.includes(m[1])) {
    curReg = m[1];
    document.querySelectorAll('#regionTabs button').forEach(x => x.classList.toggle('active', x.dataset.reg === curReg));
    nav('esplora');
    return;
  }
  m = h.match(/^#\/s\/([\w-]+)/);
  if (m && findItem(m[1])) {
    const it = findItem(m[1]);
    curReg = it.regione;
    document.querySelectorAll('#regionTabs button').forEach(x => x.classList.toggle('active', x.dataset.reg === curReg));
    nav('esplora'); render();
    openDetail(m[1]);
    return;
  }
  m = h.match(/^#\/(itinerari|dashboard|extra)/);
  if (m) nav(m[1]);
}
window.addEventListener('hashchange', routeFromHash);
$('#q').addEventListener('input', render);
$('#fTipo').addEventListener('change', render);
$('#onlyFavs').addEventListener('change', render);
document.querySelectorAll('[data-qf]').forEach(b => b.onclick = () => {
  const f = b.dataset.qf;
  if (qf.has(f)) qf.delete(f); else qf.add(f);
  b.classList.toggle('active', qf.has(f));
  b.setAttribute('aria-pressed', qf.has(f));
  render();
});
function buildMarquee() {
  const names = [...new Set(allItems().slice(0, 30).map(i => i.comune).filter(Boolean))];
  $('#marqueeTrack').textContent = names.join('  ·  ') + '  ·  ';
}

// ---- auth: ospite / dispositivo (demo) / backend ----
function openAuth() { $('#authModal').classList.remove('hidden'); $('#aEmail').focus(); }
window.openAuth = openAuth;
$('#authBtn').onclick = openAuth;
$('#closeAuth').onclick = () => $('#authModal').classList.add('hidden');
$('#guestBtn').onclick = () => {
  user = { guest: true, nome: 'Ospite' };
  localStorage.setItem('camperisti_user', JSON.stringify(user));
  $('#authModal').classList.add('hidden');
  paintAuth(); renderDash(); nav('dashboard');
  toast('Modalità ospite · solo su questo dispositivo');
};
$('#logoutBtn').onclick = () => {
  user = null;
  localStorage.removeItem('camperisti_user');
  paintAuth(); renderDash();
};
async function authCall(mode) {
  const email = $('#aEmail').value.trim().toLowerCase();
  const pass = $('#aPass').value;
  const nome = $('#aNome').value.trim();
  $('#authMsg').textContent = '';
  if (!email || !pass) { $('#authMsg').textContent = 'Inserisci email e password.'; return; }
  // 1) prova backend (stessa origine) con timeout
  const r = await api('/api/auth/' + mode, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, pass, nome })
  });
  if (r.ok && r.data && r.data.ok) {
    user = { email: r.data.email, nome: r.data.nome || nome || email, token: r.data.token };
    localStorage.setItem('camperisti_user', JSON.stringify(user));
    $('#authModal').classList.add('hidden');
    paintAuth(); renderDash(); syncFromBackend();
    toast('Ciao ' + (user.nome || '') + ' · sincronizzato ✓');
    return;
  }
  if (r.err !== 'offline' && r.status !== 404) {
    $('#authMsg').textContent = (r.data && r.data.error) || 'Accesso non riuscito.';
    return;
  }
  // 2) fallback dispositivo — SOLO demo locale, login e registrazione separati
  const k = 'camperisti_pw_' + email;
  const stored = localStorage.getItem(k);
  if (mode === 'register') {
    if (stored) { $('#authMsg').textContent = 'Account già presente su questo dispositivo: usa Accedi.'; return; }
    localStorage.setItem(k, 'demo:' + pass);
    user = { email, nome: nome || email };
  } else {
    if (!stored) { $('#authMsg').textContent = 'Nessun account su questo dispositivo: usa Registrati o entra come ospite.'; return; }
    if (stored !== 'demo:' + pass) { $('#authMsg').textContent = 'Password non corretta.'; return; }
    user = { email, nome: email };
  }
  localStorage.setItem('camperisti_user', JSON.stringify(user));
  $('#authModal').classList.add('hidden');
  paintAuth(); renderDash();
  toast('Account dispositivo (demo) · solo su questo dispositivo');
}
$('#doLogin').onclick = () => authCall('login');
$('#doReg').onclick = () => authCall('register');
function paintAuth() {
  $('#userLabel').textContent = user ? (user.nome || user.email || 'Ospite') : '';
  $('#userLabel').classList.toggle('hidden', !user);
  $('#authBtn').classList.toggle('hidden', !!user);
  $('#logoutBtn').classList.toggle('hidden', !user);
}

// ---- extra: checklist + costi ----
const CHECKS = ['Acqua potabile piena', 'Scarico grigie/nere vuoto', 'Gas / bombole', 'Elettricità / cavo', 'Documenti + assicurazione', 'Farmaci + cane', 'Cibo base + torce', 'Gomme / ruotino / triangolo', 'Prenota area prima sera', 'Mappe offline / contanti'];
let checks = JSON.parse(localStorage.getItem('camperisti_checks') || '[]');
function renderChecks() {
  $('#checklist').innerHTML = CHECKS.map((c, i) => `<label class="favrow"><input type="checkbox" data-i="${i}" ${checks.includes(i) ? 'checked' : ''}> ${esc(c)}</label>`).join('');
  document.querySelectorAll('#checklist input').forEach(cb => cb.onchange = () => {
    const i = +cb.dataset.i;
    checks = cb.checked ? [...new Set([...checks, i])] : checks.filter(x => x !== i);
    localStorage.setItem('camperisti_checks', JSON.stringify(checks));
  });
}
$('#resetCheck').onclick = () => { checks = []; localStorage.removeItem('camperisti_checks'); renderChecks(); };
function calc() {
  const t = (+$('#cNotti').value || 0) * (+$('#cPrezzo').value || 0) + (+$('#cFuel').value || 0);
  $('#cTot').textContent = t.toFixed(0) + ' €';
}
['cNotti', 'cPrezzo', 'cFuel'].forEach(id => document.addEventListener('input', e => { if (e.target.id === id) calc(); }));

function toast(m) {
  const t = $('#toast');
  t.textContent = m; t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 2200);
}

paintAuth(); renderChecks(); calc(); loadAll();
