use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use rand::rngs::OsRng;

static ACTIVE: AtomicUsize = AtomicUsize::new(0);
const MAX_THREADS: usize = 32;
// auth: max 10 tentativi/min per IP (login/register/logout)
const AUTH_LIMIT: u32 = 10;
const AUTH_WINDOW_SECS: u64 = 60;
// sessioni: 14 giorni, poi nuovo login
const SESSION_TTL_SECS: u64 = 14 * 24 * 3600;

// Origine consentita per CORS (stessa origine in produzione dietro reverse proxy).
// Di default il frontend pubblico; in locale impostare CORS_ORIGIN=http://localhost:xxxx
static CORS_ORIGIN: LazyLock<String> = LazyLock::new(|| {
    std::env::var("CORS_ORIGIN").unwrap_or("https://camperisti-p0ly.vercel.app".to_string())
});
// Un solo scrittore alla volta sull'archivio file (niente update persi fra thread)
static STORE: Mutex<()> = Mutex::new(());
// Contatori rate limiting per IP: ip -> (tentativi, inizio finestra)
static RATE: LazyLock<Mutex<HashMap<String, (u32, u64)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
// Proxy a cui credere per X-Forwarded-For (default: solo loopback).
// In produzione: IP privati del proprio stack (es. "10.0.0.0/8") o IP del LB.
// Mai fidarsi di XFF da client arbitrari: rate limit aggirabile.
static TRUSTED_PROXIES: LazyLock<Vec<String>> = LazyLock::new(|| {
    std::env::var("TRUSTED_PROXIES")
        .unwrap_or("127.0.0.1,::1".to_string())
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
});
// Hash fittizio per tempi di risposta uniformi quando l'utente non esiste
// (niente enumeration via timing). Inizializzato all'avvio.
static DUMMY_HASH: LazyLock<String> = LazyLock::new(|| {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(b"camperisti-dummy-fallback", &salt)
        .map(|h| h.to_string())
        .unwrap_or_default()
});

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// NOTA produzione: esporre solo dietro reverse proxy con TLS (es. Caddy/Nginx),
// BIND_ADDR=127.0.0.1 di default, backup periodico di backend/data/, HSTS sul proxy.
// Argon2id + salt CSPRNG per le password, token 256 bit da OsRng.

fn data_dir() -> PathBuf {
    let mut p = std::env::current_dir().unwrap_or(PathBuf::from("."));
    if p.ends_with("backend") {
        p.push("data");
    } else {
        p.push("backend");
        p.push("data");
    }
    let _ = fs::create_dir_all(&p);
    p
}

fn frontend_data_path(regione: &str) -> PathBuf {
    let mut p = std::env::current_dir().unwrap_or(PathBuf::from("."));
    if p.ends_with("backend") {
        p.push("..");
        p.push("frontend");
    } else {
        p.push("frontend");
    }
    p.push("data");
    p.push(format!("{}.json", regione));
    p
}

fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', " ")
}

fn send(stream: &mut TcpStream, status: &str, body: &str) {
    send_extra(stream, status, body, "");
}

