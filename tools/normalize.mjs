// Normalizza catalogo Camperisti: servizi canonici, fonte/stato/stagione.
// Uso: node tools/normalize.mjs  (idempotente)
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const SYN = new Map([
  ['elettricità', 'luce'], ['allaccio luce', 'luce'], ['corrente', 'luce'],
  ['colonnine corrente', 'luce'], ['luce 600w', 'luce'], ['luce 4a', 'luce'],
  ['luce 10a', 'luce'], ['punti luce+acqua', 'luce'],
  ['carico', 'acqua'], ['carico acqua', 'acqua'], ['carico acqua potabile', 'acqua'],
  ['canna acqua', 'acqua'], ['acqua potabile', 'acqua'],
  ['docce calde', 'docce'], ['doccia', 'docce'], ['docce solari', 'docce'],
  ['doccia calda a gettoni', 'docce'], ['bagni/docce calde', 'docce'],
  ['pizzeria', 'ristorante'], ['ristorazione', 'ristorante'],
  ['bar/ristorante', 'ristorante'],
  ['barbecue', 'bbq'],
  ['lavanderia', 'lavatrice'], ['lavatrice gettoni', 'lavatrice'],
  ['cani', 'pet'], ['dog-sitter', 'pet'], ['pet-friendly', 'pet'],
  ['parco giochi', 'bimbi'], ['area bimbi', 'bimbi'], ['area giochi', 'bimbi'],
  ['noleggio bici', 'bici'], ['navetta mare', 'navetta'], ['navetta spiaggia', 'navetta'],
  ['passaggio città', 'navetta'],
  ['service completi', 'service'], ['service auto', 'service'],
  ['camper service', 'service'], ['servizi camper completi', 'service'],
  ['servizi camper', 'service'],
  ['videosorvegliata', 'videosorveglianza'],
  ['installazioni', 'officina'],
]);

const norm = s => {
  const k = String(s).trim().toLowerCase();
  if (/(mare|spiaggia)\b/.test(k) && !/maremma/.test(k)) return 'mare';
  if (SYN.has(k)) return SYN.get(k);
  return k;
};

const SEASON_RX = /(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*\s*[-–/]\s*(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*|\bannuale\b|tutto l.?anno/i;

for (const f of readdirSync('frontend/data')) {
  if (f === 'itinerari.json' || !f.endsWith('.json')) continue;
  const p = 'frontend/data/' + f;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  const seen = new Set();
  for (const it of arr) {
    if (seen.has(it.id)) throw new Error('ID duplicato: ' + it.id);
    seen.add(it.id);
    const sv = [...new Set((it.servizi || []).map(norm))];
    it.servizi = sv.filter(Boolean).sort();
    it.fonte = it.fonte || 'Camperisti beta · directory pubbliche e siti ufficiali (es. camperonline.it) — fonte primaria da confermare';
    it.stato = it.stato || 'da riconfermare';
    if (!('stagione' in it)) {
      const m = `${it.note || ''} ${it.prezzo || ''}`.match(SEASON_RX);
      it.stagione = m ? m[0] : null;
    }
  }
  writeFileSync(p, JSON.stringify(arr, null, 2) + '\n');
  console.log(f + ': ' + arr.length + ' schede normalizzate');
}
