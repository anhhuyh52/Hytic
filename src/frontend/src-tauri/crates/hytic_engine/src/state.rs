use serde::{Deserialize, Serialize};

/// Global adjustments matching Hytic's basic grading panel.
#[repr(C)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, bytemuck::Pod, bytemuck::Zeroable)]
pub struct BasicGradeUniforms {
    /// Exposure in stops (-5.0 to 5.0, default 0.0)
    pub exposure: f32,
    /// Contrast (-1.0 to 1.0, default 0.0)
    pub contrast: f32,
    /// Contrast pivot point (default 0.18 for 18% middle gray)
    pub contrast_pivot: f32,
    /// Highlights recovery/boost (-1.0 to 1.0, default 0.0)
    pub highlights: f32,

    /// Shadows lift/crush (-1.0 to 1.0, default 0.0)
    pub shadows: f32,
    /// Whites clip point adjustment (-1.0 to 1.0, default 0.0)
    pub whites: f32,
    /// Blacks clip point adjustment (-1.0 to 1.0, default 0.0)
    pub blacks: f32,
    /// Global saturation (-1.0 to 1.0, default 0.0)
    pub saturation: f32,

    /// Temperature shift in mireds or normalized Kelvin (-1.0 to 1.0, default 0.0)
    pub temperature: f32,
    /// Green/Magenta tint shift (-1.0 to 1.0, default 0.0)
    pub tint: f32,
    /// Vibrance (smart saturation of low-saturated colors, default 0.0)
    pub vibrance: f32,
    /// Dehaze amount (-1.0 to 1.0, default 0.0)
    pub dehaze: f32,

    /// Vignette amount (-1.0 to 1.0, default 0.0)
    pub vignette_amount: f32,
    /// Vignette midpoint (0.0 to 1.0, default 0.5)
    pub vignette_midpoint: f32,
    /// Vignette feather (0.0 to 1.0, default 0.5)
    pub vignette_feather: f32,
    /// Vignette roundness (-1.0 to 1.0, default 0.0)
    pub vignette_roundness: f32,

    /// 3D LUT intensity blend (0.0 = disabled, 1.0 = 100% LUT)
    pub lut_intensity: f32,
    /// Whether 1D Tone Curve is active (1.0 = active, 0.0 = bypass)
    pub has_tone_curve: f32,
    /// Padding for 16-byte alignment in WGSL uniforms
    pub _pad0: f32,
    pub _pad1: f32,
}

impl Default for BasicGradeUniforms {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            contrast: 0.0,
            contrast_pivot: 0.18,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            saturation: 0.0,
            temperature: 0.0,
            tint: 0.0,
            vibrance: 0.0,
            dehaze: 0.0,
            vignette_amount: 0.0,
            vignette_midpoint: 0.5,
            vignette_feather: 0.5,
            vignette_roundness: 0.0,
            lut_intensity: 0.0,
            has_tone_curve: 0.0,
            _pad0: 0.0,
            _pad1: 0.0,
        }
    }
}

/// Dynamic edit state received from the frontend via JSON.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EditStatePayload {
    #[serde(default)]
    pub exposure: Option<f32>,
    #[serde(default)]
    pub contrast: Option<f32>,
    #[serde(default)]
    pub highlights: Option<f32>,
    #[serde(default)]
    pub shadows: Option<f32>,
    #[serde(default)]
    pub whites: Option<f32>,
    #[serde(default)]
    pub blacks: Option<f32>,
    #[serde(default)]
    pub saturation: Option<f32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub tint: Option<f32>,
    #[serde(default)]
    pub vibrance: Option<f32>,
    #[serde(default)]
    pub dehaze: Option<f32>,
    #[serde(default)]
    pub lut_path: Option<String>,
    #[serde(default)]
    pub lut_intensity: Option<f32>,
    #[serde(default)]
    pub grain_amount: Option<f32>,
    #[serde(default)]
    pub grain_size: Option<f32>,
    #[serde(default)]
    pub grain_color: Option<f32>,
    #[serde(default)]
    pub sharpen_amount: Option<f32>,
    #[serde(default)]
    pub bloom_amount: Option<f32>,
    #[serde(default)]
    pub bloom_threshold: Option<f32>,
    #[serde(default)]
    pub halation_amount: Option<f32>,
    #[serde(default)]
    pub halation_hue: Option<f32>,
}

impl EditStatePayload {
    pub fn to_uniforms(&self) -> BasicGradeUniforms {
        let mut u = BasicGradeUniforms::default();
        if let Some(v) = self.exposure { u.exposure = v; }
        if let Some(v) = self.contrast { u.contrast = v; }
        if let Some(v) = self.highlights { u.highlights = v; }
        if let Some(v) = self.shadows { u.shadows = v; }
        if let Some(v) = self.whites { u.whites = v; }
        if let Some(v) = self.blacks { u.blacks = v; }
        if let Some(v) = self.saturation { u.saturation = v; }
        if let Some(v) = self.temperature { u.temperature = v; }
        if let Some(v) = self.tint { u.tint = v; }
        if let Some(v) = self.vibrance { u.vibrance = v; }
        if let Some(v) = self.dehaze { u.dehaze = v; }
        if let Some(v) = self.lut_intensity { u.lut_intensity = v; }
        u
    }

    pub fn to_fx_uniforms(&self, width: f32, height: f32) -> crate::fx::FXUniforms {
        let mut fx = crate::fx::FXUniforms {
            image_width: width,
            image_height: height,
            ..Default::default()
        };
        if let Some(v) = self.grain_amount { fx.grain_amount = v; }
        if let Some(v) = self.grain_size { fx.grain_size = v; }
        if let Some(v) = self.grain_color { fx.grain_color = v; }
        if let Some(v) = self.sharpen_amount { fx.sharpen_amount = v; }
        if let Some(v) = self.bloom_amount { fx.bloom_amount = v; }
        if let Some(v) = self.bloom_threshold { fx.bloom_threshold = v; }
        if let Some(v) = self.halation_amount { fx.halation_amount = v; }
        if let Some(v) = self.halation_hue { fx.halation_hue = v; }
        fx
    }
}

