use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;

fn data_dir() -> PathBuf {
    let mut p = std::env::current_dir().unwrap_or(PathBuf::from("."));
    // se lanciato da backend/, data = backend/data ; se da root, backend/data
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
        "{}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn get_query(path: &str, key: &str) -> Option<String> {
    let q = path.split('?').nth(1)?;
    for kv in q.split('&') {
        let mut it = kv.splitn(2, '=');
        if let (Some(k), Some(v)) = (it.next(), it.next()) {
            if k == key {
                return Some(v.to_string());
            }
        }
    }
    None
}

// estrae valore "campo":"valore" in modo naif dal body json
fn jval(body: &str, key: &str) -> String {
    let pat = format!("\"{}\"", key);
    if let Some(i) = body.find(&pat) {
        let rest = &body[i + pat.len()..];
        if let Some(c) = rest.find(':') {
            let v = rest[c + 1..].trim_start();
            if v.starts_with('"') {
                if let Some(end) = v[1..].find('"') {
                    return v[1..1 + end].to_string();
                }
            } else {
                let end = v.find(&[',', '}', '\n'][..]).unwrap_or(v.len());
                return v[..end].trim().trim_matches('"').to_string();
            }
        }
    }
    String::new()
}

fn handle(stream: TcpStream) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut req_line = String::new();
    if reader.read_line(&mut req_line).is_err() || req_line.is_empty() {
        return;
    }
    let parts: Vec<&str> = req_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0].to_string();
    let path = parts[1].to_string();

    let mut len: usize = 0;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).is_err() {
            return;
        }
        if h == "\r\n" || h == "\n" || h.is_empty() {
            break;
        }
        if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
            len = v.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0u8; len];
    if len > 0 {
        let _ = reader.read_exact(&mut body);
    }
    let body_s = String::from_utf8_lossy(&body).to_string();
    // ri-prendo ownership dello stream
    drop(reader);
    let mut stream = stream;

    if method == "OPTIONS" {
        send(&mut stream, "HTTP/1.1 200 OK", "{}");
        return;
    }

    // health
    if path == "/api/health" || path.starts_with("/api/health?") {
        send(&mut stream, "HTTP/1.1 200 OK", r#"{"ok":true,"service":"camperisti-backend"}"#);
        return;
    }

    // areas: GET /api/areas?regione=campania
    if path.starts_with("/api/areas") && method == "GET" {
        let reg = get_query(&path, "regione").unwrap_or("campania".into());
        let safe: String = reg.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        let fp = frontend_data_path(&safe);
        match fs::read_to_string(&fp) {
            Ok(c) => send(&mut stream, "HTTP/1.1 200 OK", &c),
            Err(_) => send(&mut stream, "HTTP/1.1 404 Not Found", r#"{"error":"regione non trovata"}"#),
        }
        return;
    }

    let dd = data_dir();

    // register
    if path == "/api/auth/register" && method == "POST" {
        let email = jval(&body_s, "email").to_lowercase();
        let pass = jval(&body_s, "pass");
        let nome = jval(&body_s, "nome");
        if email.is_empty() || pass.is_empty() {
            send(&mut stream, "HTTP/1.1 400 Bad Request", r#"{"error":"email e password obbligatorie"}"#);
            return;
        }
        let fp = dd.join("users.json");
        let cur = fs::read_to_string(&fp).unwrap_or("[]".into());
        if cur.contains(&format!("\"email\":\"{}\"", esc(&email))) {
            send(&mut stream, "HTTP/1.1 409 Conflict", r#"{"error":"utente già registrato"}"#);
            return;
        }
        // hash dimostrativo (non per produzione): somma byte
        let h: u64 = pass.bytes().fold(0, |a, b| a.wrapping_add(b as u64).wrapping_mul(31));
        let entry = format!(
            "{}\"email\":\"{}\",\"nome\":\"{}\",\"hash\":\"{}\"{}",
            "{", esc(&email), esc(&nome), h, "}"
        );
        let next = if cur.trim() == "[]" {
            format!("[{}]", entry)
        } else {
            let t = cur.trim_end_matches(|c| c == ']' || c == '\n' || c == ' ');
            format!("{},{}]", t, entry)
        };
        let _ = fs::write(&fp, next);
        let out = format!(
            "{}\"ok\":true,\"email\":\"{}\",\"nome\":\"{}\",\"token\":\"tok-{}\"{}",
            "{",
            esc(&email),
            esc(&nome),
            esc(&email),
            "}"
        );
        send(&mut stream, "HTTP/1.1 200 OK", &out);
        return;
    }

    // login
    if path == "/api/auth/login" && method == "POST" {
        let email = jval(&body_s, "email").to_lowercase();
        let pass = jval(&body_s, "pass");
        let fp = dd.join("users.json");
        let cur = fs::read_to_string(&fp).unwrap_or("[]".into());
        let h: u64 = pass.bytes().fold(0, |a, b| a.wrapping_add(b as u64).wrapping_mul(31));
        let needle = format!("\"email\":\"{}\",\"nome\":\"", esc(&email));
        if cur.contains(&format!("\"email\":\"{}\"", esc(&email)))
            && cur.contains(&format!("\"hash\":\"{}\"", h))
        {
            let nome = cur
                .split(&needle)
                .nth(1)
                .map(|s| s.split('"').next().unwrap_or("").to_string())
                .unwrap_or_default();
            let out = format!(
                "{}\"ok\":true,\"email\":\"{}\",\"nome\":\"{}\",\"token\":\"tok-{}\"{}",
                "{",
                esc(&email),
                esc(&nome),
                esc(&email),
                "}"
            );
            send(&mut stream, "HTTP/1.1 200 OK", &out);
        } else {
            send(&mut stream, "HTTP/1.1 401 Unauthorized", r#"{"error":"credenziali non valide"}"#);
        }
        return;
    }

    // favorites: GET ?email= / POST {email, favs:[...]}
    if path.starts_with("/api/favorites") {
        if method == "GET" {
            let email = get_query(&path, "email").unwrap_or_default().to_lowercase();
            let safe: String = email.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '@' || *c == '.' || *c == '-' || *c == '_').collect();
            let fp = dd.join(format!("favs_{}.json", safe.replace('@', "_at_")));
            let c = fs::read_to_string(&fp).unwrap_or("{\"favs\":[]}".into());
            send(&mut stream, "HTTP/1.1 200 OK", &c);
            return;
        } else if method == "POST" {
            let email = jval(&body_s, "email").to_lowercase();
            let safe: String = email.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '@' || *c == '.' || *c == '-' || *c == '_').collect();
            let fp = dd.join(format!("favs_{}.json", safe.replace('@', "_at_")));
            let _ = fs::write(&fp, &body_s);
            send(&mut stream, "HTTP/1.1 200 OK", r#"{"ok":true}"#);
            return;
        }
    }

    // itineraries: GET ?email= / POST raw
    if path.starts_with("/api/trips") {
        if method == "GET" {
            let email = get_query(&path, "email").unwrap_or_default().to_lowercase();
            let safe: String = email.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '@' || *c == '.' || *c == '-' || *c == '_').collect();
            let fp = dd.join(format!("trips_{}.json", safe.replace('@', "_at_")));
            let c = fs::read_to_string(&fp).unwrap_or("{\"trips\":[]}".into());
            send(&mut stream, "HTTP/1.1 200 OK", &c);
            return;
        } else if method == "POST" {
            let email = jval(&body_s, "email").to_lowercase();
            let safe: String = email.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '@' || *c == '.' || *c == '-' || *c == '_').collect();
            let fp = dd.join(format!("trips_{}.json", safe.replace('@', "_at_")));
            let _ = fs::write(&fp, &body_s);
            send(&mut stream, "HTTP/1.1 200 OK", r#"{"ok":true}"#);
            return;
        }
    }

    send(&mut stream, "HTTP/1.1 404 Not Found", r#"{"error":"not found"}"#);
}

fn main() {
    let addr = "127.0.0.1:3001";
    let listener = TcpListener::bind(addr).expect("bind 3001");
    println!("Camperisti backend attivo su http://{} (solo std, zero dipendenze)", addr);
    println!("API: /api/health /api/areas?regione=campania /api/auth/register /api/auth/login /api/favorites /api/trips");
    for s in listener.incoming() {
        if let Ok(st) = s {
            std::thread::spawn(move || handle(st));
        }
    }
}
