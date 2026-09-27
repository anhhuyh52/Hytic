declare global {
  interface Math {
    copySign(magnitude: number, sign: number): number;
  }
}

if (typeof Math.copySign !== "function") {
  Math.copySign = (magnitude, sign) => (sign < 0 ? -1 : 1) * Math.abs(magnitude);
}

export {};
