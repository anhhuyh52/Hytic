// Camera/log transfer-curve DECODE functions: encoded code value (0..1) -> scene
// linear. These are the published inverse-OETF formulas, applied per channel.
//
// IMPORTANT: these are documented APPROXIMATIONS of each manufacturer's curve.
// They are not certified IDTs (no per-EI handling, single nominal setup). All
// use base-10 pow on guarded inputs so they cannot produce NaN.

// Sony S-Log3 inverse OETF (official curve; x in 0..1 as 10-bit/1023).
float slog3DecodeChannel(float x) {
  if (x >= 171.2102946929 / 1023.0) {
    return (pow(10.0, (x * 1023.0 - 420.0) / 261.5)) * (0.18 + 0.01) - 0.01;
  }
  return (x * 1023.0 - 95.0) * 0.01125000 / (171.2102946929 - 95.0);
}
vec3 slog3Decode(vec3 c) {
  return vec3(slog3DecodeChannel(c.r), slog3DecodeChannel(c.g), slog3DecodeChannel(c.b));
}

// ARRI LogC3 (v3) inverse, EI 800 constants (from the ARRI ALEXA LogC curve doc).
float logc3DecodeChannel(float t) {
  const float cut = 0.010591;
  const float a = 5.555556;
  const float b = 0.052272;
  const float cc = 0.247190;
  const float d = 0.385537;
  const float e = 5.367655;
  const float f = 0.092809;
  if (t > e * cut + f) {
    return (pow(10.0, (t - d) / cc) - b) / a;
  }
  return (t - f) / e;
}
vec3 logc3Decode(vec3 c) {
  return vec3(logc3DecodeChannel(c.r), logc3DecodeChannel(c.g), logc3DecodeChannel(c.b));
}

// Canon C-Log3 inverse (approximate; constants per Canon white paper, code 0..1).
float clog3DecodeChannel(float x) {
  if (x < 0.097465473) {
    return -(pow(10.0, (0.097465473 - x) / 0.36726845) - 1.0) / 14.98325;
  } else if (x <= 0.15277891) {
    return (x - 0.12783901) / 1.9985256;
  }
  return (pow(10.0, (x - 0.12512219) / 0.36726845) - 1.0) / 14.98325;
}
vec3 clog3Decode(vec3 c) {
  return vec3(clog3DecodeChannel(c.r), clog3DecodeChannel(c.g), clog3DecodeChannel(c.b));
}

// Panasonic V-Log inverse (official curve).
float vlogDecodeChannel(float x) {
  const float b = 0.00873;
  const float cc = 0.241514;
  const float d = 0.598206;
  const float cut2 = 0.181;
  if (x < cut2) {
    return (x - 0.125) / 5.6;
  }
  return pow(10.0, (x - d) / cc) - b;
}
vec3 vlogDecode(vec3 c) {
  return vec3(vlogDecodeChannel(c.r), vlogDecodeChannel(c.g), vlogDecodeChannel(c.b));
}

// RED Log3G10 v2 inverse (approximate; forward is y = a*log10(b*(x+c)+1)).
float log3g10DecodeChannel(float x) {
  const float a = 0.224282;
  const float b = 155.975327;
  const float c = 0.01;
  return (pow(10.0, x / a) - 1.0) / b - c;
}
vec3 log3g10Decode(vec3 c) {
  return vec3(log3g10DecodeChannel(c.r), log3g10DecodeChannel(c.g), log3g10DecodeChannel(c.b));
}
