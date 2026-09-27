declare module "qrcode" {
  export function toDataURL(
    text: string,
    options?: {
      errorCorrectionLevel?: "L" | "M" | "Q" | "H";
      margin?: number;
      width?: number;
      color?: {
        dark?: string;
        light?: string;
      };
    },
  ): Promise<string>;
}
