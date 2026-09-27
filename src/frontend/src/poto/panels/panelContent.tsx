import { createSignal, onCleanup, Show } from "solid-js";
import { useEditState } from "./EditStateContext";
import { isPanelEdited } from "../edited";
import { SplineCurve } from "../controls/SplineCurve";
import { ContrastCurve } from "../controls/ContrastCurve";
import { CardinalSlider, cardinalAngle, cardinalDistance } from "../controls/CardinalSlider";
import { ShadowHighlightColumn } from "../controls/ShadowHighlight";
import { PresetPanel } from "./PresetPanel";
import { MatchPanel, type MatchApi } from "./MatchPanel";
import { RefractionPanel } from "./RefractionPanel";
import { PANELS, type PanelKey } from "../panels";
import {
  NEUTRAL_HUE_VS_DENSITY,
  NEUTRAL_CHROMA_VS_DENSITY,
  NEUTRAL_LUMA_VS_DENSITY,
  NEUTRAL_HUE_VS_LUMA,
  NEUTRAL_LUMA_VS_LUMA,
  NEUTRAL_EXP_VS_LUMA,
  cloneCurveModel,
  type EditState,
  type CurvePoint,
  type ManualCurveMode,
  type CurvePreviewInput,
} from "../../engine/state/EditState";
import { SpotlightKnob } from "../controls/SpotlightKnob";
import { GradientSlider } from "../controls/GradientSlider";
import { HalationKnob } from "../controls/HalationKnob";
import { DiffusionKnob } from "../controls/DiffusionKnob";
import { TextureKnob } from "../controls/TextureKnob";
import { SpotRetouchPanel } from "../../features/retouch/SpotRetouchPanel";

import { registerPanelSubscription } from "../../app/performanceCounters";

/**
 * Renders the body for a control panel. Engine-backed panels (Balance,
 * Contrast, Saturation, Density, Chroma, Radiance, Halation, Diffusion,
 * Texture) write directly to editState so the Viewer engine grades the image.
 * Panels awaiting their bespoke control / color science show a placeholder.
 */