fn send_extra(stream: &mut TcpStream, status: &str, body: &str, extra: &str) {
    let resp = format!(
        "{}\r\nAccess-Control-Allow-Origin: {}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nX-Content-Type-Options: nosniff\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n{}",
        status,
        *CORS_ORIGIN,
        body.as_bytes().len(),
        extra,
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

// Scrittura atomica: tmp + rename (mai file troncati ai lettori)
static TMP_CTR: AtomicUsize = AtomicUsize::new(0);

fn atomic_write(path: &PathBuf, data: &str) -> bool {
    let tmp = path.with_extension(format!(
        "tmp.{}-{}",
        std::process::id(),
        TMP_CTR.fetch_add(1, Ordering::SeqCst)
    ));
    if fs::write(&tmp, data).is_err() {
        return false;
    }
    fs::rename(&tmp, path).is_ok()
}

fn with_store<T>(f: impl FnOnce() -> T) -> T {
    let _g = STORE.lock().unwrap();
    f()
}

// Rate limiting per IP (tentativi auth)
fn rate_ok(ip: &str) -> bool {
    let now = now_secs();
    let mut m = RATE.lock().unwrap();
    if m.len() > 5000 {
        m.retain(|_, &mut (_, t)| now.saturating_sub(t) < AUTH_WINDOW_SECS);
    }
    let e = m.entry(ip.to_string()).or_insert((0, now));
    if now.saturating_sub(e.1) >= AUTH_WINDOW_SECS {
        *e = (0, now);
    }
    if e.0 >= AUTH_LIMIT {
        return false;
    }
    e.0 += 1;
    true
}

// IPv4 CIDR semplice (es. "10.0.0.0/8"); IPv6 solo match esatto
fn ip_in_cidr(ip: &std::net::IpAddr, cidr: &str) -> bool {
    let Some((net, bits)) = cidr.split_once('/') else {
        return false;
    };
    let (Ok(net_ip), Ok(bits)) = (net.parse::<std::net::IpAddr>(), bits.parse::<u32>()) else {
        return false;
    };
    match (ip, net_ip) {
        (std::net::IpAddr::V4(a), std::net::IpAddr::V4(n)) if bits <= 32 => {
            let m = if bits == 0 { 0 } else { u32::MAX << (32 - bits) };
            (u32::from(*a) & m) == (u32::from(n) & m)
        }
        _ => false,
    }
}

fn proxy_trusted(peer: &str) -> bool {
    let ip: Option<std::net::IpAddr> = peer.parse().ok();
    TRUSTED_PROXIES.iter().any(|t| {
        t == peer || ip.map(|a| ip_in_cidr(&a, t)).unwrap_or(false)
    })
}

// IP client reale: X-Forwarded-For vale SOLO se il peer è un proxy fidato,
// altrimenti si usa l'indirizzo TCP (spoofing impossibile).
fn client_ip(headers: &[String], peer: &str) -> String {
    if !proxy_trusted(peer) {
        return peer.to_string();
    }
    for h in headers {
        if let Some(v) = h.to_ascii_lowercase().strip_prefix("x-forwarded-for:") {
            let first = v.split(',').next().unwrap_or("").trim().trim_matches('"');
            if first.parse::<std::net::IpAddr>().is_ok() {
                return first.to_string();
            }
        }
    }
    peer.to_string()
}

fn valid_email(s: &str) -> bool {
    if s.len() < 3 || s.len() > 254 {
        return false;
    }
    if s.bytes().any(|b| b <= 32 || b == 127) {
        return false;
    }
    if s.contains(['"', '\\']) {
        return false;
    }
    let mut parts = s.split('@');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(l), Some(d), None) => !l.is_empty() && d.contains('.') && !d.starts_with('.') && !d.ends_with('.'),
        _ => false,
    }
}

fn valid_pass(s: &str) -> bool {
    let n = s.chars().count();
    n >= 8 && n <= 128
}

fn valid_nome(s: &str) -> bool {
    s.chars().count() <= 80
}

