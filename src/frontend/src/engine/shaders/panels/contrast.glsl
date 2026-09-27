// Linear-light contrast around a linear pivot.
// amount is a stops-like unit: 0 = neutral, positive widens, negative compresses.
vec3 applyContrast(vec3 color, float amount, float pivot) {
  float factor = pow(2.0, amount);
  return (color - vec3(pivot)) * factor + vec3(pivot);
}
