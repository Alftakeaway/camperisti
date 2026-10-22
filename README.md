# Camperisti beta — Campania · Lazio · Sardegna · Sicilia

Piattaforma a costo zero: frontend statico + backend Rust (solo 2 crate di sicurezza).

## Avvio locale

- Frontend: apri `frontend/index.html` oppure `npx serve frontend`.
- Backend (facoltativo, il sito funziona anche senza): `cd backend` → `cargo run`.
  Con backend attivo, login e salvataggi si sincronizzano lì.

## Backend Rust (`backend/`, v0.2.0)

API JSON su `127.0.0.1:3001` di default (`BIND_ADDR` per cambiare, mai esporre
diretto senza TLS). Sicurezza per account reali:

- Password con **Argon2id** + salt CSPRNG (formato PHC), verifica a tempo costante;
  login di utenti inesistenti verificato contro hash fittizio (no enumeration).
- Token sessione **256 bit da OsRng**, scadenza 14 giorni, revoca con
  `POST /api/auth/logout`.
- Validazione input (email, password 8-128, nome ≤80), body max 1 MiB con
  rifiuto anticipato, rate limiting **10 tentativi auth/min per IP** (429).
- Scritture atomiche (tmp + rename) sotto mutex, letture mai troncate.
- CORS ristretto a `CORS_ORIGIN` (default frontend prod), `X-Content-Type-Options`.

Deploy produzione: solo dietro reverse proxy con TLS (Caddy/Nginx, HSTS sul
proxy), `CORS_ORIGIN` = dominio reale, backup periodico di `backend/data/`.
Scala consigliata oltre poche migliaia di utenti: SQLite/Postgres + framework.

```powershell
cd backend
cargo run              # locale
$env:CORS_ORIGIN="https://tuo-dominio"; cargo run
```

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