fn pct_decode(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '%' {
            let h: String = [it.next(), it.next()].iter().filter_map(|x| *x).collect();
            if let Ok(b) = u8::from_str_radix(&h, 16) {
                out.push(b as char);
                continue;
            }
            out.push('%');
            out.push_str(&h);
        } else if c == '+' {
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

fn get_query(path: &str, key: &str) -> Option<String> {
    let q = path.split('?').nth(1)?;
    for kv in q.split('&') {
        let mut it = kv.splitn(2, '=');
        if let (Some(k), Some(v)) = (it.next(), it.next()) {
            if k == key {
                return Some(pct_decode(v));
            }
        }
    }
    None
}

// estrae "campo":"valore" dal body json (rispetta i backslash dentro le stringhe)
fn jval(body: &str, key: &str) -> String {
    let pat = format!("\"{}\"", key);
    let Some(i) = body.find(&pat) else { return String::new() };
    let rest = &body[i + pat.len()..];
    let Some(c) = rest.find(':') else { return String::new() };
    let v = rest[c + 1..].trim_start();
    if let Some(stripped) = v.strip_prefix('"') {
        return take_quoted(stripped);
    }
    let end = v.find(&[',', '}', '\n'][..]).unwrap_or(v.len());
    v[..end].trim().trim_matches('"').to_string()
}

// users.json come oggetto: {"users": {"email": {"nome": "...", "hash": "..."}}}
// Se esiste ancora il vecchissimo formato array, viene migrato davvero (non svuotato).
fn load_users() -> String {
    let fp = data_dir().join("users.json");
    let cur = fs::read_to_string(&fp).unwrap_or("{\"users\":{}}".into());
    if cur.trim_start().starts_with('[') {
        let mut obj = String::from("{\"users\":{");
        let mut first = true;
        // cerca "email":".." e, nella stessa finestra, "nome" e "hash"
        let mut pos = 0;
        while let Some(e) = find_key(&cur[pos..], "\"email\":\"") {
            let a = pos + e;
            let email = take_quoted(&cur[a..]);
            let window = &cur[a..(a + 600).min(cur.len())];
            let nome = find_key(window, "\"nome\":\"")
                .map(|k| take_quoted(&window[k..]))
                .unwrap_or_default();
            let hash = find_key(window, "\"hash\":\"")
                .map(|k| take_quoted(&window[k..]))
                .unwrap_or_default();
            if !email.is_empty() && !hash.is_empty() {
                if !first {
                    obj.push(',');
                }
                first = false;
                obj.push_str(&format!(
                    "\"{}\":{{\"nome\":\"{}\",\"hash\":\"{}\"}}",
                    esc(&email),
                    esc(&nome),
                    hash
                ));
            }
            pos = a + 8;
            if pos >= cur.len() {
                break;
            }
        }
        obj.push_str("}}");
        let _ = fs::write(&fp, &obj);
        return obj;
    }
    cur
}

fn find_key(hay: &str, key: &str) -> Option<usize> {
    hay.find(key).map(|i| i + key.len())
}

fn take_quoted(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            if let Some(n) = it.next() {
                out.push(n);
            }
        } else if c == '"' {
            break;
        } else {
            out.push(c);
        }
    }
    out
}

// estrae il record {"nome":..,"hash":..} di un'email con conteggio delle graffe
// (funziona anche per l'ultimo utente, senza virgola finale)
fn extract_record(users: &str, email: &str) -> Option<String> {
    let needle = format!("\"{}\":", esc(email));
    let start = users.find(&needle)? + needle.len();
    let bytes = users.as_bytes();
    let mut pos = start;
    while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
        pos += 1;
    }
    if bytes.get(pos) != Some(&b'{') {
        return None;
    }
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escaped = false;
    let mut end = pos;
    for (k, &b) in bytes[pos..].iter().enumerate() {
        if in_str {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_str = false;
            }
        } else if b == b'"' {
            in_str = true;
        } else if b == b'{' {
            depth += 1;
        } else if b == b'}' {
            depth -= 1;
            if depth == 0 {
                end = pos + k + 1;
                break;
            }
        }
    }
    if depth != 0 {
        return None;
    }
    Some(users[start..end].to_string())
}

// verifica email+password: hash APPAIATI nello stesso record (mai separati).
// Se l'utente non esiste, verifica comunque contro un hash fittizio
// (tempi di risposta uniformi, niente enumeration via timing).
fn check_user(users: &str, email: &str, pass: &str) -> Option<String> {
    match extract_record(users, email) {
        Some(rec) => {
            let hash = rec.split("\"hash\":\"").nth(1).map(take_quoted).unwrap_or_default();
            if hash.is_empty() || !pw_verify(&hash, pass) {
                return None;
            }
            Some(rec.split("\"nome\":\"").nth(1).map(take_quoted).unwrap_or_default())
        }
        None => {
            let _ = pw_verify(&DUMMY_HASH, pass);
            None
        }
    }
}

