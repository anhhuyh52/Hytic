use crate::context::GpuContext;
use crate::curve::{CurvePoint, SplineCurve};
use crate::lut::CubeLut;
use crate::pipeline::BaseGradePipeline;
use crate::state::{BasicGradeUniforms, EditStatePayload};
use std::path::Path;
use std::sync::Arc;
use image::{ColorType, DynamicImage, ImageEncoder, ImageFormat};
use image::codecs::jpeg::JpegEncoder;

pub struct HyticEngine {
    pub ctx: GpuContext,
    pub pipeline: BaseGradePipeline,
    pub current_image: Option<wgpu::Texture>,
    pub current_image_view: Option<wgpu::TextureView>,
    pub current_dimensions: (u32, u32),
    pub edit_uniforms: BasicGradeUniforms,
    pub current_lut_texture: Option<wgpu::Texture>,
    pub current_lut_view: Option<wgpu::TextureView>,
    pub current_curve_texture: Option<wgpu::Texture>,
    pub current_curve_view: Option<wgpu::TextureView>,
    pub fx_pipeline: crate::fx::FXPipeline,
    pub fx_uniforms: crate::fx::FXUniforms,
    pub scopes_pipeline: crate::scopes::ScopesPipeline,
    pub retouch_pipeline: crate::retouch::RetouchPipeline,
    pub retouch_uniforms: crate::retouch::RetouchUniforms,
    pub mask_pipeline: crate::mask::MaskPipeline,
    pub mask_uniforms: crate::mask::MaskUniforms,
}

impl HyticEngine {
    pub async fn new() -> Result<Self, String> {
        let ctx = GpuContext::new().await?;
        let pipeline = BaseGradePipeline::new(&ctx, wgpu::TextureFormat::Rgba8Unorm)?;
        let fx_pipeline = crate::fx::FXPipeline::new(&ctx.device, wgpu::TextureFormat::Rgba8Unorm)?;
        let scopes_pipeline = crate::scopes::ScopesPipeline::new(&ctx.device)?;
        let retouch_pipeline = crate::retouch::RetouchPipeline::new(&ctx.device, wgpu::TextureFormat::Rgba8Unorm)?;
        let mask_pipeline = crate::mask::MaskPipeline::new(&ctx.device, wgpu::TextureFormat::Rgba8Unorm)?;

        Ok(Self {
            ctx,
            pipeline,
            current_image: None,
            current_image_view: None,
            current_dimensions: (0, 0),
            edit_uniforms: BasicGradeUniforms::default(),
            current_lut_texture: None,
            current_lut_view: None,
            current_curve_texture: None,
            current_curve_view: None,
            fx_pipeline,
            fx_uniforms: crate::fx::FXUniforms::default(),
            scopes_pipeline,
            retouch_pipeline,
            retouch_uniforms: crate::retouch::RetouchUniforms::default(),
            mask_pipeline,
            mask_uniforms: crate::mask::MaskUniforms::default(),
        })
    }




    /// Load standard image bytes (JPEG, PNG, WebP) into GPU texture.
    pub fn load_image_from_bytes(&mut self, bytes: &[u8]) -> Result<(u32, u32), String> {
        let img = image::load_from_memory(bytes)
            .map_err(|e| format!("Failed to decode image: {e}"))?
            .to_rgba8();

        let (width, height) = img.dimensions();
        self.load_raw_rgba(width, height, img.as_raw())?;
        Ok((width, height))
    }

    /// Upload raw RGBA8 pixels directly to the GPU texture.
    pub fn load_raw_rgba(&mut self, width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
        if width == 0 || height == 0 {
            return Err("Invalid image dimensions (0x0)".to_string());
        }

        let texture = self.ctx.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Hytic Source Image Texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        self.ctx.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width * 4),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.current_image = Some(texture);
        self.current_image_view = Some(view);
        self.current_dimensions = (width, height);