export function PanelContent(props: {
  panel: PanelKey;
  matchApi?: MatchApi;
  previewEditPatch?: (patch: Partial<EditState>, reason?: string) => void;
  previewCurveInput?: (input: CurvePreviewInput) => void;
  clearPreviewPatch?: (reason?: string) => void;
  commitEditHistory?: (label: string) => void;
}) {
  const unregisterSubscription = registerPanelSubscription();
  onCleanup(unregisterSubscription);

  return (
    <div class="poto-panel-body">
      {renderPanel(
        props.panel,
        props.matchApi,
        props.previewEditPatch,
        props.previewCurveInput,
        props.clearPreviewPatch,
        props.commitEditHistory,
      )}
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const dec2 = (v: number) => v.toFixed(2);
// Color Shift: stored 0..1 (0.5 neutral), shown as ±20° (magenta ↔ yellow).
const deg = (v: number) => `${Math.round((v - 0.5) * 40)}°`;
// Film Resolution: stored 0..1, shown in µm (1µm at 0 → 0.2µm at 1).
const um = (v: number) => `${(1 - 0.8 * v).toFixed(2)}µm`;

// Per-curve gradient stops behind the spline (exact legacy `colors` lists).
const HUE_STOPS = [
  "#fb3636",
  "#ed6b0d",
  "#d78f00",
  "#bcac00",
  "#95bb00",
  "#5cc824",
  "#00cb6d",
  "#00c4a6",
  "#00bac7",
  "#00afe8",
  "#129dfe",
  "#8382fb",
  "#b364e4",
  "#d53bbc",
  "#ec008e",
  "#fc0063",
];
const CHROMA_STOPS = [
  "#7f7f7f",
  "#827f7c",
  "#818078",
  "#798378",
  "#6f867f",
  "#69878b",
  "#628a98",
  "#48949b",
  "#2d9d93",
  "#27a57e",
  "#43aa60",
  "#74ac3e",
  "#a8a823",
  "#e0792a",
  "#f8396b",
  "#9900cd",
];
const GREY_STOPS = ["#242424", "#CCCCCC"];

const HALATION_SHIFT_GRADIENT = [
  { position: 0, color: "#cc00aa" },
  { position: 0.33, color: "#dd2255" },
  { position: 0.67, color: "#ee5500" },
  { position: 1, color: "#ff8800" },
] as const;

const HALATION_SAT_GRADIENT = [
  { position: 0, color: "#555555" },
  { position: 0.14, color: "#dd3333" },
  { position: 0.28, color: "#dd8800" },
  { position: 0.42, color: "#aacc00" },
  { position: 0.57, color: "#00cc88" },
  { position: 0.71, color: "#0088ff" },
  { position: 0.85, color: "#8833ff" },
  { position: 1, color: "#cc00aa" },
] as const;

const TEXTURE_CHROMA_GRADIENT = [
  { position: 0, color: "#555555" },
  { position: 0.14, color: "#cc2222" },
  { position: 0.28, color: "#cc8800" },
  { position: 0.42, color: "#99cc00" },
  { position: 0.57, color: "#00cc77" },
  { position: 0.71, color: "#0099ff" },
  { position: 0.85, color: "#7733ff" },
  { position: 1, color: "#cc00aa" },
] as const;

// Spotlight Focus uses a full gold gradient track. GradientSlider samples
// the thumb and active tick colors from these same stops.
const SPOTLIGHT_FOCUS_GRADIENT = [
  { position: 0, color: "#8f4d00" },
  { position: 0.45, color: "#c97800" },
  { position: 1, color: "#f5a000" },
] as const;


const SPOTLIGHT_POP_GRADIENT = [
  { position: 0, color: "#303030" },
  { position: 0.5, color: "#777777" },
  { position: 1, color: "#e0e0e0" },
] as const;

const SPOTLIGHT_BIAS_GRADIENT = [
  { position: 0, color: "#181818" },
  { position: 0.5, color: "#707070" },
  { position: 1, color: "#f0f0f0" },
] as const;

const DEFAULT_GREY_GRADIENT = [
  { position: 0, color: "#484848" },
  { position: 1, color: "#777777" },
] as const;

const DIFFUSION_THRESHOLD_GRADIENT = [
  { position: 0, color: "#505060" },
  { position: 1, color: "#6a6a7a" },
] as const;

const DIFFUSION_FOCUS_GRADIENT = [
  { position: 0, color: "#1a3a6e" },
  { position: 0.5, color: "#3366ee" },
  { position: 1, color: "#00aaff" },
] as const;

const TEXTURE_RESOLUTION_GRADIENT = [
  { position: 0, color: "#555555" },
  { position: 1, color: "#00aaaa" },
] as const;

// Legacy Shadow/Highlight per-channel slider track gradients (shadows | highlights).
const SH_SHADOW_GRADIENTS = [
  [{ position: 0, color: "#0078a9" }, { position: 1, color: "#b51515" }],
  [{ position: 0, color: "#a50584" }, { position: 1, color: "#006e0b" }],
  [{ position: 0, color: "#9d6f02" }, { position: 1, color: "#3723b8" }],
] as const;
const SH_HIGHLIGHT_GRADIENTS = [
  [{ position: 0, color: "#69c1ee" }, { position: 1, color: "#ec575a" }],
  [{ position: 0, color: "#e35ec7" }, { position: 1, color: "#76f47a" }],
  [{ position: 0, color: "#ffc861" }, { position: 1, color: "#5a66ff" }],
] as const;

// Link toggle; Ctrl/Cmd-click averages the three channels (legacy behavior).
function toggleShLink(
  point: "blackPoint" | "whitePoint",
  linkKey: "blackLinked" | "whiteLinked",
  linked: boolean,
  average: boolean,
  editState: EditState,
  setEditState: any,
) {
  if (linked && average) {
    const cur = editState.shadowHighlight[point];
    const avg = (cur[0] + cur[1] + cur[2]) / 3;
    setEditState("shadowHighlight", point, [avg, avg, avg]);
  }
  setEditState("shadowHighlight", linkKey, linked);
}

function renderPanel(
  key: PanelKey,
  matchApi?: MatchApi,
  previewEditPatch?: (patch: Partial<EditState>, reason?: string) => void,
  previewCurveInput?: (input: CurvePreviewInput) => void,
  clearPreviewPatch?: (reason?: string) => void,
  commitEditHistory?: (label: string) => void,
) {
  const { state: editState, setState: setEditState } = useEditState();
  const previewSlice = <K extends keyof EditState>(key: K, value: EditState[K], reason: string) => {
    previewEditPatch?.({ [key]: value } as Partial<EditState>, reason);
  };
  const finishPreview = (reason: string) => {
    queueMicrotask(() => clearPreviewPatch?.(reason));
  };

  switch (key) {
    case "presets":
      return <PresetPanel />;

    case "match":
      return matchApi ? (
        <MatchPanel
          hasImage={matchApi.hasImage}
          generate={matchApi.generate}
          getSourceMetadata={matchApi.getSourceMetadata}
          onError={matchApi.onError}
          previewEditPatch={previewEditPatch}
          clearPreviewPatch={clearPreviewPatch}
        />
      ) : null;

    case "balance": {
      // poto stores balance as âˆ’1..1 (0 neutral); the cardinal pad is legacy 0..1
      // (0.5 neutral). Convert at the boundary so readouts match legacy:
      // colorVolume = [sat, exp] â†’ Exp/Sat shown as round(200Â·v01)% (100% neutral);
      // colorBalance = [temp, tint] â†’ Tmp/Tnt shown as v01.toFixed(2) (0.50 neutral).
      const to01 = (v: number) => v / 2 + 0.5;
      const from01 = (v: number) => Math.max(-1, Math.min(1, (v - 0.5) * 2));
      const [liveVolumePoint, setLiveVolumePoint] = createSignal<[number, number] | null>(null);
      const [liveBalancePoint, setLiveBalancePoint] = createSignal<[number, number] | null>(null);
      const volumePoint = (): [number, number] =>
        liveVolumePoint() ?? [to01(editState.balance.saturation), to01(editState.balance.exposure)];
      const balancePoint = (): [number, number] =>
        liveBalancePoint() ?? [to01(editState.balance.temperature), to01(editState.balance.tint)];
      return (
        <>
          <div class="poto-balance-pads">
            <div class="poto-cardinal-col">
              <div class="poto-cardinal-readout">
                <span class="poto-balance-readout-item">
                  <span class="lbl"><img src="/assets/icons/vertical_drag_icon.svg" alt="" />Exp</span>
                  <span class="val">{`${Math.round(200 * volumePoint()[1])}%`}</span>
                </span>
                <span class="poto-balance-readout-item">
                  <span class="lbl"><img src="/assets/icons/horizontal_drag_icon.svg" alt="" />Sat</span>
                  <span class="val">{`${Math.round(200 * volumePoint()[0])}%`}</span>
                </span>
              </div>
              <CardinalSlider
                x={volumePoint()[0]}
                y={volumePoint()[1]}
                background="conic-gradient(from 90deg, rgb(225, 0, 182) 0deg, rgb(96, 0, 133) 13%, rgb(33, 14, 36) 25%, rgb(87, 89, 127) 38%, rgb(180, 163, 187) 50%, rgb(221, 244, 255) 63%, rgb(255, 255, 255) 75%, rgb(255, 117, 107) 88%, rgb(225, 0, 182) 100%)"
                onInput={(x, y) => {
                  setLiveVolumePoint([x, y]);
                  previewSlice(
                    "balance",
                    {
                      ...editState.balance,
                      bypass: false,
                      saturation: from01(x),
                      exposure: from01(y),
                    },
                    "balance-volume-drag",
                  );
                }}
                onChange={(x, y) => {
                  setEditState("balance", {
                    ...editState.balance,
                    bypass: false,
                    saturation: from01(x),
                    exposure: from01(y),
                  });
                  setLiveVolumePoint(null);
                  finishPreview("balance-volume-commit");
                }}
              />
            </div>
            <div class="poto-cardinal-col">
              <div class="poto-cardinal-readout">
                <span class="poto-balance-readout-item">
                  <span class="lbl"><img src="/assets/icons/vertical_drag_icon.svg" alt="" />Tint</span>
                  <span class="val">{balancePoint()[1].toFixed(2)}</span>
                </span>
                <span class="poto-balance-readout-item">
                  <span class="lbl"><img src="/assets/icons/horizontal_drag_icon.svg" alt="" />Temp</span>
                  <span class="val">{balancePoint()[0].toFixed(2)}</span>
                </span>
              </div>
              <CardinalSlider
                x={balancePoint()[0]}
                y={balancePoint()[1]}
                background="linear-gradient(180deg, rgba(119,97,255,.30), transparent 50%, rgba(63,170,67,.30)), var(--temp-gradient)"
                onInput={(x, y) => {
                  setLiveBalancePoint([x, y]);
                  previewSlice(
                    "balance",
                    {
                      ...editState.balance,
                      bypass: false,
                      temperature: from01(x),
                      tint: from01(y),
                    },
                    "balance-temperature-drag",
                  );
                }}
                onChange={(x, y) => {
                  setEditState("balance", {
                    ...editState.balance,
                    bypass: false,
                    temperature: from01(x),
                    tint: from01(y),
                  });
                  setLiveBalancePoint(null);
                  finishPreview("balance-temperature-commit");
                }}
              />
            </div>
          </div>
        </>
      );
    }

    case "contrast":
      // Legacy lumaVsLuma: a luma-vs-luma tone curve (identity diagonal neutral),
      // run through the faithful legacy lch_mod op (the `tone` engine slice). The
      // rolling-slider morphs the curve toward contrast +/âˆ’ preset S-shapes.
      return (
        <ContrastCurve
          points={editState.tone.curve.points}
          defaultPoints={NEUTRAL_LUMA_VS_LUMA.points}
          mode={editState.tone.curve.mode}
          colors={GREY_STOPS}
          onInput={(pts: CurvePoint[]) => {
            if (previewCurveInput) {
              previewCurveInput({ key: "tone", points: pts, mode: editState.tone.curve.mode });
            } else {
              previewSlice(
                "tone",
                { ...editState.tone, bypass: false, curve: { ...editState.tone.curve, points: pts } },
                "tone-curve-drag",
              );
            }
          }}
          onChange={(pts: CurvePoint[]) => {
            setEditState("tone", {
              ...editState.tone,
              bypass: false,
              curve: { ...editState.tone.curve, points: pts },
            });
            finishPreview("tone-curve-commit");
          }}
          onModeChange={(m: ManualCurveMode) => {
            setEditState("tone", "curve", "mode", m);
            if (editState.tone.bypass) setEditState("tone", "bypass", false);
          }}
          onReset={() => setEditState("tone", "curve", cloneCurveModel(NEUTRAL_LUMA_VS_LUMA))}
          resetActive={isPanelEdited("contrast")}
        />
      );

    case "saturation":
      // Legacy lumaVsDensity: saturation amount vs luma (0.5 = neutral).
      return (
        <SplineCurve
          points={editState.saturation.curve.points}
          defaultPoints={NEUTRAL_LUMA_VS_DENSITY.points}
          mode={editState.saturation.curve.mode}
          yMin={0}
          yMax={1}
          colors={GREY_STOPS}
          onInput={(pts: CurvePoint[]) => {
            if (previewCurveInput) {
              previewCurveInput({ key: "saturation", points: pts, mode: editState.saturation.curve.mode });
            } else {
              previewSlice(
                "saturation",
                {
                  ...editState.saturation,
                  bypass: false,
                  curve: { ...editState.saturation.curve, points: pts },
                },
                "saturation-curve-drag",
              );
            }
          }}
          onChange={(pts: CurvePoint[]) => {
            setEditState("saturation", {
              ...editState.saturation,
              bypass: false,
              curve: { ...editState.saturation.curve, points: pts },
            });
            finishPreview("saturation-curve-commit");
          }}
          onModeChange={(m: ManualCurveMode) => {
            setEditState("saturation", "curve", "mode", m);
            if (editState.saturation.bypass) setEditState("saturation", "bypass", false);
          }}
          onReset={() =>
            setEditState("saturation", "curve", cloneCurveModel(NEUTRAL_LUMA_VS_DENSITY))
          }
          resetActive={isPanelEdited("saturation")}
        />
      );

    case "density":
      // Legacy hueVsDensity: density vs hue (0.5 = neutral).
      return (
        <SplineCurve
          points={editState.densityChroma.density.points}
          defaultPoints={NEUTRAL_HUE_VS_DENSITY.points}
          mode={editState.densityChroma.density.mode}
          yMin={0}
          yMax={1}
          colors={HUE_STOPS}
          wrapAround
          onInput={(pts: CurvePoint[]) => {
            if (previewCurveInput) {
              previewCurveInput({ key: "densityChroma.density", points: pts, mode: editState.densityChroma.density.mode });
            } else {
              previewSlice(
                "densityChroma",
                {
                  ...editState.densityChroma,
                  bypass: false,
                  densityBypass: false,
                  density: { ...editState.densityChroma.density, points: pts },
                },
                "density-curve-drag",
              );
            }
          }}
          onChange={(pts: CurvePoint[]) => {
            setEditState("densityChroma", {
              ...editState.densityChroma,
              bypass: false,
              densityBypass: false,
              density: { ...editState.densityChroma.density, points: pts },
            });
            finishPreview("density-curve-commit");
          }}
          onModeChange={(m: ManualCurveMode) => {
            setEditState("densityChroma", "density", "mode", m);
            if (editState.densityChroma.bypass) setEditState("densityChroma", "bypass", false);
            if (editState.densityChroma.densityBypass) setEditState("densityChroma", "densityBypass", false);
          }}
          onReset={() =>
            setEditState("densityChroma", "density", cloneCurveModel(NEUTRAL_HUE_VS_DENSITY))
          }
          resetActive={isPanelEdited("density")}
        />
      );

    case "chroma":
      // Legacy chromaVsDensity: density vs chroma (0.5 = neutral).
      return (
        <SplineCurve
          points={editState.densityChroma.chroma.points}
          defaultPoints={NEUTRAL_CHROMA_VS_DENSITY.points}
          mode={editState.densityChroma.chroma.mode}
          yMin={0}
          yMax={1}
          colors={CHROMA_STOPS}
          onInput={(pts: CurvePoint[]) => {
            if (previewCurveInput) {
              previewCurveInput({ key: "densityChroma.chroma", points: pts, mode: editState.densityChroma.chroma.mode });
            } else {
              previewSlice(
                "densityChroma",
                {
                  ...editState.densityChroma,
                  bypass: false,
                  chromaBypass: false,
                  chroma: { ...editState.densityChroma.chroma, points: pts },
                },
                "chroma-curve-drag",
              );
            }
          }}
          onChange={(pts: CurvePoint[]) => {
            setEditState("densityChroma", {
              ...editState.densityChroma,
              bypass: false,
              chromaBypass: false,
              chroma: { ...editState.densityChroma.chroma, points: pts },
            });
            finishPreview("chroma-curve-commit");
          }}
          onModeChange={(m: ManualCurveMode) => {
            setEditState("densityChroma", "chroma", "mode", m);
            if (editState.densityChroma.bypass) setEditState("densityChroma", "bypass", false);
            if (editState.densityChroma.chromaBypass) setEditState("densityChroma", "chromaBypass", false);
          }}
          onReset={() =>
            setEditState("densityChroma", "chroma", cloneCurveModel(NEUTRAL_CHROMA_VS_DENSITY))
          }
          resetActive={isPanelEdited("chroma")}
        />
      );

    case "radiance":
      // Legacy hueVsLuma: per-hue luma modulation (0.5 = neutral).
      return (
        <SplineCurve
          points={editState.radiance.curve.points}
          defaultPoints={NEUTRAL_HUE_VS_LUMA.points}
          mode={editState.radiance.curve.mode}
          yMin={0}
          yMax={1}
          colors={HUE_STOPS}
          wrapAround
          onInput={(pts: CurvePoint[]) => {
            if (previewCurveInput) {
              previewCurveInput({ key: "radiance", points: pts, mode: editState.radiance.curve.mode });
            } else {
              previewSlice(
                "radiance",
                {
                  ...editState.radiance,
                  bypass: false,
                  curve: { ...editState.radiance.curve, points: pts },
                },
                "radiance-curve-drag",
              );
            }
          }}
          onChange={(pts: CurvePoint[]) => {
            setEditState("radiance", {
              ...editState.radiance,
              bypass: false,
              curve: { ...editState.radiance.curve, points: pts },
            });
            finishPreview("radiance-curve-commit");
          }}
          onModeChange={(m: ManualCurveMode) => {
            setEditState("radiance", "curve", "mode", m);
            if (editState.radiance.bypass) setEditState("radiance", "bypass", false);
          }}
          onReset={() => setEditState("radiance", "curve", cloneCurveModel(NEUTRAL_HUE_VS_LUMA))}
          resetActive={isPanelEdited("radiance")}
        />
      );

    case "halation":
      return (
        <div class="poto-fx-row">
          <div class="poto-fx-left">
            <HalationKnob
              label="Halation"
              min={0}
              max={1}
              default={0}
              format={pct}
              value={editState.halation.amount}
              onInput={(v) =>
                previewSlice(
                  "halation",
                  { ...editState.halation, bypass: false, amount: v },
                  "halation-amount-drag",
                )
              }
              onChange={(v) => {
                setEditState("halation", { ...editState.halation, bypass: false, amount: v });
                finishPreview("halation-amount-commit");
              }}
            />
          </div>
          <div class="poto-fx-sliders">
            {/* Light Spill â€” grey fill */}
            <GradientSlider
              gradientStops={DEFAULT_GREY_GRADIENT}
              label="Light Spill"
              min={0}
              max={1}
              default={0.5}
              format={dec2}
              title="Controls how much halation spills into the darker image areas"
              value={editState.halation.spill}
              onInput={(v) =>
                previewSlice(
                  "halation",
                  { ...editState.halation, bypass: false, spill: v },
                  "halation-spill-drag",
                )
              }
              onChange={(v) => {
                setEditState("halation", { ...editState.halation, bypass: false, spill: v });
                finishPreview("halation-spill-commit");
              }}
            />
            {/* Color Shift â€” full magentaâ†’orange gradient track, bipolar */}
            <GradientSlider
              gradientStops={HALATION_SHIFT_GRADIENT}
              bipolar
              label="Color Shift"
              min={0}
              max={1}
              default={0.5}
              format={deg}
              title="Shift halation hue toward magenta (left) or yellow (right)"
              value={editState.halation.hue}
              onInput={(v) =>
                previewSlice(
                  "halation",
                  { ...editState.halation, bypass: false, hue: v },
                  "halation-hue-drag",
                )
              }
              onChange={(v) => {
                setEditState("halation", { ...editState.halation, bypass: false, hue: v });
                finishPreview("halation-hue-commit");
              }}
            />
            {/* Saturation â€” greyâ†’rainbow gradient track */}
            <GradientSlider
              gradientStops={HALATION_SAT_GRADIENT}
              label="Saturation"
              min={0}
              max={1}
              default={0.5}
              format={pct}
              title="Adjust the saturation of the glow. Set to 0% for white glow"
              value={editState.halation.saturation}
              onInput={(v) =>
                previewSlice(
                  "halation",
                  { ...editState.halation, bypass: false, saturation: v },
                  "halation-saturation-drag",
                )
              }
              onChange={(v) => {
                setEditState("halation", { ...editState.halation, bypass: false, saturation: v });
                finishPreview("halation-saturation-commit");
              }}
            />
          </div>
        </div>
      );

    case "retouch":
      return <SpotRetouchPanel onHistory={commitEditHistory} />;

    case "diffusion":
      return (
        <div class="poto-fx-row poto-fx-row--viewport-center">
          <div class="poto-fx-left">
            <DiffusionKnob
              label="Diffusion"
              min={0}
              max={1}
              default={0}
              format={pct}
              value={editState.diffusion.amount}
              onInput={(v) =>
                previewSlice(
                  "diffusion",
                  { ...editState.diffusion, bypass: false, amount: v },
                  "diffusion-amount-drag",
                )
              }
              onChange={(v) => {
                setEditState("diffusion", { ...editState.diffusion, bypass: false, amount: v });
                finishPreview("diffusion-amount-commit");
              }}
            />
          </div>
          <div class="poto-fx-sliders">
            {/* Fog â€” grey fill */}
            <GradientSlider
              gradientStops={DEFAULT_GREY_GRADIENT}
              label="Fog"
              min={0}
              max={1}
              default={0}
              format={pct}
              title="Increases black levels at larger diffusion filter radii"
              value={editState.diffusion.fog}
              onInput={(v) =>
                previewSlice(
                  "diffusion",
                  { ...editState.diffusion, bypass: false, fog: v },
                  "diffusion-fog-drag",
                )
              }
              onChange={(v) => {
                setEditState("diffusion", { ...editState.diffusion, bypass: false, fog: v });
                finishPreview("diffusion-fog-commit");
              }}
            />
            <GradientSlider
              gradientStops={DIFFUSION_THRESHOLD_GRADIENT}
              label="Threshold"
              min={0}
              max={1}
              default={0}
              format={pct}
              title="Protects darker areas from being affected by the diffusion filter"
              value={editState.diffusion.threshold}
              onInput={(v) =>
                previewSlice(
                  "diffusion",
                  { ...editState.diffusion, bypass: false, threshold: v },
                  "diffusion-threshold-drag",
                )
              }
              onChange={(v) => {
                setEditState("diffusion", { ...editState.diffusion, bypass: false, threshold: v });
                finishPreview("diffusion-threshold-commit");
              }}
            />
            <GradientSlider
              gradientStops={DIFFUSION_FOCUS_GRADIENT}
              label="Focus"
              min={0}
              max={1}
              default={0}
              format={pct}
              title="Protects the focus point from the diffusion filter"
              value={editState.diffusion.focusProtect}
              onInput={(v) =>
                previewSlice(
                  "diffusion",
                  { ...editState.diffusion, bypass: false, focusProtect: v },
                  "diffusion-focus-drag",
                )
              }
              onChange={(v) => {
                setEditState("diffusion", {
                  ...editState.diffusion,
                  bypass: false,
                  focusProtect: v,
                });
                finishPreview("diffusion-focus-commit");
              }}
            />
          </div>

        </div>
      );
    case "texture":
      return (
        <div class="poto-fx-row">
          <div class="poto-fx-left">
            <TextureKnob
              label="Film Grain"
              min={0}
              max={1}
              default={0}
              format={pct}
              value={editState.grain.amount}
              onInput={(v) =>
                previewSlice(
                  "grain",
                  { ...editState.grain, bypass: false, amount: v },
                  "grain-amount-drag",
                )
              }
              onChange={(v) => {
                setEditState("grain", { ...editState.grain, bypass: false, amount: v });
                finishPreview("grain-amount-commit");
              }}
            />
          </div>
          <div class="poto-fx-sliders">
            {/* Film Acutance â€” grey fill */}
            <GradientSlider
              gradientStops={DEFAULT_GREY_GRADIENT}
              label="Film Acutance"
              min={0}
              max={1}
              default={0}
              format={pct}
              title="Adjust localized film contrast via image-adaptive acutance rendering"
              value={editState.grain.acutance}
              onInput={(v) =>
                previewSlice(
                  "grain",
                  { ...editState.grain, bypass: false, acutance: v },
                  "grain-acutance-drag",
                )
              }
              onChange={(v) => {
                setEditState("grain", { ...editState.grain, bypass: false, acutance: v });
                finishPreview("grain-acutance-commit");
              }}
            />
            {/* Film Resolution — grey → teal gradient fill */}
            <GradientSlider
              gradientStops={TEXTURE_RESOLUTION_GRADIENT}
              label="Film Resolution"
              min={0}
              max={1}
              default={0.5}
              format={um}
              title="Adjust sub-pixel detail with grain-based, scan-resolution emulation. View at 100% zoom level"
              value={editState.grain.resolution}
              onInput={(v) =>
                previewSlice(
                  "grain",
                  { ...editState.grain, bypass: false, resolution: v },
                  "grain-resolution-drag",
                )
              }
              onChange={(v) => {
                setEditState("grain", { ...editState.grain, bypass: false, resolution: v });
                finishPreview("grain-resolution-commit");
              }}
            />
            {/* Grain Chroma — full grey→rainbow gradient track */}
            <GradientSlider
              gradientStops={TEXTURE_CHROMA_GRADIENT}
              label="Grain Chroma"
              min={0}
              max={1}
              default={0.5}
              format={pct}
              title="Make the film grain more or less colorful"
              value={editState.grain.colorAmount}
              onInput={(v) =>
                previewSlice(
                  "grain",
                  { ...editState.grain, bypass: false, colorAmount: v },
                  "grain-chroma-drag",
                )
              }
              onChange={(v) => {
                setEditState("grain", { ...editState.grain, bypass: false, colorAmount: v });
                finishPreview("grain-chroma-commit");
              }}
            />
          </div>
        </div>
      );
    case "spotlight":
      return (
        <div class="poto-fx-row poto-fx-row--viewport-center">
          <div class="poto-fx-left">
            <SpotlightKnob
              label="Spotlight"
              min={0}
              max={1}
              default={0}
              format={pct}
              value={editState.spotlight.amount}
              onInput={(v) =>
                previewSlice(
                  "spotlight",
                  { ...editState.spotlight, bypass: false, amount: v },
                  "spotlight-amount-drag",
                )
              }
              onChange={(v) => {
                setEditState("spotlight", { ...editState.spotlight, bypass: false, amount: v });
                finishPreview("spotlight-amount-commit");
              }}
            />

          </div>
          <div class="poto-fx-sliders">
            {/* Pop â€” grey fill, no gold */}
            <GradientSlider
              bipolar
              gradientStops={SPOTLIGHT_POP_GRADIENT}
              label="Pop"
              min={0}
              max={1}
              default={0.5}
              format={pct}
              title="Adjust micro contrast in localized spotlight area"
              value={editState.spotlight.contrast}
              onInput={(v) =>
                previewSlice(
                  "spotlight",
                  {
                    ...editState.spotlight,
                    bypass: false,
                    contrast: v,
                  },
                  "spotlight-contrast-drag",
                )
              }
              onChange={(v) => {
                setEditState("spotlight", {
                  ...editState.spotlight,
                  bypass: false,
                  contrast: v,
                });

                finishPreview("spotlight-contrast-commit");
              }}
            />
            {/* Bias â€” grey fill, no gold */}
            <GradientSlider
              bipolar
              gradientStops={SPOTLIGHT_BIAS_GRADIENT}
              label="Bias"
              min={0}
              max={1}
              default={0.5}
              format={pct}
              title="Keep centered to balance darker background and brighter subject."
              value={editState.spotlight.bias}
              onInput={(v) =>
                previewSlice(
                  "spotlight",
                  {
                    ...editState.spotlight,
                    bypass: false,
                    bias: v,
                  },
                  "spotlight-bias-drag",
                )
              }
              onChange={(v) => {
                setEditState("spotlight", {
                  ...editState.spotlight,
                  bypass: false,
                  bias: v,
                });

                finishPreview("spotlight-bias-commit");
              }}
            />
            {/* Focus â€” gold gradient fill, matches the knob arc */}
            <GradientSlider
              gold
              gradientStops={SPOTLIGHT_FOCUS_GRADIENT}
              label="Focus"
              min={0}
              max={1}
              default={0.5}
              format={pct}
              title="Protects the focus point from relighting"
              value={editState.spotlight.focus}
              onInput={(v) =>
                previewSlice(
                  "spotlight",
                  { ...editState.spotlight, bypass: false, focus: v },
                  "spotlight-focus-drag",
                )
              }
              onChange={(v) => {
                setEditState("spotlight", { ...editState.spotlight, bypass: false, focus: v });
                finishPreview("spotlight-focus-commit");
              }}
            />
          </div>
        </div>
      );

    case "scattering": {
      // Two circular cardinal wheels; readouts show the polar angle (not xÂ·360) +
      // radial distance, matching legacy getAngle()/getDistance().
      const wheelBg = (spectrum: string) =>
        `radial-gradient(circle, #2c2b29 0%, rgba(44,43,41,0) 58%), ${spectrum}`;
      const [liveShadowPoint, setLiveShadowPoint] = createSignal<[number, number] | null>(null);
      const [liveHighlightPoint, setLiveHighlightPoint] = createSignal<[number, number] | null>(
        null,
      );
      const shadowPoint = (): [number, number] =>
        liveShadowPoint() ?? [editState.scattering.shadowX, editState.scattering.shadowY];
      const highlightPoint = (): [number, number] =>
        liveHighlightPoint() ?? [editState.scattering.highlightX, editState.scattering.highlightY];
      return (
        <div class="poto-cardinal-wheels">
          <div class="poto-cardinal-col">
            <div class="poto-cardinal-readout poto-cardinal-readout--wheel">
              <img class="ic" src="/assets/icons/shadows_icon.svg" alt="Shadows" />
              <span class="val">
                H:{" "}
                {Math.floor(cardinalAngle(shadowPoint()[0], shadowPoint()[1]))}
                °
                S:{" "}
                {Math.round(100 * cardinalDistance(shadowPoint()[0], shadowPoint()[1]))}
                %
              </span>
            </div>
            <CardinalSlider
              circular
              background={wheelBg("var(--spectrum-shadows)")}
              x={shadowPoint()[0]}
              y={shadowPoint()[1]}
              onInput={(x, y) => {
                setLiveShadowPoint([x, y]);
                previewSlice(
                  "scattering",
                  { ...editState.scattering, bypass: false, shadowX: x, shadowY: y },
                  "scattering-shadow-drag",
                );
              }}
              onChange={(x, y) => {
                setEditState("scattering", {
                  ...editState.scattering,
                  bypass: false,
                  shadowX: x,
                  shadowY: y,
                });
                setLiveShadowPoint(null);
                finishPreview("scattering-shadow-commit");
              }}
            />
          </div>
          <div class="poto-cardinal-col">
            <div class="poto-cardinal-readout poto-cardinal-readout--wheel">
              <img class="ic" src="/assets/icons/highlights_icon.svg" alt="Highlights" />
              <span class="val">
                H:{" "}
                {Math.floor(cardinalAngle(highlightPoint()[0], highlightPoint()[1]))}
                °
                S:{" "}
                {Math.round(100 * cardinalDistance(highlightPoint()[0], highlightPoint()[1]))}
                %
              </span>
            </div>
            <CardinalSlider
              circular
              background={wheelBg("var(--spectrum-highlights)")}
              x={highlightPoint()[0]}
              y={highlightPoint()[1]}
              onInput={(x, y) => {
                setLiveHighlightPoint([x, y]);
                previewSlice(
                  "scattering",
                  { ...editState.scattering, bypass: false, highlightX: x, highlightY: y },
                  "scattering-highlight-drag",
                );
              }}
              onChange={(x, y) => {
                setEditState("scattering", {
                  ...editState.scattering,
                  bypass: false,
                  highlightX: x,
                  highlightY: y,
                });
                setLiveHighlightPoint(null);
                finishPreview("scattering-highlight-commit");
              }}
            />
          </div>
        </div>
      );
    }

    case "refraction":
      return (
        <RefractionPanel
          previewEditPatch={previewEditPatch}
          clearPreviewPatch={clearPreviewPatch}
        />
      );

    case "exposure":
      // Legacy expVsLuma: per-luma brightness offset curve (0.5 neutral).
      return (
        <SplineCurve
          points={editState.exposure.curve.points}
          defaultPoints={NEUTRAL_EXP_VS_LUMA.points}
          mode={editState.exposure.curve.mode}
          yMin={0}
          yMax={1}
          colors={GREY_STOPS}
          onInput={(pts: CurvePoint[]) => {
            if (previewCurveInput) {
              previewCurveInput({ key: "exposure", points: pts, mode: editState.exposure.curve.mode });
            } else {
              previewSlice(
                "exposure",
                {
                  ...editState.exposure,
                  bypass: false,
                  curve: { ...editState.exposure.curve, points: pts },
                },
                "exposure-curve-drag",
              );
            }
          }}
          onChange={(pts: CurvePoint[]) => {
            setEditState("exposure", {
              ...editState.exposure,
              bypass: false,
              curve: { ...editState.exposure.curve, points: pts },
            });
            finishPreview("exposure-curve-commit");
          }}
          onModeChange={(m: ManualCurveMode) => {
            setEditState("exposure", "curve", "mode", m);
            if (editState.exposure.bypass) setEditState("exposure", "bypass", false);
          }}
          onReset={() => setEditState("exposure", "curve", cloneCurveModel(NEUTRAL_EXP_VS_LUMA))}
          resetActive={isPanelEdited("exposure")}
        />
      );

    case "rgb":
      // Legacy "Shadow Highlight": per-channel blackPoint (shadows) + whitePoint
      // (highlights) range mapping (rng_mod), as two linked-RGB controls.
      return (
        <div class="poto-sh">
          <ShadowHighlightColumn
            icon="/assets/icons/shadows_icon.svg"
            values={editState.shadowHighlight.blackPoint}
            linked={editState.shadowHighlight.blackLinked}
            gradients={SH_SHADOW_GRADIENTS}
            onValuesInput={(pt) => {
              previewSlice("shadowHighlight", { ...editState.shadowHighlight, bypass: false, blackPoint: pt }, "rgb-black-point");
            }}
            onValuesChange={(pt) => {
              setEditState("shadowHighlight", {
                ...editState.shadowHighlight,
                bypass: false,
                blackPoint: pt,
              });
              finishPreview("rgb-black-point-commit");
            }}
            onToggleLink={(linked, avg) => toggleShLink("blackPoint", "blackLinked", linked, avg, editState, setEditState)}
          />
          <ShadowHighlightColumn
            icon="/assets/icons/highlights_icon.svg"
            values={editState.shadowHighlight.whitePoint}
            linked={editState.shadowHighlight.whiteLinked}
            gradients={SH_HIGHLIGHT_GRADIENTS}
            onValuesInput={(pt) => {
              previewSlice("shadowHighlight", { ...editState.shadowHighlight, bypass: false, whitePoint: pt }, "rgb-white-point");
            }}
            onValuesChange={(pt) => {
              setEditState("shadowHighlight", {
                ...editState.shadowHighlight,
                bypass: false,
                whitePoint: pt,
              });
              finishPreview("rgb-white-point-commit");
            }}
            onToggleLink={(linked, avg) => toggleShLink("whitePoint", "whiteLinked", linked, avg, editState, setEditState)}
          />
        </div>
      );

    default:
      return <PanelPlaceholder panel={key} />;
  }
}

/** Placeholder for panels whose bespoke control / color science lands later. */
function PanelPlaceholder(props: { panel: PanelKey }) {
  const def = () => PANELS.find((p) => p.key === props.panel);
  return (
    <div class="poto-panel-note">
      <Show when={def()?.helpScope}>
        <span class="scope">{def()!.helpScope}</span>
      </Show>
      <p>{def()?.helpBlurb}</p>
      <p style={{ opacity: ".6" }}>Dedicated controls for this panel are coming in a later build phase.</p>
    </div>
  );
}