fn put_user(email: &str, nome: &str, hash: &str, uid: &str) -> bool {
    with_store(|| {
        let fp = data_dir().join("users.json");
        let users = load_users();
        if users.contains(&format!("\"{}\":", esc(email))) {
            return false;
        }
        let entry = format!(
            "\"{}\":{{\"nome\":\"{}\",\"hash\":\"{}\",\"uid\":\"{}\"}}",
            esc(email),
            esc(nome),
            hash,
            uid
        );
        let next = if users.contains("\"users\":{}") {
            users.replacen("\"users\":{}", &format!("\"users\":{{{}}}", entry), 1)
        } else if users.rfind("}}").is_some() {
            // inserisce prima delle ultime due graffe
            let inner = users.rfind("}}").unwrap();
            let mut s = users.clone();
            s.insert_str(inner, &format!(",{}", entry));
            s
        } else {
            format!("{{\"users\":{{{}}}}}", entry)
        };
        atomic_write(&fp, &next)
    })
}

// Argon2id con salt CSPRNG (formato PHC). Verifica a tempo costante via crate.
fn pw_hash(pass: &str) -> Option<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pass.as_bytes(), &salt)
        .map(|h| h.to_string())
        .ok()
}

fn pw_verify(stored: &str, pass: &str) -> bool {
    let Ok(h) = PasswordHash::new(stored) else {
        return false;
    };
    Argon2::default().verify_password(pass.as_bytes(), &h).is_ok()
}

// ID utente e token: 256 bit da CSPRNG di sistema
fn new_id() -> String {
    let b: [u8; 32] = rand::random();
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn new_token() -> String {
    new_id()
}

// sessions.json: {"sessions": {"token": {"email": "..", "uid": "..", "created": 123}}}
// scadenza assoluta SESSION_TTL_SECS. Ritorna (email, uid).
fn session_uid(token: &str) -> Option<(String, String)> {
    if token.is_empty() {
        return None;
    }
    let fp = data_dir().join("sessions.json");
    let cur = fs::read_to_string(fp).unwrap_or("{\"sessions\":{}}".into());
    let rec = extract_record(&cur, token)?;
    let email = take_quoted(rec.split("\"email\":\"").nth(1)?);
    let uid = rec.split("\"uid\":\"").nth(1).map(take_quoted).unwrap_or_default();
    if email.is_empty() || uid.is_empty() {
        return None;
    }
    let created: u64 = rec
        .split("\"created\":")
        .nth(1)?
        .split([',', '}'])
        .next()?
        .trim()
        .parse()
        .ok()?;
    if now_secs().saturating_sub(created) > SESSION_TTL_SECS {
        return None;
    }
    Some((email, uid))
}

fn store_session(token: &str, email: &str, uid: &str) {
    with_store(|| {
        let fp = data_dir().join("sessions.json");
        let cur = fs::read_to_string(&fp).unwrap_or("{\"sessions\":{}}".into());
        let entry = format!(
            "\"{}\":{{\"email\":\"{}\",\"uid\":\"{}\",\"created\":{}}}",
            token,
            esc(email),
            uid,
            now_secs()
        );
        let next = if cur.contains("\"sessions\":{}") {
            cur.replacen("\"sessions\":{}", &format!("\"sessions\":{{{}}}", entry), 1)
        } else if let Some(inner) = cur.rfind("}}") {
            let mut s = cur.clone();
            s.insert_str(inner, &format!(",{}", entry));
            s
        } else {
            format!("{{\"sessions\":{{{}}}}}", entry)
        };
        atomic_write(&fp, &next)
    });
}

// Rimuove il record "token":{...} con indici esatti (niente regex fragili)
fn remove_record(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\":", esc(key));
    let ks = text.find(&needle)?;
    let bytes = text.as_bytes();
    let mut pos = ks + needle.len();
    while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
        pos += 1;
    }
    if bytes.get(pos) != Some(&b'{') {
        return None;
    }
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escaped = false;
    let mut end = pos;
    for (k, &b) in bytes[pos..].iter().enumerate() {
        if in_str {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_str = false;
            }
        } else if b == b'"' {
            in_str = true;
        } else if b == b'{' {
            depth += 1;
        } else if b == b'}' {
            depth -= 1;
            if depth == 0 {
                end = pos + k + 1;
                break;
            }
        }
    }
    if depth != 0 {
        return None;
    }
    // allarga alla virgola adiacente per non lasciare "{}" sporchi
    let mut a = ks;
    let mut b = end;
    let before: String = text[..ks].chars().rev().take_while(|c| c.is_whitespace()).collect();
    let _ = before;
    if end < text.len() && text[end..].starts_with(',') {
        b = end + 1;
    } else {
        let prev = text[..ks].trim_end();
        if prev.ends_with(',') {
            a = ks - (text[..ks].len() - prev.len()) - 1;
        }
    }
    let mut s = text.to_string();
    s.replace_range(a..b, "");
    Some(s)
}