        Ok(())
    }

    /// Update the active grading uniforms from the frontend state.
    pub fn set_edit_state(&mut self, payload: EditStatePayload) {
        self.edit_uniforms = payload.to_uniforms();
        self.pipeline.update_uniforms(&self.ctx.queue, &self.edit_uniforms);

        let (w, h) = self.current_dimensions;
        let w_f32 = if w > 0 { w as f32 } else { 1.0 };
        let h_f32 = if h > 0 { h as f32 } else { 1.0 };
        self.fx_uniforms = payload.to_fx_uniforms(w_f32, h_f32);
        self.fx_pipeline.update_uniforms(&self.ctx.queue, &self.fx_uniforms);
    }


    /// Load a 3D LUT from .cube string content and upload as 3D GPU texture.
    pub fn load_lut_from_cube_str(&mut self, content: &str) -> Result<u32, String> {
        let lut = CubeLut::parse_cube_str(content)?;
        let size = lut.size;
        let (texture, view) = lut.create_texture(&self.ctx.device, &self.ctx.queue);
        self.current_lut_texture = Some(texture);
        self.current_lut_view = Some(view);
        Ok(size)
    }

    /// Load a 3D LUT from a local .cube file path.
    pub fn load_lut_from_file<P: AsRef<Path>>(&mut self, path: P) -> Result<u32, String> {
        let lut = CubeLut::load_file(path)?;
        let size = lut.size;
        let (texture, view) = lut.create_texture(&self.ctx.device, &self.ctx.queue);
        self.current_lut_texture = Some(texture);
        self.current_lut_view = Some(view);
        Ok(size)
    }

    /// Update the active 1D tone curve spline and upload to GPU curve texture.
    pub fn set_tone_curve(&mut self, points: Vec<CurvePoint>) {
        let curve = SplineCurve::new(points);
        let (texture, view) = curve.create_texture(&self.ctx.device, &self.ctx.queue);
        self.current_curve_texture = Some(texture);
        self.current_curve_view = Some(view);
        self.edit_uniforms.has_tone_curve = 1.0;
        self.pipeline.update_uniforms(&self.ctx.queue, &self.edit_uniforms);
    }

    /// Clear the active tone curve, reverting to identity linear pass.
    pub fn clear_tone_curve(&mut self) {
        self.current_curve_texture = None;
        self.current_curve_view = None;
        self.edit_uniforms.has_tone_curve = 0.0;
        self.pipeline.update_uniforms(&self.ctx.queue, &self.edit_uniforms);
    }

    /// Update retouch spots for healing and clone stamping.
    pub fn set_retouch_spots(&mut self, spots: Vec<crate::retouch::SpotUniform>, aspect_ratio: f32) {
        let count = spots.len().min(crate::retouch::MAX_RETOUCH_SPOTS);
        let mut spot_array = [crate::retouch::SpotUniform::default(); crate::retouch::MAX_RETOUCH_SPOTS];
        for (i, spot) in spots.into_iter().take(count).enumerate() {
            spot_array[i] = spot;
        }
        self.retouch_uniforms = crate::retouch::RetouchUniforms {
            spot_count: count as u32,
            aspect_ratio: if aspect_ratio > 0.0 { aspect_ratio } else { 1.0 },
            _pad0: 0.0,
            _pad1: 0.0,
            spots: spot_array,
        };
        self.retouch_pipeline.update_uniforms(&self.ctx.queue, &self.retouch_uniforms);
    }

    /// Clear all retouch spots.
    pub fn clear_retouch_spots(&mut self) {
        self.retouch_uniforms = crate::retouch::RetouchUniforms::default();
        self.retouch_pipeline.update_uniforms(&self.ctx.queue, &self.retouch_uniforms);
    }

    /// Set active mask (radial, gradient, luminance) parameters.
    pub fn set_mask(&mut self, mask: crate::mask::MaskUniforms) {
        self.mask_uniforms = mask;
        self.mask_pipeline.update_uniforms(&self.ctx.queue, &self.mask_uniforms);
    }

    /// Clear active mask.
    pub fn clear_mask(&mut self) {
        self.mask_uniforms = crate::mask::MaskUniforms {
            opacity: 0.0,
            ..Default::default()
        };
        self.mask_pipeline.update_uniforms(&self.ctx.queue, &self.mask_uniforms);
    }

    /// Compute real-time RGB and Luma histogram on the GPU using atomics.
    pub async fn compute_scopes(&mut self) -> Result<crate::scopes::ScopesData, String> {
        let (width, height) = self.current_dimensions;
        if width == 0 || height == 0 {
            return Err("No image loaded for scopes computation".to_string());
        }
        let image_view = self.current_image_view.as_ref()
            .ok_or_else(|| "Source image view is missing".to_string())?;

        self.scopes_pipeline.compute_scopes(
            &self.ctx.device,
            &self.ctx.queue,
            image_view,
            width,
            height,
        ).await
    }



    /// Render the current graded frame offscreen and read back as uncompressed RGBA8 buffer.
    pub async fn render_frame_rgba(&mut self) -> Result<Vec<u8>, String> {
        let (width, height) = self.current_dimensions;
        if width == 0 || height == 0 {
            return Err("No image loaded to render".to_string());
        }

        let image_view = self.current_image_view.as_ref()
            .ok_or_else(|| "Source image view is missing".to_string())?;

        // 1. Create render target texture
        let target_texture = self.ctx.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Offscreen Render Target"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // 2. Resolve active LUT and Curve views (fallback to identity textures)
        let lut_view = self.current_lut_view.as_ref().unwrap_or(&self.ctx.default_lut_view);
        let curve_view = self.current_curve_view.as_ref().unwrap_or(&self.ctx.default_curve_view);

        let retouch_active = self.retouch_uniforms.spot_count > 0;
        let mask_active = self.mask_uniforms.opacity > 0.001;
        let fx_active = self.fx_uniforms.grain_amount > 0.0001
            || self.fx_uniforms.sharpen_amount > 0.0001
            || self.fx_uniforms.bloom_amount > 0.0001
            || self.fx_uniforms.halation_amount > 0.0001;

        let mut encoder = self.ctx.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Render Frame Encoder"),
        });

        // Pass 0: Optional Retouch (Spot removal & clone stamp)
        let retouch_texture = if retouch_active {
            let tex = self.ctx.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Retouched Texture"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
            let retouch_bind_group = self.retouch_pipeline.create_bind_group(
                &self.ctx.device,
                image_view,
                &self.ctx.linear_sampler,
            );
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Retouch Render Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
                pass.set_pipeline(&self.retouch_pipeline.render_pipeline);
                pass.set_bind_group(0, &retouch_bind_group, &[]);
                pass.draw(0..3, 0..1);
            }
            Some((tex, view))
        } else {
            None
        };

        let grade_source_view = match &retouch_texture {
            Some((_, view)) => view,
            None => image_view,
        };

        let bind_group = self.pipeline.create_bind_group(
            &self.ctx.device,
            grade_source_view,
            &self.ctx.linear_sampler,
            lut_view,
            &self.ctx.lut_3d_sampler,
            curve_view,
            &self.ctx.linear_sampler,
        );

        if fx_active {
            // Allocate intermediate texture for BaseGrade output
            let intermediate_texture = self.ctx.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Intermediate Graded Texture"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let intermediate_view = intermediate_texture.create_view(&wgpu::TextureViewDescriptor::default());

            // Pass 1: Base Grade -> Intermediate
            {
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Base Grade Render Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &intermediate_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });

                render_pass.set_pipeline(&self.pipeline.render_pipeline);
                render_pass.set_bind_group(0, &bind_group, &[]);
                render_pass.draw(0..3, 0..1);
            }

            // Optional Pass: Mask Overlay
            if mask_active {
                let mask_bind_group = self.mask_pipeline.create_bind_group(
                    &self.ctx.device,
                    &intermediate_view,
                    &self.ctx.linear_sampler,
                );
                let mut mask_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Mask Render Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &intermediate_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
                mask_pass.set_pipeline(&self.mask_pipeline.render_pipeline);
                mask_pass.set_bind_group(0, &mask_bind_group, &[]);
                mask_pass.draw(0..3, 0..1);
            }

            // Pass 2: Creative FX -> Final Target
            let fx_bind_group = self.fx_pipeline.create_bind_group(
                &self.ctx.device,
                &intermediate_view,
                &self.ctx.linear_sampler,
            );

            {
                let mut fx_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Creative FX Render Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &target_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });

                fx_pass.set_pipeline(&self.fx_pipeline.render_pipeline);
                fx_pass.set_bind_group(0, &fx_bind_group, &[]);
                fx_pass.draw(0..3, 0..1);
            }
        } else {
            // Direct Base Grade -> Final Target
            {
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Base Grade Direct Render Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &target_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });

                render_pass.set_pipeline(&self.pipeline.render_pipeline);
                render_pass.set_bind_group(0, &bind_group, &[]);
                render_pass.draw(0..3, 0..1);
            }

            // Optional Pass: Mask Overlay
            if mask_active {
                let mask_bind_group = self.mask_pipeline.create_bind_group(
                    &self.ctx.device,
                    &target_view,
                    &self.ctx.linear_sampler,
                );
                let mut mask_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("Mask Render Pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &target_view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
                mask_pass.set_pipeline(&self.mask_pipeline.render_pipeline);
                mask_pass.set_bind_group(0, &mask_bind_group, &[]);
                mask_pass.draw(0..3, 0..1);
            }
        }


        // 4. Setup readback buffer (aligned to 256 bytes per row)
        let unaligned_bytes_per_row = width * 4;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = ((unaligned_bytes_per_row + align - 1) / align) * align;
        let buffer_size = (padded_bytes_per_row * height) as u64;

        let output_buffer = self.ctx.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Output Readback Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &target_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &output_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        self.ctx.queue.submit(Some(encoder.finish()));

        // 5. Map buffer and read back rows
        let buffer_slice = output_buffer.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });

        self.ctx.device.poll(wgpu::Maintain::Wait);
        rx.recv()
            .map_err(|e| format!("Channel receive error: {e}"))?
            .map_err(|e| format!("Buffer map async error: {e}"))?;

        let padded_data = buffer_slice.get_mapped_range();
        let mut unpadded_rgba = Vec::with_capacity((width * height * 4) as usize);

        for row in 0..height {
            let start = (row * padded_bytes_per_row) as usize;
            let end = start + (width * 4) as usize;
            unpadded_rgba.extend_from_slice(&padded_data[start..end]);
        }

        drop(padded_data);
        output_buffer.unmap();

        Ok(unpadded_rgba)
    }

    /// Render and encode to JPEG bytes directly in native Rust.
    pub async fn render_jpeg(&mut self, quality: u8) -> Result<Vec<u8>, String> {
        let rgba = self.render_frame_rgba().await?;
        let (width, height) = self.current_dimensions;

        let mut jpeg_bytes = Vec::new();
        let encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, quality);
        encoder
            .write_image(&rgba, width, height, ColorType::Rgba8.into())
            .map_err(|e| format!("JPEG encoding failed: {e}"))?;

        Ok(jpeg_bytes)
    }

    /// Export the rendered frame using the native multi-format exporter (JPEG, PNG, WebP, TIFF).
    pub async fn export_image(
        &mut self,
        request: crate::export::ExportRequest,
    ) -> Result<Option<Vec<u8>>, String> {
        let rgba = self.render_frame_rgba().await?;
        let (width, height) = self.current_dimensions;

        if let Some(dest_path) = request.destination_path {
            crate::export::ImageExporter::save_to_file(
                &rgba,
                width,
                height,
                request.format,
                request.quality,
                dest_path,
            )?;
            Ok(None)
        } else {
            let bytes = crate::export::ImageExporter::encode_rgba8(
                &rgba,
                width,
                height,
                request.format,
                request.quality,
            )?;
            Ok(Some(bytes))
        }
    }
}

