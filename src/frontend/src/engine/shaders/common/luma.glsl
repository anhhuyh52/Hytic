// Rec.709 relative luminance of a linear-light RGB color. Shared by panel
// shaders (balance, saturation) so the function is defined exactly once.
float luminance709(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}
