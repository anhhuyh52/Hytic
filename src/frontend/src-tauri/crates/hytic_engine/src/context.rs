use std::sync::Arc;

pub struct GpuContext {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: Arc<wgpu::Device>,
    pub queue: Arc<wgpu::Queue>,
    pub linear_sampler: wgpu::Sampler,
    pub lut_3d_sampler: wgpu::Sampler,
    pub default_lut_texture: wgpu::Texture,
    pub default_lut_view: wgpu::TextureView,
    pub default_curve_texture: wgpu::Texture,
    pub default_curve_view: wgpu::TextureView,
}


impl GpuContext {
    pub async fn new() -> Result<Self, String> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| "Failed to find a compatible GPU adapter for Hytic Engine".to_string())?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Hytic GPU Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .map_err(|e| format!("Failed to create wgpu device: {e}"))?;

        let device = Arc::new(device);
        let queue = Arc::new(queue);

        // Standard 2D bilinear clamp sampler
        let linear_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Linear Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });

        // Trilinear 3D LUT sampler
        let lut_3d_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("LUT 3D Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // Identity 2x2x2 3D LUT texture as neutral fallback
        let lut_size = 2u32;
        let mut identity_lut_data = Vec::with_capacity((lut_size * lut_size * lut_size * 4) as usize);
        for z in 0..lut_size {
            for y in 0..lut_size {
                for x in 0..lut_size {
                    let r = ((x as f32 / (lut_size - 1) as f32) * 255.0) as u8;
                    let g = ((y as f32 / (lut_size - 1) as f32) * 255.0) as u8;
                    let b = ((z as f32 / (lut_size - 1) as f32) * 255.0) as u8;
                    identity_lut_data.extend_from_slice(&[r, g, b, 255]);
                }
            }
        }

        let default_lut_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Default Identity 3D LUT"),
            size: wgpu::Extent3d {
                width: lut_size,
                height: lut_size,
                depth_or_array_layers: lut_size,
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
                texture: &default_lut_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &identity_lut_data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(lut_size * 4),
                rows_per_image: Some(lut_size),
            },
            wgpu::Extent3d {
                width: lut_size,
                height: lut_size,
                depth_or_array_layers: lut_size,
            },
        );

        let default_lut_view = default_lut_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Default Identity 3D LUT View"),
            dimension: Some(wgpu::TextureViewDimension::D3),
            ..Default::default()
        });

        // Identity 512x1 1D curve texture
        let curve_size = 512u32;
        let mut identity_curve_data = Vec::with_capacity((curve_size * 4) as usize);
        for i in 0..curve_size {
            let v = ((i as f32 / (curve_size - 1) as f32) * 255.0).round() as u8;
            identity_curve_data.extend_from_slice(&[v, v, v, 255]);
        }

        let default_curve_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Default Linear Tone Curve Texture"),
            size: wgpu::Extent3d {
                width: curve_size,
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
                texture: &default_curve_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &identity_curve_data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(curve_size * 4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: curve_size,
                height: 1,
                depth_or_array_layers: 1,
            },
        );

        let default_curve_view = default_curve_texture.create_view(&wgpu::TextureViewDescriptor::default());

        Ok(Self {
            instance,
            adapter,
            device,
            queue,
            linear_sampler,
            lut_3d_sampler,
            default_lut_texture,
            default_lut_view,
            default_curve_texture,
            default_curve_view,
        })
    }
}

