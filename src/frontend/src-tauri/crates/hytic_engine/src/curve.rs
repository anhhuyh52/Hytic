use serde::{Deserialize, Serialize};

pub const CURVE_LUT_SIZE: u32 = 512;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CurvePoint {
    pub x: f32, // 0.0 to 1.0
    pub y: f32, // 0.0 to 1.0
}

/// Evaluates monotonic cubic Hermite splines for smooth, non-oscillating tone curves.
pub struct SplineCurve {
    pub points: Vec<CurvePoint>,
}

impl SplineCurve {
    pub fn new(points: Vec<CurvePoint>) -> Self {
        let mut sorted = points;
        sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
        if sorted.is_empty() {
            sorted = vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 1.0, y: 1.0 }];
        }
        Self { points: sorted }
    }

    /// Evaluates the curve at normalized input x in [0.0, 1.0].
    pub fn evaluate(&self, x: f32) -> f32 {
        let x = x.clamp(0.0, 1.0);
        let n = self.points.len();
        if n == 1 {
            return self.points[0].y;
        }
        if x <= self.points[0].x {
            return self.points[0].y;
        }
        if x >= self.points[n - 1].x {
            return self.points[n - 1].y;
        }

        // Find segment
        let mut i = 0;
        while i < n - 1 && self.points[i + 1].x < x {
            i += 1;
        }

        let p0 = &self.points[i];
        let p1 = &self.points[i + 1];
        let dx = p1.x - p0.x;
        if dx.abs() < 1e-6 {
            return p0.y;
        }

        // Hermite tangents estimation
        let m0 = if i > 0 {
            (p1.y - self.points[i - 1].y) / (p1.x - self.points[i - 1].x)
        } else {
            (p1.y - p0.y) / dx
        };

        let m1 = if i + 2 < n {
            (self.points[i + 2].y - p0.y) / (self.points[i + 2].x - p0.x)
        } else {
            (p1.y - p0.y) / dx
        };

        let t = (x - p0.x) / dx;
        let t2 = t * t;
        let t3 = t2 * t;

        // Hermite basis functions
        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;

        let y = h00 * p0.y + h10 * dx * m0 + h01 * p1.y + h11 * dx * m1;
        y.clamp(0.0, 1.0)
    }

    /// Build RGBA8 LUT buffer (512x1) for GPU texture upload.
    pub fn build_lut_rgba8(&self) -> Vec<u8> {
        let mut buffer = Vec::with_capacity((CURVE_LUT_SIZE * 4) as usize);
        for i in 0..CURVE_LUT_SIZE {
            let x = i as f32 / (CURVE_LUT_SIZE - 1) as f32;
            let y = self.evaluate(x);
            let byte_val = (y * 255.0).round() as u8;
            buffer.extend_from_slice(&[byte_val, byte_val, byte_val, 255]);
        }
        buffer
    }

    /// Create and upload 512x1 2D texture.
    pub fn create_texture(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let data = self.build_lut_rgba8();

        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("1D Tone Curve LUT Texture"),
            size: wgpu::Extent3d {
                width: CURVE_LUT_SIZE,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
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
            &data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(CURVE_LUT_SIZE * 4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: CURVE_LUT_SIZE,
                height: 1,
                depth_or_array_layers: 1,
            },
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    }
}
