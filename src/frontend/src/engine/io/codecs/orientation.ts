// Apply an EXIF/TIFF orientation (1–8) to an RGBA8 buffer, returning a re-laid-out
// buffer (and swapped dimensions for the 90°/270° cases). Shared by the worker
// decoders for formats whose codec doesn't bake orientation in (e.g. TIFF).
//   1 normal · 2 flip-H · 3 rot180 · 4 flip-V
//   5 transpose · 6 rot90-CW · 7 transverse · 8 rot90-CCW

export function applyOrientation(
  rgba: Uint8Array,
  width: number,
  height: number,
  orientation: number,
): { rgba: Uint8Array; width: number; height: number } {
  if (!orientation || orientation === 1) return { rgba, width, height };

  const swap = orientation >= 5; // 5,6,7,8 swap width/height
  const outW = swap ? height : width;
  const outH = swap ? width : height;
  const out = new Uint8Array(outW * outH * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let dx: number;
      let dy: number;
      switch (orientation) {
        case 2:
          dx = width - 1 - x;
          dy = y;
          break;
        case 3:
          dx = width - 1 - x;
          dy = height - 1 - y;
          break;
        case 4:
          dx = x;
          dy = height - 1 - y;
          break;
        case 5:
          dx = y;
          dy = x;
          break;
        case 6:
          dx = height - 1 - y;
          dy = x;
          break;
        case 7:
          dx = height - 1 - y;
          dy = width - 1 - x;
          break;
        case 8:
          dx = y;
          dy = width - 1 - x;
          break;
        default:
          dx = x;
          dy = y;
      }
      const s = (y * width + x) * 4;
      const d = (dy * outW + dx) * 4;
      out[d] = rgba[s];
      out[d + 1] = rgba[s + 1];
      out[d + 2] = rgba[s + 2];
      out[d + 3] = rgba[s + 3];
    }
  }
  return { rgba: out, width: outW, height: outH };
}
