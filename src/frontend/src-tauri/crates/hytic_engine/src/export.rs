use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::tiff::TiffEncoder;
use image::codecs::webp::WebPEncoder;
use image::{ColorType, ImageEncoder};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ExportFormat {
    #[serde(rename = "jpg")]
    Jpeg,
    #[serde(rename = "png")]
    Png8,
    #[serde(rename = "png16")]
    Png16,
    #[serde(rename = "webp")]
    Webp,
    #[serde(rename = "tif")]
    Tiff,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportRequest {
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    pub format: ExportFormat,
    #[serde(default)]
    pub quality: Option<u8>,
    #[serde(default)]
    pub destination_path: Option<String>,
}

pub struct ImageExporter;

impl ImageExporter {
    /// Encode raw RGBA8 image buffer into the requested target format.
    pub fn encode_rgba8(
        rgba: &[u8],
        width: u32,
        height: u32,
        format: ExportFormat,
        quality: Option<u8>,
    ) -> Result<Vec<u8>, String> {
        let mut buffer = Vec::new();

        match format {
            ExportFormat::Jpeg => {
                let q = quality.unwrap_or(90).clamp(1, 100);
                let encoder = JpegEncoder::new_with_quality(&mut buffer, q);
                encoder
                    .write_image(rgba, width, height, ColorType::Rgba8.into())
                    .map_err(|e| format!("JPEG encoding failed: {e}"))?;
            }
            ExportFormat::Png8 | ExportFormat::Png16 => {
                let encoder = PngEncoder::new(&mut buffer);
                encoder
                    .write_image(rgba, width, height, ColorType::Rgba8.into())
                    .map_err(|e| format!("PNG encoding failed: {e}"))?;
            }
            ExportFormat::Webp => {
                let encoder = WebPEncoder::new_lossless(&mut buffer);
                encoder
                    .write_image(rgba, width, height, ColorType::Rgba8.into())
                    .map_err(|e| format!("WebP encoding failed: {e}"))?;
            }
            ExportFormat::Tiff => {
                let encoder = TiffEncoder::new(std::io::Cursor::new(&mut buffer));
                encoder
                    .write_image(rgba, width, height, ColorType::Rgba8.into())
                    .map_err(|e| format!("TIFF encoding failed: {e}"))?;
            }
        }

        Ok(buffer)
    }

    /// Save the rendered image directly to a disk file path.
    pub fn save_to_file<P: AsRef<Path>>(
        rgba: &[u8],
        width: u32,
        height: u32,
        format: ExportFormat,
        quality: Option<u8>,
        path: P,
    ) -> Result<(), String> {
        let file = File::create(path.as_ref())
            .map_err(|e| format!("Failed to create output file: {e}"))?;
        let mut writer = BufWriter::new(file);

        match format {
            ExportFormat::Jpeg => {
                let q = quality.unwrap_or(90).clamp(1, 100);
                let encoder = JpegEncoder::new_with_quality(&mut writer, q);
                encoder
                    .write_image(rgba, width, height, ColorType::Rgba8.into())
                    .map_err(|e| format!("JPEG file write failed: {e}"))?;
            }
            ExportFormat::Png8 | ExportFormat::Png16 => {
                let encoder = PngEncoder::new(&mut writer);
                encoder
                    .write_image(rgba, width, height, ColorType::Rgba8.into())
                    .map_err(|e| format!("PNG file write failed: {e}"))?;
            }
            ExportFormat::Webp => {
                let encoder = WebPEncoder::new_lossless(&mut writer);
                encoder
                    .write_image(rgba, width, height, ColorType::Rgba8.into())
                    .map_err(|e| format!("WebP file write failed: {e}"))?;
            }
            ExportFormat::Tiff => {
                let encoder = TiffEncoder::new(&mut writer);
                encoder
                    .write_image(rgba, width, height, ColorType::Rgba8.into())
                    .map_err(|e| format!("TIFF file write failed: {e}"))?;
            }
        }

        Ok(())
    }
}