fn remove_session(token: &str) -> bool {
    with_store(|| {
        let fp = data_dir().join("sessions.json");
        let cur = fs::read_to_string(&fp).unwrap_or("{\"sessions\":{}}".into());
        match remove_record(&cur, token) {
            Some(next) => atomic_write(&fp, &next),
            None => false,
        }
    })
}

// Assicura un uid immutabile all'utente (migra i record pre-uid al login).
// Ritorna l'uid esistente o appena assegnato.
fn ensure_uid(email: &str) -> Option<String> {
    with_store(|| {
        let fp = data_dir().join("users.json");
        let users = load_users();
        let rec = extract_record(&users, email)?;
        if let Some(uid) = rec.split("\"uid\":\"").nth(1).map(take_quoted) {
            if !uid.is_empty() {
                return Some(uid);
            }
        }
        let uid = new_id();
        let needle = format!("\"{}\":", esc(email));
        let rec_start = users.find(&needle)? + needle.len();
        // inserisce "uid" come primo campo del record (dopo la graffa aperta)
        let mut s = users.clone();
        s.insert_str(rec_start + 1, &format!("\"uid\":\"{}\",", uid));
        atomic_write(&fp, &s).then_some(uid)
    })
}

// File dati per uid immutabile. Migra una tantum il vecchio file per email sanitizzata.
fn user_file(kind: &str, email: &str, uid: &str) -> PathBuf {
    let fp = data_dir().join(format!("{}_{}.json", kind, uid));
    if !fp.exists() {
        let legacy = data_dir().join(format!("{}_{}.json", kind, safe_email(email)));
        if legacy.exists() {
            let _ = fs::rename(&legacy, &fp);
        }
    }
    fp
}

fn safe_email(email: &str) -> String {
    email
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '@' || *c == '.' || *c == '-' || *c == '_')
        .collect::<String>()
        .replace('@', "_at_")
}

fn bearer(headers: &[String]) -> String {
    for h in headers {
        let l = h.to_ascii_lowercase();
        if let Some(v) = l.strip_prefix("authorization:") {
            let v = v.trim();
            if let Some(t) = v.strip_prefix("bearer ") {
                return t.trim().to_string();
            }
        }
    }
    String::new()
}

