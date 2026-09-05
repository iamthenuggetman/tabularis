//! System color-scheme detection via the XDG Settings portal (Linux).
//!
//! WebKitGTK answers the CSS `prefers-color-scheme` media query from the
//! legacy `gtk-theme-name` setting, which GNOME no longer changes when the
//! user toggles dark style (upstream: tauri-apps/tauri#9427). The canonical
//! signal on Linux is the `org.freedesktop.appearance` / `color-scheme` key
//! of the `org.freedesktop.portal.Settings` portal, so the Follow System
//! theme mode reads it here and listens for `SettingChanged` signals.


/// Maps the portal's `color-scheme` value to a scheme name.
///
/// Portal values: `0` = no preference, `1` = dark, `2` = light. Any other
/// value is treated as no preference (light), matching the CSS media query
/// semantics this read replaces.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn map_color_scheme(value: u32) -> &'static str {
    if value == 1 {
        "dark"
    } else {
        "light"
    }
}

#[cfg(target_os = "linux")]
mod portal {
    use super::map_color_scheme;
    use zbus::blocking::connection::Builder;
    use zbus::zvariant::{OwnedValue, Value};

    /// Tauri event emitted whenever the portal reports a new color scheme.
    /// Payload is `"light"` or `"dark"`.
    pub(super) const COLOR_SCHEME_EVENT: &str = "system-color-scheme-changed";

    const PORTAL_SERVICE: &str = "org.freedesktop.portal.Desktop";
    const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
    const PORTAL_SETTINGS_INTERFACE: &str = "org.freedesktop.portal.Settings";
    const APPEARANCE_NAMESPACE: &str = "org.freedesktop.appearance";
    const COLOR_SCHEME_KEY: &str = "color-scheme";

    /// Reads the current color scheme with a one-shot portal `Read` call.
    pub fn read_color_scheme() -> Result<String, String> {
        let connection = session_connection()?;
        let proxy = Proxy::new(
            &connection,
            PORTAL_SERVICE,
            PORTAL_PATH,
            PORTAL_SETTINGS_INTERFACE,
        )
        .map_err(|e| format!("Failed to create portal settings proxy: {e}"))?;
        let value: OwnedValue = proxy
            .call("Read", &(APPEARANCE_NAMESPACE, COLOR_SCHEME_KEY))
            .map_err(|e| format!("Portal color-scheme read failed: {e}"))?;
        let raw = match &*value {
            Value::U32(v) => *v,
            other => {
                return Err(format!(
                    "Portal returned unexpected color-scheme type: {other:?}"
                ))
            }
        };
        Ok(map_color_scheme(raw).to_string())
    }

    /// Subscribes to portal `SettingChanged` signals, invoking `emit` for
    /// every `color-scheme` change. Blocks its calling thread and keeps the
    /// connection alive until the portal stream ends; spawn it on a
    /// dedicated thread.
    pub fn watch_color_scheme(emit: impl Fn(String) + Send + 'static) -> Result<(), String> {
        let connection = session_connection()?;
        let proxy = Proxy::new(
            &connection,
            PORTAL_SERVICE,
            PORTAL_PATH,
            PORTAL_SETTINGS_INTERFACE,
        )
        .map_err(|e| format!("Failed to create portal settings proxy: {e}"))?;
        let signals = proxy
            .receive_signal("SettingChanged")
            .map_err(|e| format!("Failed to subscribe to portal signals: {e}"))?;
        for message in signals {
            let payload = message.body().deserialize::<(String, String, OwnedValue)>();
            let (namespace, key, value) = match payload {
                Ok(fields) => fields,
                Err(e) => {
                    log::warn!("Ignoring malformed portal signal: {e}");
                    continue;
                }
            };
            if namespace != APPEARANCE_NAMESPACE || key != COLOR_SCHEME_KEY {
                continue;
            }
            if let Value::U32(raw) = &*value {
                emit(map_color_scheme(*raw).to_string());
            }
        }
        Ok(())
    }

    fn session_connection() -> Result<zbus::blocking::Connection, String> {
        Builder::session()
            .and_then(|builder| builder.build())
            .map_err(|e| format!("Failed to connect to the session bus: {e}"))
    }
}

/// Reads the OS color scheme. Linux reads the XDG Settings portal; other
/// platforms report an error so the frontend falls back to the CSS media
/// query, which is reliable there.
#[cfg(target_os = "linux")]
pub fn read_color_scheme() -> Result<String, String> {
    portal::read_color_scheme()
}

#[cfg(not(target_os = "linux"))]
pub fn read_color_scheme() -> Result<String, String> {
    Err("system color-scheme detection is only supported on Linux".to_string())
}

/// Tauri command backing the frontend `getSystemIsDark` seam.
#[tauri::command]
pub async fn get_system_color_scheme() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(read_color_scheme)
        .await
        .map_err(|e| format!("system color-scheme task failed: {e}"))?
}

/// Starts the portal watcher thread (Linux only). Failures are logged and
/// non-fatal: the frontend falls back to the CSS media query.
#[cfg(target_os = "linux")]
pub fn spawn_color_scheme_watcher(app: tauri::AppHandle) {
    use tauri::Emitter;

    std::thread::spawn(move || {
        let result = portal::watch_color_scheme(move |scheme| {
            let _ = app.emit(portal::COLOR_SCHEME_EVENT, scheme);
        });
        if let Err(e) = result {
            log::warn!("System color-scheme watcher stopped: {e}");
        }
    });
}

#[cfg(test)]
mod tests;
