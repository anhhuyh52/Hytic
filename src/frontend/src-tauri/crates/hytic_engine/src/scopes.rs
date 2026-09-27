use serde::{Deserialize, Serialize};
use std::sync::Arc;
use wgpu::util::DeviceExt;

pub const HISTOGRAM_BIN_COUNT: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopesData {
    pub r: Vec<u32>,
    pub g: Vec<u32>,
    pub b: Vec<u32>,
    pub luma: Vec<u32>,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct HistogramGpuBuffer {
    r: [u32; HISTOGRAM_BIN_COUNT],
    g: [u32; HISTOGRAM_BIN_COUNT],
    b: [u32; HISTOGRAM_BIN_COUNT],
    luma: [u32; HISTOGRAM_BIN_COUNT],
}

pub struct ScopesPipeline {
    pub compute_pipeline: wgpu::ComputePipeline,
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub storage_buffer: wgpu::Buffer,
    pub readback_buffer: wgpu::Buffer,
}

impl ScopesPipeline {
    pub fn new(device: &wgpu::Device) -> Result<Self, String> {
        let shader_source = include_str!("shaders/scopes.wgsl");
        let shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Scopes WGSL Compute Shader"),
            source: wgpu::ShaderSource::Wgsl(shader_source.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Scopes Bind Group Layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Scopes Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let compute_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Scopes Compute Pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader_module,
            entry_point: Some("cs_main"),
            compilation_options: Default::default(),
            cache: None,
        });

        let buffer_size = std::mem::size_of::<HistogramGpuBuffer>() as u64;

        let storage_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Scopes GPU Storage Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let readback_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Scopes Readback Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        Ok(Self {
            compute_pipeline,
            bind_group_layout,
            storage_buffer,
            readback_buffer,
        })
    }

    /// Dispatches the compute shader over the image and reads back the 256-bin histogram.
    pub async fn compute_scopes(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        image_view: &wgpu::TextureView,
        width: u32,
        height: u32,
    ) -> Result<ScopesData, String> {
        // Zero out the storage buffer
        let zeros = [0u8; std::mem::size_of::<HistogramGpuBuffer>()];
        queue.write_buffer(&self.storage_buffer, 0, &zeros);

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Scopes Bind Group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(image_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.storage_buffer.as_entire_binding(),
                },
            ],
        });

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Scopes Compute Encoder"),
        });

        {
            let mut compute_pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Scopes Compute Pass"),
                timestamp_writes: None,
            });

            compute_pass.set_pipeline(&self.compute_pipeline);
            compute_pass.set_bind_group(0, &bind_group, &[]);
            let workgroup_x = (width + 15) / 16;
            let workgroup_y = (height + 15) / 16;
            compute_pass.dispatch_workgroups(workgroup_x, workgroup_y, 1);
        }

        encoder.copy_buffer_to_buffer(
            &self.storage_buffer,
            0,
            &self.readback_buffer,
            0,
            std::mem::size_of::<HistogramGpuBuffer>() as u64,
        );

        queue.submit(Some(encoder.finish()));

        // Map buffer async
        let buffer_slice = self.readback_buffer.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });

        device.poll(wgpu::Maintain::Wait);
        rx.recv()
            .map_err(|e| format!("Channel receive error: {e}"))?
            .map_err(|e| format!("Scopes readback buffer map error: {e}"))?;

        let mapped_range = buffer_slice.get_mapped_range();
        let gpu_data: &HistogramGpuBuffer = bytemuck::from_bytes(&mapped_range);

        let scopes_result = ScopesData {
            r: gpu_data.r.to_vec(),
            g: gpu_data.g.to_vec(),
            b: gpu_data.b.to_vec(),
            luma: gpu_data.luma.to_vec(),
        };

        drop(mapped_range);
        self.readback_buffer.unmap();

        Ok(scopes_result)
    }
}
