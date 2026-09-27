use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;
use hytic_engine::{EditStatePayload, HyticEngine};

pub struct EngineState(pub Arc<Mutex<Option<HyticEngine>>>);

/// Read a file from disk and return its raw bytes.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

/// Write raw bytes to a file, creating parent directories as needed.
#[tauri::command]
fn write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories for {path}: {e}"))?;
    }
    fs::write(&path, &data).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// List all entries in a directory, returning their full paths.
#[tauri::command]
fn list_directory(path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to read directory {path}: {e}"))?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        names.push(entry.path().display().to_string());
    }
    Ok(names)
}

/// Check if a path exists on disk.
#[tauri::command]
fn path_exists(path: String) -> bool {
    PathBuf::from(&path).exists()
}

/// Get file metadata (size, is_dir, modified timestamp).
#[tauri::command]
fn file_metadata(path: String) -> Result<serde_json::Value, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Failed to stat {path}: {e}"))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(serde_json::json!({
        "size": meta.len(),
        "isDir": meta.is_dir(),
        "isFile": meta.is_file(),
        "modified": modified,
    }))
}

/// Initialize the native GPU engine
#[tauri::command]
async fn engine_init(state: tauri::State<'_, EngineState>) -> Result<bool, String> {
    let mut lock = state.0.lock().await;
    if lock.is_none() {
        let engine = HyticEngine::new().await?;
        *lock = Some(engine);
    }
    Ok(true)
}

/// Load an image file into GPU texture memory
#[tauri::command]
async fn engine_load_image(path: String, state: tauri::State<'_, EngineState>) -> Result<serde_json::Value, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    let (w, h) = engine.load_image_from_bytes(&bytes)?;
    Ok(serde_json::json!({ "width": w, "height": h }))
}

/// Update color grading parameters on the GPU
#[tauri::command]
async fn engine_set_edit_state(edit_state: EditStatePayload, state: tauri::State<'_, EngineState>) -> Result<(), String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    engine.set_edit_state(edit_state);
    Ok(())
}

/// Render the graded frame using wgpu offscreen and encode to JPEG bytes
#[tauri::command]
async fn engine_render_frame_jpeg(quality: Option<u8>, state: tauri::State<'_, EngineState>) -> Result<Vec<u8>, String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    let q = quality.unwrap_or(90);
    engine.render_jpeg(q).await
}

/// Load a 3D LUT from a local .cube file into GPU memory
#[tauri::command]
async fn engine_load_lut_file(path: String, state: tauri::State<'_, EngineState>) -> Result<u32, String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    engine.load_lut_from_file(&path)
}

/// Update the tone curve spline on the GPU
#[tauri::command]
async fn engine_set_tone_curve(points: Vec<hytic_engine::CurvePoint>, state: tauri::State<'_, EngineState>) -> Result<(), String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    engine.set_tone_curve(points);
    Ok(())
}

/// Clear the active tone curve
#[tauri::command]
async fn engine_clear_tone_curve(state: tauri::State<'_, EngineState>) -> Result<(), String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    engine.clear_tone_curve();
    Ok(())
}

/// Compute 256-bin RGB and Luma histogram on the GPU
#[tauri::command]
async fn engine_compute_scopes(state: tauri::State<'_, EngineState>) -> Result<hytic_engine::ScopesData, String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    engine.compute_scopes().await
}

/// Export the current frame in any format (JPEG, PNG, WebP, TIFF) directly to disk or as encoded bytes
#[tauri::command]
async fn engine_export_image(
    request: hytic_engine::ExportRequest,
    state: tauri::State<'_, EngineState>,
) -> Result<Option<Vec<u8>>, String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    engine.export_image(request).await
}

/// Update retouch spots on the GPU
#[tauri::command]
async fn engine_set_retouch_spots(
    spots: Vec<hytic_engine::SpotUniform>,
    aspect_ratio: Option<f32>,
    state: tauri::State<'_, EngineState>,
) -> Result<(), String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    engine.set_retouch_spots(spots, aspect_ratio.unwrap_or(1.0));
    Ok(())
}

/// Clear retouch spots on the GPU
#[tauri::command]
async fn engine_clear_retouch_spots(state: tauri::State<'_, EngineState>) -> Result<(), String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    engine.clear_retouch_spots();
    Ok(())
}

/// Update active mask parameters on the GPU
#[tauri::command]
async fn engine_set_mask(
    mask: hytic_engine::MaskUniforms,
    state: tauri::State<'_, EngineState>,
) -> Result<(), String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    engine.set_mask(mask);
    Ok(())
}

/// Clear active mask on the GPU
#[tauri::command]
async fn engine_clear_mask(state: tauri::State<'_, EngineState>) -> Result<(), String> {
    let mut lock = state.0.lock().await;
    let engine = lock.as_mut().ok_or_else(|| "Engine not initialized".to_string())?;
    engine.clear_mask();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine_state = EngineState(Arc::new(Mutex::new(None)));

    tauri::Builder::default()
        .manage(engine_state)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            read_file_bytes,
            write_file_bytes,
            list_directory,
            path_exists,
            file_metadata,
            engine_init,
            engine_load_image,
            engine_set_edit_state,
            engine_render_frame_jpeg,
            engine_load_lut_file,
            engine_set_tone_curve,
            engine_clear_tone_curve,
            engine_compute_scopes,
            engine_export_image,
            engine_set_retouch_spots,
            engine_clear_retouch_spots,
            engine_set_mask,
            engine_clear_mask,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hytic");
}

