use tauri::{Manager, CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct OsInfo {
  platform: String,
  #[serde(rename = "type")]
  os_type: String,
}

#[tauri::command]
fn get_os_info() -> Result<OsInfo, String> {
  #[cfg(target_os = "windows")]
  let platform = "win32";
  #[cfg(target_os = "macos")]
  let platform = "darwin";
  #[cfg(target_os = "linux")]
  let platform = "linux";

  Ok(OsInfo {
    platform: platform.to_string(),
    os_type: std::env::consts::OS.to_string(),
  })
}

#[tauri::command]
fn get_app_version() -> Result<String, String> {
  Ok(tauri::PackageInfo::version().to_string())
}

#[tauri::command]
async fn check_updates() -> Result<serde_json::Value, String> {
  let client = reqwest::Client::new();
  let resp = client
    .get("https://api.github.com/repos/Juanoto2012/IDX/releases/latest")
    .send()
    .await
    .map_err(|e| e.to_string())?;
  let data = resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
  Ok(data)
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![get_os_info, get_app_version, check_updates])
    .setup(|app| {
      #[cfg(debug_assertions)]
      app.get_window("main").unwrap().open_devtools();
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}