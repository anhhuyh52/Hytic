export function createRafInput<T extends unknown[]>(apply: (...args: T) => void) {
  let frame = 0;
  let latest: T | null = null;

  const run = () => {
    frame = 0;
    const args = latest;
    latest = null;
    if (args) apply(...args);
  };

  return {
    schedule(...args: T) {
      latest = args;
      if (!frame) frame = requestAnimationFrame(run);
    },
    flush() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      run();
    },
    cancel() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      latest = null;
    },
  };
}
