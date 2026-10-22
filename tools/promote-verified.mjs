// Promuove a "verificato" le schede con prove documentate e correnti.
// Criterio (mostrato in legenda sul sito): sito ufficiale raggiungibile
// all'ultimo controllo + telefono pubblicato + listino pubblicato
// (per officine/service basta "preventivo", che è il listino del settore).
// Deterministico: se una prova viene meno, torna "da riconfermare".
// Uso: dopo tools/update-check.mjs (anche nel workflow quotidiano).
import { readFileSync, writeFileSync } from 'fs';

const PREZZO_OK = it =>
  (it.tipo === 'officina' || it.tipo === 'service')
    ? /preventivo|€|gratis/i.test(it.prezzo || '')
    : !!it.prezzo && !/contattare|n\.d\./i.test(it.prezzo);

let ver = 0, tot = 0;
for (const f of ['campania', 'lazio', 'sardegna', 'sicilia']) {
  const p = `frontend/data/${f}.json`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  for (const it of arr) {
    tot++;
    const ok = !!it.sito && it.sitoOk !== false && !!it.tel && PREZZO_OK(it);
    it.stato = ok ? 'verificato' : 'da riconfermare';
    if (ok) ver++;
  }
  writeFileSync(p, JSON.stringify(arr, null, 2) + '\n');
  console.log(f + ': verificate ' + arr.filter(x => x.stato === 'verificato').length + '/' + arr.length);
}
console.log(`TOTALE verificate: ${ver}/${tot}`);
