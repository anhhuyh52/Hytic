import { getDepthMaskCapability, getDepthUnavailableMessage } from "./depthMaskCapability";

export type SharedMaskToolType = "color" | "radial" | "gradient" | "brush" | "eraser" | "luminance" | "depth";

export type MaskToolDefinition = {
  type: SharedMaskToolType;
  label: string;
  icon: string;
  availability(): { enabled: boolean; reason: string | null; loading?: boolean };
};

const enabled = () => ({ enabled: true, reason: null });

export const maskToolDefinitions: readonly MaskToolDefinition[] = [
  { type: "color", label: "Color", icon: "◉", availability: enabled },
  { type: "radial", label: "Radial", icon: "◯", availability: enabled },
  { type: "gradient", label: "Gradient", icon: "◩", availability: enabled },
  { type: "brush", label: "Brush", icon: "⌁", availability: enabled },
  { type: "eraser", label: "Eraser", icon: "⌫", availability: enabled },
  { type: "luminance", label: "Luminance", icon: "◐", availability: enabled },
  {
    type: "depth", label: "Depth", icon: "▤",
    availability: () => {
      const capability = getDepthMaskCapability();
      return {
        enabled: capability.available,
        reason: getDepthUnavailableMessage(capability.reason),
        loading: capability.status === "loading",
      };
    },
  },
];

export function getMaskToolDefinition(type: SharedMaskToolType): MaskToolDefinition {
  return maskToolDefinitions.find((tool) => tool.type === type)!;
}
