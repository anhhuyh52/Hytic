self.wasmBinaryFile = "ubitmap.wasm";
importScripts("ubitmap.asm.js");

const runtimeReady = Module.calledRun
  ? Promise.resolve()
  : new Promise((resolve) => {
      Module.onRuntimeInitialized = resolve;
    });

self.onmessage = async (event) => {
  const { id, file, title } = event.data;
  try {
    await runtimeReady;
    try { FS.mkdir("i"); } catch {}
    try { FS.mkdir("o"); } catch {}
    FS.mount(WORKERFS, { files: [file] }, "i");
    Module.options({
      title,
      group: "Color.io",
      gamut: "clip",
      amount: 100,
      input: "i/",
      max: 200,
      min: 0,
      output: "o/",
      primaries: "sRGB",
      size: 0,
      strength: "low",
    });
    FS.unmount("i");
    const contents = FS.open("o/", "r").node.contents;
    const outputName = Object.keys(contents)[0];
    if (!outputName) throw new Error("XMP encoder produced no profile");
    const outputPath = `o/${outputName}`;
    const bytes = FS.readFile(outputPath);
    FS.unlink(outputPath);
    self.postMessage({ id, ok: true, buffer: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