fn handle(stream: TcpStream) {
    if ACTIVE.fetch_add(1, Ordering::SeqCst) >= MAX_THREADS {
        ACTIVE.fetch_sub(1, Ordering::SeqCst);
        let mut s = stream;
        send(&mut s, "HTTP/1.1 503 Service Unavailable", r#"{"error":"troppi collegamenti"}"#);
        return;
    }
    let res = handle_inner(stream);
    ACTIVE.fetch_sub(1, Ordering::SeqCst);
    let _ = res;
}

fn handle_inner(mut stream: TcpStream) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut req_line = String::new();
    if reader.read_line(&mut req_line)? == 0 {
        return Ok(());
    }
    let parts: Vec<&str> = req_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Ok(());
    }
    let method = parts[0].to_string();
    let path = parts[1].to_string();

    let mut headers: Vec<String> = Vec::new();
    let mut len: usize = 0;
    loop {
        let mut h = String::new();
        reader.read_line(&mut h)?;
        if h == "\r\n" || h == "\n" || h.is_empty() {
            break;
        }
        if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
            len = v.trim().parse().unwrap_or(0);
        }
        headers.push(h.trim_end().to_string());
    }
    // rifiuto anticipato input sovradimensionato, prima di allocare/leggere il corpo
    if len > (1 << 20) {
        send(&mut stream, "HTTP/1.1 413 Payload Too Large", r#"{"error":"payload troppo grande"}"#);
        return Ok(());
    }
    let mut body = vec![0u8; len];
    if len > 0 {
        reader.read_exact(&mut body)?;
    }
    let body_s = String::from_utf8_lossy(&body).to_string();
    drop(reader);

    if method == "OPTIONS" {
        send(&mut stream, "HTTP/1.1 200 OK", "{}");
        return Ok(());
    }

    if path == "/api/health" || path.starts_with("/api/health?") {
        send(&mut stream, "HTTP/1.1 200 OK", r#"{"ok":true,"service":"camperisti-backend"}"#);
        return Ok(());
    }

    if path.starts_with("/api/areas") && method == "GET" {
        let reg = get_query(&path, "regione").unwrap_or("campania".into());
        let safe: String = reg.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        let fp = frontend_data_path(&safe);
        match fs::read_to_string(&fp) {
            Ok(c) => send(&mut stream, "HTTP/1.1 200 OK", &c),
            Err(_) => send(&mut stream, "HTTP/1.1 404 Not Found", r#"{"error":"regione non trovata"}"#),
        }
        return Ok(());
    }

    // (data_dir risolto dalle helper user_file/store_session/...)
    let peer = stream
        .peer_addr()
        .map(|a| a.ip().to_string())
        .unwrap_or("?".to_string());

    // rate limiting su tutte le rotte auth, per IP client reale
    // (X-Forwarded-For vale solo da proxy fidati, vedi TRUSTED_PROXIES)
    let client = client_ip(&headers, &peer);
    let is_auth = path.starts_with("/api/auth/") && method == "POST";
    if is_auth && !rate_ok(&client) {
        send_extra(
            &mut stream,
            "HTTP/1.1 429 Too Many Requests",
            r#"{"error":"troppi tentativi, riprova fra un minuto"}"#,
            "Retry-After: 60\r\n",
        );
        return Ok(());
    }

    if path == "/api/auth/register" && method == "POST" {
        let email = jval(&body_s, "email").to_lowercase();
        let pass = jval(&body_s, "pass");
        let nome = jval(&body_s, "nome");
        if !valid_email(&email) || !valid_pass(&pass) || !valid_nome(&nome) {
            send(&mut stream, "HTTP/1.1 400 Bad Request", r#"{"error":"email non valida, password min 8 caratteri, nome max 80"}"#);
            return Ok(());
        }
        let Some(h) = pw_hash(&pass) else {
            send(&mut stream, "HTTP/1.1 500 Internal Server Error", r#"{"error":"errore interno"}"#);
            return Ok(());
        };
        if !put_user(&email, &nome, &h, &new_id()) {
            send(&mut stream, "HTTP/1.1 409 Conflict", r#"{"error":"utente già registrato"}"#);
            return Ok(());
        }
        let Some(uid) = ensure_uid(&email) else {
            send(&mut stream, "HTTP/1.1 500 Internal Server Error", r#"{"error":"errore interno"}"#);
            return Ok(());
        };
        let tok = new_token();
        store_session(&tok, &email, &uid);
        let out = format!(
            "{}\"ok\":true,\"email\":\"{}\",\"nome\":\"{}\",\"uid\":\"{}\",\"token\":\"{}\"{}",
            "{", esc(&email), esc(&nome), uid, tok, "}"
        );
        send(&mut stream, "HTTP/1.1 200 OK", &out);
        return Ok(());
    }

    if path == "/api/auth/login" && method == "POST" {
        let email = jval(&body_s, "email").to_lowercase();
        let pass = jval(&body_s, "pass");
        // stessa unità della registrazione (caratteri, non byte): niente 400 su
        // password lunghe ma valide, solo 401 generico per non dare oracoli
        if !valid_email(&email) || pass.is_empty() {
            send(&mut stream, "HTTP/1.1 400 Bad Request", r#"{"error":"richiesta non valida"}"#);
            return Ok(());
        }
        let users = load_users();
        match check_user(&users, &email, &pass) {
            Some(nome) => {
                let Some(uid) = ensure_uid(&email) else {
                    send(&mut stream, "HTTP/1.1 500 Internal Server Error", r#"{"error":"errore interno"}"#);
                    return Ok(());
                };
                let tok = new_token();
                store_session(&tok, &email, &uid);
                let out = format!(
                    "{}\"ok\":true,\"email\":\"{}\",\"nome\":\"{}\",\"uid\":\"{}\",\"token\":\"{}\"{}",
                    "{", esc(&email), esc(&nome), uid, tok, "}"
                );
                send(&mut stream, "HTTP/1.1 200 OK", &out);
            }
            None => send(&mut stream, "HTTP/1.1 401 Unauthorized", r#"{"error":"credenziali non valide"}"#),
        }
        return Ok(());
    }

    if path == "/api/auth/logout" && method == "POST" {
        let tok = bearer(&headers);
        if tok.is_empty() || !remove_session(&tok) {
            send(&mut stream, "HTTP/1.1 401 Unauthorized", r#"{"error":"sessione richiesta"}"#);
        } else {
            send(&mut stream, "HTTP/1.1 200 OK", r#"{"ok":true}"#);
        }
        return Ok(());
    }

    // ---- rotte autenticate: identità SOLO dal token Bearer (uid immutabile) ----
    if path.starts_with("/api/favorites") || path.starts_with("/api/trips") {
        let (email, uid) = match session_uid(&bearer(&headers)) {
            Some(v) => v,
            None => {
                send(&mut stream, "HTTP/1.1 401 Unauthorized", r#"{"error":"sessione richiesta"}"#);
                return Ok(());
            }
        };
        let kind = if path.starts_with("/api/favorites") { "favs" } else { "trips" };
        let fp = user_file(kind, &email, &uid);
        if method == "GET" {
            let c = fs::read_to_string(&fp).unwrap_or(if kind == "favs" {
                "{\"favs\":{}}".into()
            } else {
                "{\"trips\":[]}".into()
            });
            send(&mut stream, "HTTP/1.1 200 OK", &c);
        } else if method == "POST" {
            if body_s.len() > (1 << 20) {
                send(&mut stream, "HTTP/1.1 413 Payload Too Large", r#"{"error":"payload troppo grande"}"#);
            } else if with_store(|| atomic_write(&fp, &body_s)) {
                send(&mut stream, "HTTP/1.1 200 OK", r#"{"ok":true}"#);
            } else {
                send(&mut stream, "HTTP/1.1 500 Internal Server Error", r#"{"error":"salvataggio non riuscito"}"#);
            }
        } else {
            send(&mut stream, "HTTP/1.1 405 Method Not Allowed", r#"{"error":"metodo non supportato"}"#);
        }
        return Ok(());
    }

    send(&mut stream, "HTTP/1.1 404 Not Found", r#"{"error":"not found"}"#);
    Ok(())
}

fn main() {
    // Bind solo locale di default; per Internet: reverse proxy con TLS davanti,
    // mai esporre questo socket direttamente (niente TLS integrato di proposito).
    let addr = std::env::var("BIND_ADDR").unwrap_or("127.0.0.1:3001".to_string());
    LazyLock::force(&DUMMY_HASH);
    LazyLock::force(&CORS_ORIGIN);
    let listener = TcpListener::bind(&addr).expect("bind");
    println!("Camperisti backend attivo su http://{} (CORS: {})", addr, *CORS_ORIGIN);
    println!("API: /api/health /api/areas /api/auth/* /api/favorites /api/trips (Bearer)");
    for s in listener.incoming() {
        if let Ok(st) = s {
            // nessun thread creato oltre il limite: connessione scartata subito
            if ACTIVE.load(Ordering::SeqCst) >= MAX_THREADS {
                continue;
            }
            let _ = st.set_read_timeout(Some(std::time::Duration::from_secs(15)));
            std::thread::spawn(move || handle(st));
        }
    }
}
