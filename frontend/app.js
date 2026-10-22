// Camperisti beta — frontend statico, zero dipendenze.
// Auth: ospite (nessuna password) | account dispositivo (demo locale) | account backend (token Bearer).
const REGIONS = ['campania', 'lazio', 'sardegna', 'sicilia'];
const QFILTERS = ['acqua', 'scarico', 'luce', 'docce', 'wifi', 'mare', 'pet', 'ombra', 'service'];
let DB = {}, ITINS = [];
let curReg = 'campania';
let qf = new Set();
let HAS_API = false;
// ---- stato locale con parse sicura: archivio vuoto o corrotto non blocca mai l'avvio ----
const jparse = (s, fb) => { try { const v = JSON.parse(s); return v === undefined ? fb : v; } catch (e) { return fb; } };
let user = jparse(localStorage.getItem('camperisti_user'), null);
if (user && typeof user !== 'object') user = null;
let favs = {};
let trips = [];
// archivi separati per identità: ospite / profilo dispositivo / email
const nsKey = base => base + '::' + (user ? (user.email || (user.device ? 'profilo:' + user.nome : 'ospite')) : 'anonimo');
function saveLocal() {
  try {
    localStorage.setItem(nsKey('camperisti_favs'), JSON.stringify(favs));
    localStorage.setItem(nsKey('camperisti_trips'), JSON.stringify(trips));
  } catch (e) { /* spazio esaurito: i dati restano in memoria per la sessione */ }
}
function loadLocal() {
  const fk = localStorage.getItem(nsKey('camperisti_favs'));
  const tk = localStorage.getItem(nsKey('camperisti_trips'));
  if (fk === null && tk === null && !localStorage.getItem('camperisti_migrated')) {
    // migrazione una tantum dalle chiavi globali precedenti verso la prima identità usata
    const lf = jparse(localStorage.getItem('camperisti_favs'), null);
    const lt = jparse(localStorage.getItem('camperisti_trips'), null);
    favs = (lf && typeof lf === 'object' && !Array.isArray(lf)) ? lf : {};
    trips = Array.isArray(lt) ? lt : [];
    try {
      localStorage.setItem('camperisti_migrated', '1');
      localStorage.removeItem('camperisti_favs');
      localStorage.removeItem('camperisti_trips');
    } catch (e) {}
  } else {
    const f = jparse(fk, null);
    const t = jparse(tk, null);
    favs = (f && typeof f === 'object' && !Array.isArray(f)) ? f : {};
    trips = Array.isArray(t) ? t : [];
  }
  saveLocal();
}
// pulizia una tantum vecchie password demo leggibili: non più usate, via
try {
  const dead = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf('camperisti_pw_') === 0) dead.push(k);
  }
  dead.forEach(k => localStorage.removeItem(k));
} catch (e) {}
loadLocal();

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
  if ($('#modal').classList.contains('hidden')) lastFocus = document.activeElement;
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
$('#sheet').addEventListener('click', async e => {
  const b = e.target.closest('[data-d]');
  if (!b) return;
  const id = $('#sheet').dataset.id;
  if (b.dataset.d === 'close') closeModal();
  if (b.dataset.d === 'save') {
    favs[id] = $('#notaFav').value || '';
    // normalizza: chiave presente = salvato (anche con nota vuota)
    toast('Nota salvata · ' + (await persist()));
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
function openDialog() {
  if (!$('#modal').classList.contains('hidden')) return $('#sheet');
  if (!$('#authModal').classList.contains('hidden')) return $('#authModal .sheet');
  return null;
}
document.addEventListener('keydown', e => {
  const dlg = openDialog();
  if (e.key === 'Escape' && dlg) {
    if (!$('#modal').classList.contains('hidden')) closeModal();
    else $('#authModal').classList.add('hidden');
    $('#authBtn').focus();
    return;
  }
  // focus trap: la tastiera resta dentro il dialogo aperto
  if (e.key === 'Tab' && dlg) {
    const f = [...dlg.querySelectorAll('button, input, select, textarea, a[href]')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
});

// ---- preferiti (coerenti: chiave presente = salvato) ----
async function toggleFav(id) {
  const adding = !hasFav(id);
  if (!adding) delete favs[id]; else favs[id] = '';
  render(); renderDash();
  toast((adding ? 'Salvato ♥ · ' : 'Rimosso · ') + (await persist()));
}
let lastSync = 'solo su questo dispositivo';
// "sincronizzato" solo dopo conferma del server (r.ok su entrambi i POST)
async function persist() {
  saveLocal();
  if (user && user.token && HAS_API) {
    try {
      const opt = b => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...authH() }, body: b, signal: AbortSignal.timeout(2500) });
      const r1 = await fetch('/api/favorites', opt(JSON.stringify({ favs })));
      const r2 = await fetch('/api/trips', opt(JSON.stringify({ trips })));
      if (r1.status === 401 || r2.status === 401) {
        user.token = null;
        try { localStorage.setItem('camperisti_user', JSON.stringify(user)); } catch (e) {}
        lastSync = 'sessione scaduta — rieffettua il login';
      } else if (r1.ok && r2.ok) {
        lastSync = 'sincronizzato ✓';
      } else {
        lastSync = 'server: errore ' + (!r1.ok ? r1.status : r2.status);
      }
    } catch (e) {
      lastSync = 'server non raggiungibile — salvato solo locale';
    }
  } else {
    lastSync = user ? 'solo su questo dispositivo' : 'solo su questo dispositivo (accedi per sincronizzare)';
  }
  if (document.querySelector('#view-dashboard:not(.hidden)')) renderDash();
  return lastSync;
}
// merge esplicito col server: unione, il locale vince sulle note.
// "sincronizzato" solo se entrambe le letture vanno a buon fine; mai su errore.
async function syncFromBackend() {
  if (!user || !user.token || !HAS_API) return lastSync;
  try {
    const rf = await api('/api/favorites', { headers: authH() });
    const rt = await api('/api/trips', { headers: authH() });
    if (!rf.ok || !rt.ok) {
      lastSync = 'server: errore ' + (!rf.ok ? rf.status : rt.status) + ' — conservato locale';
      renderDash();
      return lastSync;
    }
    const remF = (rf.data && rf.data.favs && typeof rf.data.favs === 'object' && !Array.isArray(rf.data.favs)) ? rf.data.favs : {};
    const remT = (rt.data && Array.isArray(rt.data.trips)) ? rt.data.trips : [];
    // raccolte remote vuote = stato valido: si fondono, non si ignorano né si cancellano i locali
    for (const [k, v] of Object.entries(remF)) if (!hasFav(k)) favs[k] = v;
    const seen = new Set(trips.map(t => (t.created || '') + '|' + t.name));
    for (const t of remT) {
      if (t && t.name && !seen.has((t.created || '') + '|' + t.name)) {
        trips.push({ name: t.name, notes: t.notes || '', stops: Array.isArray(t.stops) ? t.stops : [], created: t.created || new Date().toISOString() });
        seen.add((t.created || '') + '|' + t.name);
      }
    }
    lastSync = await persist();
    render(); renderDash();
    return lastSync;
  } catch (e) {
    lastSync = 'server non raggiungibile — conservato locale';
    renderDash();
    return lastSync;
  }
}

// tappe esplicite dal catalogo: niente fuzzy matching, niente associazioni sbagliate.
// Solo gli ID elencati in t.stops vengono collegati; il resto va in t.extra ("da completare").
function resolveStops(t) {
  const seen = new Set();
  const found = [];
  for (const id of (Array.isArray(t.stops) ? t.stops : [])) {
    if (findItem(id) && !seen.has(id)) { seen.add(id); found.push(id); }
  }
  const missing = Array.isArray(t.extra) ? t.extra : [];
  return { found, missing };
}
function renderItins() {
  $('#itinGrid').innerHTML = ITINS.map(t => `<article class="card">
    <span class="badge">${esc(t.regione)}</span>
    <h3>${esc(t.titolo)}</h3>
    <p class="muted small">${esc(t.tappe.join(' → '))}</p>
    <p class="small">≈ ${esc(t.km)} · ${esc(t.note || '')}</p>
    <div class="row"><button class="btn ghost" data-itin="${esc(t.id)}">Usa come viaggio</button></div>
  </article>`).join('');
}
$('#itinGrid').addEventListener('click', async e => {
  const b = e.target.closest('[data-itin]');
  if (!b) return;
  if (!user) return openAuth();
  const t = ITINS.find(x => x.id === b.dataset.itin);
  const { found, missing } = resolveStops(t);
  trips.push({
    name: t.titolo,
    notes: (t.note || '') + ' — ' + t.km + (missing.length ? '\nDa completare (non in catalogo): ' + missing.join(' · ') : ''),
    stops: found, created: new Date().toISOString()
  });
  const where = await persist();
  renderDash(); nav('dashboard');
  toast(`Viaggio creato: ${found.length} tappe collegate${missing.length ? ', ' + missing.length + ' da completare' : ''} · ${where}`);
});

// ---- dashboard: viaggi con tappe ordinabili + export ----
function renderDash() {
  const logged = !!user;
  $('#dashLock').classList.toggle('hidden', logged);
  $('#dashBody').classList.toggle('hidden', !logged);
  if (!logged) return;
  const items = allItems().filter(x => hasFav(x.id));
  const syncLabel = lastSync;
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
$('#saveTrip').onclick = async () => {
  if (!user) return openAuth();
  const n = $('#tripName').value.trim() || 'Viaggio senza nome';
  trips.push({ name: n, notes: $('#tripNotes').value || '', stops: Object.keys(favs), created: new Date().toISOString() });
  $('#tripName').value = ''; $('#tripNotes').value = '';
  renderDash(); toast('Viaggio salvato · ' + (await persist()));
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
  for (const r of REGIONS) {
    const el = document.querySelector(`[data-gal-count="${r}"]`);
    if (el) el.textContent = `${(DB[r] || []).length} strutture`;
  }
}
// gallery: tocca una foto per filtrare la regione
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto-reg]');
  if (!g) return;
  curReg = g.dataset.gotoReg;
  document.querySelectorAll('#regionTabs button').forEach(x => x.classList.toggle('active', x.dataset.reg === curReg));
  history.replaceState(null, '', '#/r/' + curReg);
  nav('esplora'); render();
  $('#grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
// parallax gestito in CSS nativo (animation-timeline: view()), nessun JS richiesto.

// ---- auth: ospite / dispositivo (demo) / backend ----
function openAuth() { $('#authModal').classList.remove('hidden'); $('#aEmail').focus(); }
window.openAuth = openAuth;
$('#authBtn').onclick = openAuth;
$('#closeAuth').onclick = () => $('#authModal').classList.add('hidden');
$('#guestBtn').onclick = async () => {
  await persist(); // conserva l'identità precedente prima di cambiare
  user = { guest: true, nome: 'Ospite' };
  try { localStorage.setItem('camperisti_user', JSON.stringify(user)); } catch (e) {}
  loadLocal();
  $('#authModal').classList.add('hidden');
  paintAuth(); renderDash(); nav('dashboard');
  toast('Modalità ospite · archivio separato su questo dispositivo');
  $('#authBtn').focus();
};
$('#deviceBtn').onclick = async () => {
  const nome = $('#aNome').value.trim() || 'Viaggiatore';
  await persist();
  user = { device: true, nome };
  try { localStorage.setItem('camperisti_user', JSON.stringify(user)); } catch (e) {}
  loadLocal();
  $('#authModal').classList.add('hidden');
  paintAuth(); renderDash(); nav('dashboard');
  toast('Profilo dispositivo · senza password, archivio separato');
  $('#authBtn').focus();
};
$('#logoutBtn').onclick = async () => {
  await persist();
  user = null; favs = {}; trips = [];
  try { localStorage.removeItem('camperisti_user'); } catch (e) {}
  paintAuth(); renderDash();
  toast('Uscito · ogni identità conserva il proprio archivio');
};
async function authCall(mode) {
  const email = $('#aEmail').value.trim().toLowerCase();
  const pass = $('#aPass').value;
  const nome = $('#aNome').value.trim();
  $('#authMsg').textContent = '';
  if (!email || !pass) { $('#authMsg').textContent = 'Inserisci email e password.'; return; }
  // solo backend: niente più password salvate sul dispositivo
  const r = await api('/api/auth/' + mode, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, pass, nome })
  });
  if (r.ok && r.data && r.data.ok) {
    await persist(); // conserva l'identità precedente prima di cambiare
    user = { email: r.data.email, nome: r.data.nome || nome || email, token: r.data.token };
    try { localStorage.setItem('camperisti_user', JSON.stringify(user)); } catch (e) {}
    loadLocal();
    $('#authModal').classList.add('hidden');
    paintAuth(); renderDash();
    toast('Ciao ' + (user.nome || '') + ' · ' + (await syncFromBackend()));
    $('#authBtn').focus();
    return;
  }
  if (r.err === 'offline' || r.status === 404) {
    $('#authMsg').textContent = 'Server non raggiungibile da qui: usa profilo dispositivo o ospite.';
    return;
  }
  $('#authMsg').textContent = (r.data && r.data.error) || 'Accesso non riuscito.';
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
let checks = jparse(localStorage.getItem('camperisti_checks'), []);
if (!Array.isArray(checks)) checks = [];
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
