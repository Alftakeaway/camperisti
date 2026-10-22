use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ACTIVE: AtomicUsize = AtomicUsize::new(0);
const MAX_THREADS: usize = 32;

// NOTA: backend dimostrativo per uso locale. Prima di esporlo su Internet servono:
// password hashing (argon2), TLS, rate limiting, DB transazionale, backup.

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
    let resp = format!(
        "{}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
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

// estrae "campo":"valore" dal body json (parser minimale per payload noti)
fn jval(body: &str, key: &str) -> String {
    let pat = format!("\"{}\"", key);
    let Some(i) = body.find(&pat) else { return String::new() };
    let rest = &body[i + pat.len()..];
    let Some(c) = rest.find(':') else { return String::new() };
    let v = rest[c + 1..].trim_start();
    if let Some(stripped) = v.strip_prefix('"') {
        if let Some(end) = stripped.find('"') {
            return stripped[..end].to_string();
        }
        return String::new();
    }
    let end = v.find(&[',', '}', '\n'][..]).unwrap_or(v.len());
    v[..end].trim().trim_matches('"').to_string()
}

// users.json come oggetto: {"email": {"nome": "...", "hash": "..."}}
fn load_users() -> String {
    let fp = data_dir().join("users.json");
    let cur = fs::read_to_string(&fp).unwrap_or("{\"users\":{}}".into());
    if cur.trim_start().starts_with('[') {
        // migra vecchio formato array -> oggetto (email+hash già appaiati)
        return "{\"users\":{}}".to_string();
    }
    cur
}

// verifica email+hash APPAIATI nello stesso record (mai separati)
fn check_user(users: &str, email: &str, hash: &str) -> Option<String> {
    let needle = format!("\"{}\":", esc(email));
    let i = users.find(&needle)?;
    let rec = &users[i + needle.len()..];
    let end = rec.find("\n},").or_else(|| rec.find("},"))?;
    let rec = &rec[..end];
    if !rec.contains(&format!("\"hash\":\"{}\"", hash)) {
        return None;
    }
    let nome = rec
        .split("\"nome\":\"")
        .nth(1)
        .map(|s| s.split('"').next().unwrap_or("").to_string())
        .unwrap_or_default();
    Some(nome)
}

fn put_user(email: &str, nome: &str, hash: &str) -> bool {
    let fp = data_dir().join("users.json");
    let mut users = load_users();
    if users.contains(&format!("\"{}\":", esc(email))) {
        return false;
    }
    let entry = format!("\"{}\":{{\"nome\":\"{}\",\"hash\":\"{}\"}}", esc(email), esc(nome), hash);
    users = if users.contains("\"users\":{}") {
        users.replacen("\"users\":{}", &format!("\"users\":{{{}}}", entry), 1)
    } else if let Some(pos) = users.rfind('}') {
        // chiudi oggetto annidato: inserisci prima delle ultime due graffe
        let inner = users.rfind("}}").unwrap_or(pos);
        let mut s = users.clone();
        s.insert_str(inner, &format!(",{}", entry));
        s
    } else {
        format!("{{\"users\":{{{}}}}}", entry)
    };
    fs::write(&fp, users).is_ok()
}

fn pw_hash(pass: &str, salt: &str) -> String {
    let mut h = DefaultHasher::new();
    format!("{}::{}", salt, pass).hash(&mut h);
    format!("{:016x}", h.finish())
}

fn new_token(email: &str) -> String {
    static CTR: AtomicUsize = AtomicUsize::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut h = DefaultHasher::new();
    (nanos, CTR.fetch_add(1, Ordering::SeqCst), email).hash(&mut h);
    format!("{:016x}{:016x}", h.finish(), nanos & 0xffffffffffffffff)
}

// sessions.json: {"token": {"email": "...", "created": 123}}
fn session_email(token: &str) -> Option<String> {
    if token.is_empty() {
        return None;
    }
    let fp = data_dir().join("sessions.json");
    let cur = fs::read_to_string(fp).unwrap_or("{\"sessions\":{}}".into());
    let needle = format!("\"{}\":", token);
    let i = cur.find(&needle)?;
    let rec = &cur[i + needle.len()..];
    let email = rec.split("\"email\":\"").nth(1)?.split('"').next()?.to_string();
    if email.is_empty() {
        return None;
    }
    Some(email)
}

fn store_session(token: &str, email: &str) {
    let fp = data_dir().join("sessions.json");
    let mut cur = fs::read_to_string(&fp).unwrap_or("{\"sessions\":{}}".into());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let entry = format!("\"{}\":{{\"email\":\"{}\",\"created\":{}}}", token, esc(email), nanos);
    cur = if cur.contains("\"sessions\":{}") {
        cur.replacen("\"sessions\":{}", &format!("\"sessions\":{{{}}}", entry), 1)
    } else if let Some(inner) = cur.rfind("}}") {
        let mut s = cur.clone();
        s.insert_str(inner, &format!(",{}", entry));
        s
    } else {
        format!("{{\"sessions\":{{{}}}}}", entry)
    };
    let _ = fs::write(&fp, cur);
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
    let mut body = vec![0u8; len.min(1 << 20)];
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

    let dd = data_dir();

    if path == "/api/auth/register" && method == "POST" {
        let email = jval(&body_s, "email").to_lowercase();
        let pass = jval(&body_s, "pass");
        let nome = jval(&body_s, "nome");
        if email.is_empty() || pass.len() < 4 {
            send(&mut stream, "HTTP/1.1 400 Bad Request", r#"{"error":"email e password (min 4) obbligatorie"}"#);
            return Ok(());
        }
        let h = pw_hash(&pass, &email);
        if !put_user(&email, &nome, &h) {
            send(&mut stream, "HTTP/1.1 409 Conflict", r#"{"error":"utente già registrato"}"#);
            return Ok(());
        }
        let tok = new_token(&email);
        store_session(&tok, &email);
        let out = format!(
            "{}\"ok\":true,\"email\":\"{}\",\"nome\":\"{}\",\"token\":\"{}\"{}",
            "{", esc(&email), esc(&nome), tok, "}"
        );
        send(&mut stream, "HTTP/1.1 200 OK", &out);
        return Ok(());
    }

    if path == "/api/auth/login" && method == "POST" {
        let email = jval(&body_s, "email").to_lowercase();
        let pass = jval(&body_s, "pass");
        let users = load_users();
        let h = pw_hash(&pass, &email);
        match check_user(&users, &email, &h) {
            Some(nome) => {
                let tok = new_token(&email);
                store_session(&tok, &email);
                let out = format!(
                    "{}\"ok\":true,\"email\":\"{}\",\"nome\":\"{}\",\"token\":\"{}\"{}",
                    "{", esc(&email), esc(&nome), tok, "}"
                );
                send(&mut stream, "HTTP/1.1 200 OK", &out);
            }
            None => send(&mut stream, "HTTP/1.1 401 Unauthorized", r#"{"error":"credenziali non valide"}"#),
        }
        return Ok(());
    }

    // ---- rotte autenticate: identità SOLO dal token Bearer ----
    if path.starts_with("/api/favorites") || path.starts_with("/api/trips") {
        let email = match session_email(&bearer(&headers)) {
            Some(e) => e,
            None => {
                send(&mut stream, "HTTP/1.1 401 Unauthorized", r#"{"error":"sessione richiesta"}"#);
                return Ok(());
            }
        };
        let kind = if path.starts_with("/api/favorites") { "favs" } else { "trips" };
        let fp = dd.join(format!("{}_{}.json", kind, safe_email(&email)));
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
            } else {
                let _ = fs::write(&fp, &body_s);
                send(&mut stream, "HTTP/1.1 200 OK", r#"{"ok":true}"#);
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
    let addr = "127.0.0.1:3001";
    let listener = TcpListener::bind(addr).expect("bind 3001");
    println!("Camperisti backend attivo su http://{} (solo locale)", addr);
    println!("API: /api/health /api/areas /api/auth/* /api/favorites /api/trips (Bearer)");
    for s in listener.incoming() {
        if let Ok(st) = s {
            std::thread::spawn(move || handle(st));
        }
    }
}
