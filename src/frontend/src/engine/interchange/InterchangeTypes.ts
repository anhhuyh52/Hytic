export type LUTOrdering = "blue-major-red-fastest";

export type LUTInterchangeSize = 17 | 33 | 64;

export type RGBTriplet = [number, number, number];

export type LUTData3D = {
  size: number;
  data: Float32Array;
  ordering: LUTOrdering;

  inputMin: RGBTriplet;
  inputMax: RGBTriplet;

  outputMin: RGBTriplet;
  outputMax: RGBTriplet;
};

export type LUTInterchangeMetadata = {
  title: string;
  description?: string;

  inputColorSpace: string;
  workingColorSpace: string;
  displayColorSpace: string;
  viewTransform: string;

  generatedAt: number;
  appVersion?: string;

  notes: string[];
};

export type LUTImportResult = {
  kind: "cube" | "clf";
  title?: string;
  size?: number;
  lut?: LUTData3D;
  warnings: string[];
};
