// Controllo giornaliero siti ufficiali: verifica che rispondano, aggiorna `verificato`.
// Uso: node tools/update-check.mjs  (usato anche dal workflow GitHub Actions ogni 24h)
// Non inventa dati: tocca solo verificato/sitoOk, mai prezzi/telefoni.
import { readFileSync, writeFileSync } from 'fs';

const today = new Date().toISOString().slice(0, 10);
let ok = 0, ko = 0;
const bad = [];

async function check(url, ms = 15000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: c.signal, headers: { 'User-Agent': 'Camperisti-check/1.0 (+https://camperisti-p0ly.vercel.app)' } });
    if (r.status === 405 || r.status === 501 || r.status === 403) r = await fetch(url, { method: 'GET', redirect: 'follow', signal: c.signal, headers: { 'User-Agent': 'Camperisti-check/1.0' } });
    clearTimeout(t);
    return { ok: r.ok, status: r.status };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, status: 0 };
  }
}

for (const f of ['campania', 'lazio', 'sardegna', 'sicilia']) {
  const p = `frontend/data/${f}.json`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  for (const it of arr) {
    if (!it.sito || !/^https?:\/\//.test(it.sito)) continue;
    const r = await check(it.sito);
    it.verificato = today;
    it.sitoOk = r.ok;
    if (r.ok) ok++;
    else { ko++; bad.push(`${it.id} ${it.comune} ${it.sito} (http ${r.status})`); }
  }
  writeFileSync(p, JSON.stringify(arr, null, 2) + '\n');
  console.log(f + ': verificati aggiornati al ' + today);
}
console.log(`siti ok: ${ok}, non rispondono: ${ko}`);
if (bad.length) {
  console.log('DA RICONTROLLARE A MANO:');
  for (const b of bad) console.log(' - ' + b);
}
writeFileSync('tools/last-check.json', JSON.stringify({ date: today, ok, ko, bad }, null, 2) + '\n');
console.log('report in tools/last-check.json');
