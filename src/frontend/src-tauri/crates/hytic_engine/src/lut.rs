use std::fs;
use std::path::Path;

/// High-performance 3D LUT parser and GPU texture builder for `.cube` files.
pub struct CubeLut {
    pub title: String,
    pub size: u32,
    pub domain_min: [f32; 3],
    pub domain_max: [f32; 3],
    pub data: Vec<u8>, // RGBA8 packed data
}

impl CubeLut {
    /// Parse a .cube string into 3D LUT RGBA8 texture data.
    pub fn parse_cube_str(content: &str) -> Result<Self, String> {
        let mut title = "Custom LUT".to_string();
        let mut size: Option<u32> = None;
        let mut domain_min = [0.0f32, 0.0, 0.0];
        let mut domain_max = [1.0f32, 1.0, 1.0];
        let mut rgb_values: Vec<[f32; 3]> = Vec::new();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.is_empty() {
                continue;
            }

            match parts[0] {
                "TITLE" => {
                    title = parts[1..].join(" ").replace('"', "");
                }
                "LUT_3D_SIZE" => {
                    if parts.len() < 2 {
                        return Err("Malformed LUT_3D_SIZE header".to_string());
                    }
                    size = Some(parts[1].parse::<u32>().map_err(|e| format!("Invalid LUT size: {e}"))?);
                }
                "DOMAIN_MIN" => {
                    if parts.len() >= 4 {
                        domain_min[0] = parts[1].parse().unwrap_or(0.0);
                        domain_min[1] = parts[2].parse().unwrap_or(0.0);
                        domain_min[2] = parts[3].parse().unwrap_or(0.0);
                    }
                }
                "DOMAIN_MAX" => {
                    if parts.len() >= 4 {
                        domain_max[0] = parts[1].parse().unwrap_or(1.0);
                        domain_max[1] = parts[2].parse().unwrap_or(1.0);
                        domain_max[2] = parts[3].parse().unwrap_or(1.0);
                    }
                }
                _ => {
                    // Try parsing 3 floats (R G B)
                    if parts.len() >= 3 {
                        if let (Ok(r), Ok(g), Ok(b)) = (
                            parts[0].parse::<f32>(),
                            parts[1].parse::<f32>(),
                            parts[2].parse::<f32>(),
                        ) {
                            rgb_values.push([r, g, b]);
                        }
                    }
                }
            }
        }

        let lut_size = size.ok_or_else(|| "Missing LUT_3D_SIZE header in .cube file".to_string())?;
        let expected_count = (lut_size * lut_size * lut_size) as usize;
        if rgb_values.len() < expected_count {
            return Err(format!(
                "Incomplete LUT data: expected {expected_count} entries for size {lut_size}^3, found {}",
                rgb_values.len()
            ));
        }

        // Pack RGB floats into RGBA8 bytes for the 3D texture
        let mut data = Vec::with_capacity(expected_count * 4);
        for rgb in rgb_values.iter().take(expected_count) {
            let r = (rgb[0].clamp(0.0, 1.0) * 255.0).round() as u8;
            let g = (rgb[1].clamp(0.0, 1.0) * 255.0).round() as u8;
            let b = (rgb[2].clamp(0.0, 1.0) * 255.0).round() as u8;
            data.extend_from_slice(&[r, g, b, 255]);
        }

        Ok(Self {
            title,
            size: lut_size,
            domain_min,
            domain_max,
            data,
        })
    }

    /// Load and parse from file path on disk.
    pub fn load_file<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let content = fs::read_to_string(path.as_ref())
            .map_err(|e| format!("Failed to read LUT file: {e}"))?;
        Self::parse_cube_str(&content)
    }

    /// Create GPU 3D texture and view from this LUT data.
    pub fn create_texture(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("3D LUT Texture ({})", self.title)),
            size: wgpu::Extent3d {
                width: self.size,
                height: self.size,
                depth_or_array_layers: self.size,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D3,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &self.data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(self.size * 4),
                rows_per_image: Some(self.size),
            },
            wgpu::Extent3d {
                width: self.size,
                height: self.size,
                depth_or_array_layers: self.size,
            },
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("3D LUT View"),
            dimension: Some(wgpu::TextureViewDimension::D3),
            ..Default::default()
        });

        (texture, view)
    }
}
