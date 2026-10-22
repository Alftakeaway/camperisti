// Cerca listini DENTRO i siti ufficiali delle schede senza prezzo pubblicato.
// Non inventa nulla: riporta solo snippet reali con € trovati nelle pagine.
import { readFileSync } from 'fs';

const targets = [];
for (const f of ['campania', 'lazio', 'sardegna', 'sicilia'])
  for (const x of JSON.parse(readFileSync(`frontend/data/${f}.json`, 'utf8')))
    if (x.sito && /contattare la struttura/i.test(x.prezzo || '')) targets.push(x);

console.log('schede da ispezionare:', targets.map(t => t.id).join(' '));

for (const t of targets) {
  try {
    const c = new AbortController();
    const to = setTimeout(() => c.abort(), 20000);
    const r = await fetch(t.sito, { redirect: 'follow', signal: c.signal, headers: { 'User-Agent': 'Camperisti-check/1.0' } });
    clearTimeout(to);
    if (!r.ok) { console.log(`\n## ${t.id} ${t.nome}\nHTTP ${r.status}`); continue; }
    const html = await r.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // cerca importi in euro vicino a parole chiave
    const hits = [];
    const rx = /([^.]{0,60}(?:prezzo|tariff|listino|costo|notte|giorno|piazzola|sosta)[^.]{0,60}\d[\d.,]*\s*€[^.]{0,40}|[^.]{0,40}\d[\d.,]*\s*€[^.]{0,60}(?:notte|giorno|persona|piazzola)[^.]{0,40})/gi;
    let m;
    while ((m = rx.exec(text)) && hits.length < 5) hits.push(m[0].trim().slice(0, 160));
    console.log(`\n## ${t.id} ${t.nome}\n${t.sito} (finale: ${r.url.slice(0, 90)})`);
    if (hits.length) for (const h of hits) console.log('  €> ' + h);
    else console.log('  (nessun prezzo trovato in home)');
    // cerca link a pagine listino/tariffe
    const links = [...html.matchAll(/href="([^"]*(?:prezz|tariff|listino)[^"]*)"/gi)].slice(0, 5).map(x => x[1]);
    if (links.length) console.log('  pagine candidate: ' + [...new Set(links)].join(' | '));
  } catch (e) {
    console.log(`\n## ${t.id} ${t.nome}\nERRORE: ${String(e.cause || e).slice(0, 100)}`);
  }
}
