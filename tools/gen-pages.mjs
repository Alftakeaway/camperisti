// Genera pagine statiche indicizzabili: r/{regione}.html + s/{id}.html + sitemap.xml
// Uso: node tools/gen-pages.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';

const BASE = 'https://camperisti-p0ly.vercel.app';
const REGIONS = ['campania', 'lazio', 'sardegna', 'sicilia'];
const NAMES = { campania: 'Campania', lazio: 'Lazio', sardegna: 'Sardegna', sicilia: 'Sicilia' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

mkdirSync('frontend/r', { recursive: true });
mkdirSync('frontend/s', { recursive: true });

const shell = (title, desc, body, extra = '') => `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${BASE}/${extra}">
<style>body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:760px;margin:0 auto;padding:20px;line-height:1.55;color:#16211d}a{color:#0b6e4f}.card{border:1px solid #d5ddd8;border-radius:12px;padding:14px;margin:12px 0}.muted{color:#5a6b63}.badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:99px;background:#e7f2ec;text-transform:uppercase}.warn{background:#fdf0d5}ul{padding-left:20px}</style>
</head>
<body>
<p><a href="${BASE}/">← Camperisti</a></p>
${body}
<hr><p class="muted">Camperisti beta — catalogo in verifica: riconferma sempre telefono e prezzi prima di partire.</p>
</body>
</html>
`;

const urls = [`<url><loc>${BASE}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`];
const all = {};
for (const r of REGIONS) all[r] = JSON.parse(readFileSync(`frontend/data/${r}.json`, 'utf8'));

// strutture
for (const r of REGIONS) {
  for (const it of all[r]) {
    const ld = {
      '@context': 'https://schema.org', '@type': 'TouristAttraction',
      name: it.nome, address: `${it.comune}, Italia`,
      ...(it.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: it.lat, longitude: it.lng } } : {}),
    };
    const body = `<h1>${esc(it.nome)}</h1>
<p><span class="badge">${esc(it.tipo)}</span> <span class="badge warn">${esc(it.stato || 'da riconfermare')}</span></p>
<p>${esc(it.comune)} · ${esc(it.indirizzo || '')}</p>
<p><b>Servizi:</b> ${esc((it.servizi || []).join(', ') || '—')}</p>
<p><b>Prezzo:</b> ${esc(it.prezzo || 'contattare la struttura')} · <b>Stagione:</b> ${esc(it.stagione || 'da confermare')} · <b>Controllo:</b> ${esc(it.verificato || '—')}</p>
${it.sito ? `<p>Sito ufficiale: <a href="${esc(it.sito)}">${esc(it.sito.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></p>` : ''}
<p class="muted">Fonte: ${esc(it.fonte || '')}</p>
<p>${esc(it.note || '')}</p>
${it.tel ? `<p>Tel: <a href="tel:${esc(it.tel)}">${esc(it.tel)}</a></p>` : ''}
<p><a href="${BASE}/#/s/${it.id}">Apri nell'app interattiva</a> · <a href="${BASE}/r/${r}.html">Tutte le strutture in ${NAMES[r]}</a></p>
<script type="application/ld+json">${JSON.stringify(ld)}</${'script'}>`;
    writeFileSync(`frontend/s/${it.id}.html`, shell(`${it.nome} — ${it.comune} | Camperisti`, `${it.tipo} a ${it.comune}: servizi, prezzo e stato verifica.`, body, `s/${it.id}.html`));
    urls.push(`<url><loc>${BASE}/s/${it.id}.html</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
  }
}

// regioni
for (const r of REGIONS) {
  const items = all[r];
  const rows = items.map(it => `<div class="card"><b><a href="${BASE}/s/${it.id}.html">${esc(it.nome)}</a></b><br><span class="muted">${esc(it.comune)} · ${esc(it.tipo)} · ${esc(it.prezzo || 'n.d.')}</span></div>`).join('\n');
  const body = `<h1>Camper in ${NAMES[r]}: ${items.length} strutture</h1>
<p>Aree sosta, campeggi, agricampeggi, parcheggi, service e officine. Stato: catalogo in verifica.</p>
${rows}
<p><a href="${BASE}/#/r/${r}">Apri la mappa interattiva del ${NAMES[r]}</a></p>`;
  writeFileSync(`frontend/r/${r}.html`, shell(`Camper in ${NAMES[r]}: aree sosta e campeggi | Camperisti`, `Elenco strutture camper in ${NAMES[r]} con servizi, prezzi e stato verifica.`, body, `r/${r}.html`));
  urls.push(`<url><loc>${BASE}/r/${r}.html</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
}

writeFileSync('frontend/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
console.log(`pagine: 4 regioni + ${urls.length - 5} strutture + sitemap`);
