declare module "client-zip" {
  export type ZipInput = {
    name: string;
    input: Blob | File | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array> | string;
    lastModified?: Date | number;
  };

  export function downloadZip(files: Iterable<ZipInput>): Response;
}
