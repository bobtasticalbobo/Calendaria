//! Home-network sync transport. Rust only moves bytes: it serves one HTTP
//! endpoint, posts to other devices, and finds them with mDNS. What is sent is
//! encrypted, decrypted and merged by the app (src/sync/lan.ts), so nothing
//! here ever sees calendar data in the clear.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, mpsc};
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const SERVICE: &str = "_calendaria._tcp.local.";
/// Largest request or reply accepted: a whole encrypted database.
const MAX_BODY: u64 = 64 << 20;

#[derive(Default)]
pub struct Lan {
    pending: Mutex<HashMap<u64, mpsc::Sender<(u16, String)>>>,
    next: AtomicU64,
    port: Mutex<Option<u16>>,
    mdns: Mutex<Option<ServiceDaemon>>,
}

impl Lan {
    fn daemon(&self) -> Result<ServiceDaemon, String> {
        let mut mdns = self.mdns.lock().unwrap();
        if mdns.is_none() {
            *mdns = Some(ServiceDaemon::new().map_err(|e| e.to_string())?);
        }
        Ok(mdns.clone().unwrap())
    }
}

/// A request from another device, handed to the app to answer with `lan_reply`.
#[derive(Clone, Serialize)]
struct Incoming {
    id: u64,
    body: String,
}

/// Another Calendaria found on the network.
#[derive(Serialize)]
pub struct Found {
    id: String,
    name: String,
    /// Which sync group the device is in (a hash, not the key).
    group: String,
    port: u16,
    addresses: Vec<String>,
}

/// Starts the sync server (once) and returns its port. Tries `preferred` first
/// so the port stays the same between launches.
#[tauri::command]
pub fn lan_serve(app: AppHandle, lan: State<'_, Lan>, preferred: u16) -> Result<u16, String> {
    let mut port = lan.port.lock().unwrap();
    if let Some(p) = *port {
        return Ok(p);
    }
    let server = tiny_http::Server::http(("0.0.0.0", preferred))
        .or_else(|_| tiny_http::Server::http(("0.0.0.0", 0)))
        .map_err(|e| e.to_string())?;
    let actual = server.server_addr().to_ip().map(|a| a.port()).ok_or("no port")?;
    *port = Some(actual);
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let app = app.clone();
            std::thread::spawn(move || handle(&app, request));
        }
    });
    Ok(actual)
}

fn handle(app: &AppHandle, mut request: tiny_http::Request) {
    fn respond(request: tiny_http::Request, status: u16, body: String) {
        let _ = request.respond(tiny_http::Response::from_string(body).with_status_code(status));
    }
    if request.method() != &tiny_http::Method::Post || request.url() != "/calendaria" {
        return respond(request, 404, String::new());
    }
    let mut body = String::new();
    if std::io::Read::read_to_string(&mut std::io::Read::take(request.as_reader(), MAX_BODY), &mut body).is_err() {
        return respond(request, 400, String::new());
    }
    let lan = app.state::<Lan>();
    let id = lan.next.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    lan.pending.lock().unwrap().insert(id, tx);
    let reply = match app.emit("lan-request", Incoming { id, body }) {
        Ok(()) => rx.recv_timeout(Duration::from_secs(60)).ok(),
        Err(_) => None,
    };
    lan.pending.lock().unwrap().remove(&id);
    match reply {
        Some((status, body)) => respond(request, status, body),
        None => respond(request, 503, String::new()),
    }
}

/// The app's answer to an `Incoming` request.
#[tauri::command]
pub fn lan_reply(lan: State<'_, Lan>, id: u64, status: u16, body: String) {
    if let Some(tx) = lan.pending.lock().unwrap().remove(&id) {
        let _ = tx.send((status, body));
    }
}

/// Posts to another device's sync server. Returns the status and body.
#[tauri::command]
pub async fn lan_post(url: String, body: String, connect_ms: u64) -> Result<(u16, String), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_connect(Some(Duration::from_millis(connect_ms)))
            .timeout_global(Some(Duration::from_secs(60)))
            .http_status_as_error(false)
            .build()
            .into();
        let mut res = agent
            .post(&url)
            .content_type("application/json")
            .send(body)
            .map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        let text = res
            .body_mut()
            .with_config()
            .limit(MAX_BODY)
            .read_to_string()
            .map_err(|e| e.to_string())?;
        Ok((status, text))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Announces this device on the local network, so the others find it even
/// when its address changes.
#[tauri::command]
pub fn lan_advertise(lan: State<'_, Lan>, id: String, name: String, group: String, port: u16) -> Result<(), String> {
    let mdns = lan.daemon()?;
    let host = format!("calendaria-{}.local.", &id[id.len().saturating_sub(12)..]);
    let props = [("id", id.as_str()), ("name", name.as_str()), ("g", group.as_str())];
    let info = ServiceInfo::new(SERVICE, &id, &host, "", port, &props[..])
        .map_err(|e| e.to_string())?
        .enable_addr_auto();
    mdns.register(info).map_err(|e| e.to_string())
}

/// Looks for other devices for `ms` milliseconds.
#[tauri::command]
pub async fn lan_browse(lan: State<'_, Lan>, ms: u64) -> Result<Vec<Found>, String> {
    let mdns = lan.daemon()?;
    tauri::async_runtime::spawn_blocking(move || {
        let events = mdns.browse(SERVICE).map_err(|e| e.to_string())?;
        let until = Instant::now() + Duration::from_millis(ms);
        let mut found: HashMap<String, Found> = HashMap::new();
        while let Some(left) = until.checked_duration_since(Instant::now()) {
            let Ok(event) = events.recv_timeout(left) else { break };
            if let ServiceEvent::ServiceResolved(info) = event {
                let Some(id) = info.get_property_val_str("id").map(str::to_string) else { continue };
                let name = info.get_property_val_str("name").unwrap_or_default().to_string();
                let group = info.get_property_val_str("g").unwrap_or_default().to_string();
                let addresses = info.get_addresses_v4().iter().map(|a| a.to_string()).collect();
                found.insert(id.clone(), Found { id, name, group, port: info.get_port(), addresses });
            }
        }
        let _ = mdns.stop_browse(SERVICE);
        Ok(found.into_values().collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// This device's IPv4 addresses, for the pairing code. Includes a Tailscale
/// address (100.x) when Tailscale is running, which is what lets the others
/// reach this device away from home.
#[tauri::command]
pub fn lan_addresses() -> Vec<String> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(ip) if !ip.is_link_local() => Some(ip.to_string()),
            _ => None,
        })
        .collect()
}

/// A name for this device that the others show, e.g. the PC's computer name.
#[tauri::command]
pub fn lan_device_name() -> String {
    if cfg!(target_os = "android") {
        return "Phone".into();
    }
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .or_else(|_| std::fs::read_to_string("/etc/hostname").map(|s| s.trim().to_string()))
        .unwrap_or_else(|_| "Computer".into())
}
