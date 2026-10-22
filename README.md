# Camperisti beta — Campania · Lazio · Sardegna · Sicilia

Piattaforma a costo zero: frontend statico + backend Rust senza dipendenze.

## Struttura
- `frontend/` sito statico: `index.html`, `styles.css`, `app.js`, `data/*.json`
- `backend/` Rust std-only (zero crate): `cargo run` → http://127.0.0.1:3001
- API: `GET /api/health`, `GET /api/areas?regione=campania|lazio|sardegna|sicilia`,
  `POST /api/auth/register`, `POST /api/auth/login`,
  `GET/POST /api/favorites?email=`, `GET/POST /api/trips?email=`

## Avvio locale
1. Backend (facoltativo, il sito funziona anche senza):
   `cd backend` → `cargo run`
2. Frontend: apri `frontend/index.html` oppure `npx serve frontend`
   Se il backend è attivo, login e salvataggi si sincronizzano lì,
   altrimenti restano in localStorage.

## Funzioni
- Esplora per regione/tipo/testo, schede con servizi/prezzo/verificato, navigazione Google Maps
- Login gratis (email+password), salvati ♥ con note, viaggi, export TXT/GPX
- Itinerari: 12 tracce (3 per regione), importabili nei viaggi
- Strumenti: checklist partenza, stima costi, banner premium futuro
- Animazioni cinetiche: blob, marquee, reveal, tilt card, modal slide-up — tutto CSS/JS puro, zero CDN

## Dati
67 strutture + 12 itinerari verificati ott 2026 in `frontend/data/`.
Prima di partire: riconferma telefono/prezzi. Per aggiungere una struttura: aggiungi un oggetto JSON con `id,nome,comune,tipo,indirizzo,lat,lng,servizi,prezzo,verificato,note`.
Tipi: `area_sosta | campeggio | agricampeggio | parcheggio | service | officina`.

## Deploy costo zero
Frontend → Vercel statico (root `frontend/`). Backend Rust → per ora solo locale;
per prod futura: stesso codice su VPS/Render, o funzioni serverless. Nessun account esterno richiesto.
