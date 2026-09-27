// Refraction — faithful port of the legacy `rfc` (filmic per-hue HSL,
// shadow/highlight separated), extracted from package.min.js. Runs in the cct
// log working space (lin2cct/cct2lin from the legacyColor include). Each primary
// param is vec4(shadowAngleDeg, shadowDensity, highlightAngleDeg, highlightDensity);
// `spr` is the shadow↔highlight separation. No-op when densities are all 1 and
// angles are at the primary bases (the engine default).

const float RF_CRM_O = 0.333;
const float RF_CRM_D = 16.667;
const float RF_CRM_M = 5.151810; // pow(O+D,O+D)/(pow(O,O)*pow(D,D)) — precomputed (const-pow is illegal in GLSL ES)

float rfSig(float x, float k) { return 1.0 / (1.0 + exp(-(x - 0.5) * k)); }
float rfHlko(float x) { x *= x * x * x * x; return exp(-42.3301 * x) * (1.0 - x); }

float rfS2m(float l, float spr) {
  const float llmt = 0.2;
  spr = spr * (1.0 - llmt) + llmt;
  return rfSig(l, spr * spr * 60.0);
}

float rfMlmt(vec3 rgb, float lum) {
  float crm = legacyChroma(rgb) * 2.0;
  float mxc = max(rgb.x, max(rgb.y, rgb.z));
  float crmKo = RF_CRM_M * pow(crm, mxc) * pow(1.0 - crm, RF_CRM_D - mxc);
  return crmKo * rfHlko(lum) * 1.333;
}

vec3 rfH2r(float h) {
  const vec3 p324 = vec3(3.0, 2.0, 4.0);
  const vec3 p111 = vec3(1.0, -1.0, -1.0);
  const vec3 p122 = vec3(-1.0, 2.0, 2.0);
  return clamp(abs(h * 6.0 - p324) * p111 + p122, 0.0, 1.0) - 1.0;
}

vec3 rfP2c(vec4 p, float separation, float lmt) {
  float d = p.z - p.x;
  float delta = d + ((abs(d) > 180.0) ? ((d < 0.0) ? 360.0 : -360.0) : 0.0);
  float s = mix(p.y, p.w, separation);
  s = mix(min(s, 1.0), s, lmt);
  float h = mod((p.x + delta * separation) + 360.0, 360.0) / 360.0;
  return rfH2r(h) * s + 1.0;
}

vec3 rfc(vec3 rgb, vec4 pR, vec4 pY, vec4 pG, vec4 pC, vec4 pB, vec4 pM, float lum, float spr) {
  float sprMask = rfS2m(max(rgb.x, max(rgb.y, rgb.z)), spr);
  float lmt = rfMlmt(rgb, lum);
  if (rgb.r > rgb.g) {
    if (rgb.g > rgb.b) {
      vec3 r = rfP2c(pR, sprMask, lmt); vec3 y = rfP2c(pY, sprMask, lmt);
      return rgb.r * r + rgb.g * (y - r) + rgb.b * (1.0 - y);
    } else if (rgb.r > rgb.b) {
      vec3 r = rfP2c(pR, sprMask, lmt); vec3 m = rfP2c(pM, sprMask, lmt);
      return rgb.r * r + rgb.g * (1.0 - m) + rgb.b * (m - r);
    } else {
      vec3 m = rfP2c(pM, sprMask, lmt); vec3 b = rfP2c(pB, sprMask, lmt);
      return rgb.r * (m - b) + rgb.g * (1.0 - m) + rgb.b * b;
    }
  } else {
    if (rgb.b > rgb.g) {
      vec3 c = rfP2c(pC, sprMask, lmt); vec3 b = rfP2c(pB, sprMask, lmt);
      return rgb.r * (1.0 - c) + rgb.g * (c - b) + rgb.b * b;
    } else if (rgb.b > rgb.r) {
      vec3 c = rfP2c(pC, sprMask, lmt); vec3 g = rfP2c(pG, sprMask, lmt);
      return rgb.r * (1.0 - c) + rgb.g * g + rgb.b * (c - g);
    } else {
      vec3 y = rfP2c(pY, sprMask, lmt); vec3 g = rfP2c(pG, sprMask, lmt);
      return rgb.r * (y - g) + rgb.g * g + rgb.b * (1.0 - y);
    }
  }
}

vec3 applyRefraction(
  vec3 color,
  vec4 mvR, vec4 mvY, vec4 mvG, vec4 mvC, vec4 mvB, vec4 mvM,
  float separation
) {
  vec3 cct = lin2cct(color); // no max(,0): keep cct continuous like legacy (see shadowHighlight.glsl)
  float lum = legacyLuma(cct);
  cct = rfc(cct, mvR, mvY, mvG, mvC, mvB, mvM, lum, separation);
  return cct2lin(cct);
}
