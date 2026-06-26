// src-tauri/src/main.rs
#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use tauri::Manager;
use serde::Serialize;

#[derive(Serialize)]
struct OsInfo {
  platform: String,
  #[serde(rename = "type")]
  os_type: String,
}

#[tauri::command]
fn get_os_info() -> Result<OsInfo, String> {
  let platform = std::env::consts::OS;
  Ok(OsInfo {
    platform: platform.to_string(),
    os_type: platform.to_string(),
  })
}

#[tauri::command]
fn get_app_version() -> Result<String, String> {
  Ok(tauri::PackageInfo::version().to_string())
}

#[tauri::command]
fn check_updates() -> Result<serde_json::Value, String> {
  let response = reqwest::blocking::get("https://api.github.com/repos/Juanoto2012/IDX/releases/latest")
    .map_err(|e| e.to_string())?;
  let data = response.json::<serde_json::Value>().map_err(|e| e.to_string())?;
  Ok(data)
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![get_os_info, get_app_version, check_updates])
    .setup(|app| {
      #[cfg(debug_assertions)]
      if let Some(window) = app.get_window("main") {
        let _ = window.open_devtools();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}