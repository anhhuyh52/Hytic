import { createSignal, untrack } from "solid-js";
import { editState as globalEditState } from "../../app/editor-store";
import { useEditState } from "./EditStateContext";
import { HexagonalSlider } from "../controls/HexagonalSlider";
import { NumericalSlider } from "../controls/NumericalSlider";
import type { EditState } from "../../engine/state/EditState";
import { IDENTITY_REFRACTION_VECTORS } from "../../engine/state/EditState";

/**
 * RefractionPanel.tsx — Flat minimal horizontal layout.
 *
 * Updated:
 * - compact top row
 * - no wrapping on readout/separation row
 * - two hex wheels stay horizontally aligned
 * - reduced spacing/padding
 * - keeps logic/state unchanged
 */

const PRIMARY_COLORS = [
  "var(--theme-red-soft)",
  "var(--theme-yellow-soft)",
  "var(--theme-green-soft)",
  "var(--theme-cyan-soft)",
  "var(--theme-blue-soft)",
  "var(--theme-magenta-soft)",
];

type Pt = [number, number];

const D = {
  bg: "#1e1e1e",

  pill: "#242426",
  pillBorder: "#34343a",

  pillActive: "#2b211d",
  pillActiveBorder: "#6a2d16",

  text: "#c8c8c8",
  muted: "#606060",
  sep: "#383840",

  accent: "#E1DCC9",
  focusRing: "#6a2d16",

  font: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Source Sans Pro", Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`,
  mono: "'JetBrains Mono', 'Fira Code', monospace",
} as const;

const shadowPts = (mv: number[]): Pt[] => {
  return Array.from({ length: 6 }, (_, i) => [mv[i * 4], mv[i * 4 + 1]] as Pt);
};

const highlightPts = (mv: number[]): Pt[] => {
  return Array.from({ length: 6 }, (_, i) => [mv[i * 4 + 2], mv[i * 4 + 3]] as Pt);
};

const DEFAULT_POINTS = shadowPts(IDENTITY_REFRACTION_VECTORS);

function pointsMatch(mv: number[]): boolean {
  for (let i = 0; i < 6; i++) {
    if (mv[i * 4] !== mv[i * 4 + 2] || mv[i * 4 + 1] !== mv[i * 4 + 3]) {
      return false;
    }
  }
  return true;
}

function ReadoutPill(props: { icon: string; alt: string; h: string; s: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        "align-items": "center",
        "justify-content": "center",
        gap: "3px",
        width: "min(116px, 100%)",
        padding: "4px 6px",
        "border-radius": "999px",
        background: D.pill,
        border: `1px solid ${D.pillBorder}`,
        "box-sizing": "border-box",
        "font-family": D.font,
        "white-space": "nowrap",
        "min-width": "0",
      }}
    >
      <img
        src={props.icon}
        alt={props.alt}
        draggable={false}
        style={{
          width: "10px",
          height: "10px",
          opacity: "0.5",
          "flex-shrink": "0",
        }}
      />

      <span
        style={{
          "font-size": "9px",
          "font-weight": "500",
          color: D.muted,
          "letter-spacing": "0.04em",
        }}
      >
        H
      </span>

      <span
        style={{
           
          "font-size": "10px",
          "font-weight": "600",
          color: D.text,
          "font-variant-numeric": "tabular-nums",
        }}
      >
        {props.h}
      </span>

      <span
        style={{
          color: D.sep,
          "font-size": "10px",
        }}
      >
        ·
      </span>

      <span
        style={{
          "font-size": "9px",
          "font-weight": "500",
          color: D.muted,
          "letter-spacing": "0.04em",
        }}
      >
        S
      </span>

      <span
        style={{
           
          "font-size": "10px",
          "font-weight": "600",
          color: D.text,
          "font-variant-numeric": "tabular-nums",
        }}
      >
        {props.s}
      </span>
    </div>
  );
}

function SepPill(props: {
  linked: boolean;
  onToggle: (v: boolean) => void;
  sepValue: number;
  onSepInput: (v: number) => void;
  onSepChange: (v: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "4px",
        width: "100%",
        padding: "4px 6px",
        "border-radius": "999px",
        background: D.pill,
        border: `1px solid ${D.pillBorder}`,
        "box-sizing": "border-box",
        "min-width": "0",
        "max-width": "132px",
      }}
    >
      <button
        type="button"
        title="Link Dark & Light Controls"
        aria-pressed={props.linked}
        onClick={() => props.onToggle(!props.linked)}
        onFocus={(e) => {
          e.currentTarget.style.outline = `1px solid ${D.focusRing}`;
          e.currentTarget.style.outlineOffset = "2px";
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = "none";
          e.currentTarget.style.outlineOffset = "0";
        }}
        style={{
          display: "inline-flex",
          "align-items": "center",
          "justify-content": "center",
          padding: "2px 5px",
          "border-radius": "999px",
          border: `1px solid ${props.linked ? D.pillActiveBorder : D.pillBorder}`,
          cursor: "pointer",
          "font-family": D.font,
          "font-size": "8px",
          "font-weight": "600",
          "letter-spacing": "0.06em",
          "text-transform": "uppercase",
          "user-select": "none",
          color: props.linked ? D.accent : D.muted,
          background: props.linked ? D.pillActive : D.bg,
          outline: "none",
          "white-space": "nowrap",
          transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
        }}
      >
        {props.linked ? "Linked" : "Link"}
      </button>

      <div
        style={{
          width: "1px",
          height: "14px",
          background: D.sep,
          opacity: "0.8",
          "flex-shrink": "0",
        }}
      />

      <span
        style={{
          "font-family": D.font,
          "font-size": "8px",
          "font-weight": "600",
          color: D.muted,
          "letter-spacing": "0.06em",
          "text-transform": "uppercase",
          "white-space": "nowrap",
          opacity: props.linked ? "0.35" : "1",
          transition: "opacity 0.15s ease",
          "flex-shrink": "0",
        }}
      >
        Sep
      </span>

      <div
        style={{
          flex: "1 1 auto",
          "min-width": "34px",
          opacity: props.linked ? "0.35" : "1",
          transition: "opacity 0.15s ease",
        }}
      >
        <NumericalSlider
          value={props.sepValue}
          min={0}
          max={1}
          step={0.01}
          decimals={3}
          disabled={props.linked}
          title="Separation between Dark & Light. Higher values yield more separation."
          onInput={props.onSepInput}
          onChange={props.onSepChange}
        />
      </div>
    </div>
  );
}

export function RefractionPanel(props: {
  previewEditPatch?: (patch: Partial<EditState>, reason?: string) => void;
  clearPreviewPatch?: (reason?: string) => void;
}) {
  const ctx = useEditState();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { setState } = ctx;
  // Detect if we're in a local mask context (ctx is defined) or the global fallback.
  const isLocalContext = () => ctx !== null;

  const [selShadow, setSelShadow] = createSignal(0);
  const [selHighlight, setSelHighlight] = createSignal(0);
  const [liveVectors, setLiveVectors] = createSignal<number[] | null>(null);
  const [liveSeparation, setLiveSeparation] = createSignal<number | null>(null);
  const state = () => ctx.state;
  const vectors = () => liveVectors() ?? state().refraction.mapVectors;
  const separation = () => liveSeparation() ?? state().refraction.separation;
  const [linked, setLinked] = createSignal(pointsMatch(vectors()));

  const preview = (mapVectors: number[], nextSeparation = separation()) => {
    if (isLocalContext()) {
      setLiveVectors(mapVectors);
      props.previewEditPatch?.(
        {
          refraction: {
            ...state().refraction,
            bypass: false,
            mapVectors,
            separation: nextSeparation,
          },
        },
        "refraction-drag",
      );
    } else {
      setLiveVectors(mapVectors);
      props.previewEditPatch?.(
        {
          refraction: {
            ...globalEditState.refraction,
            bypass: false,
            mapVectors,
            separation: nextSeparation,
          },
        },
        "refraction-drag",
      );
    }
  };

  function nextShadow(pts: Pt[]) {
    const next = [...vectors()];

    for (let i = 0; i < 6; i++) {
      next[i * 4] = pts[i][0];
      next[i * 4 + 1] = pts[i][1];

      if (linked()) {
        next[i * 4 + 2] = pts[i][0];
        next[i * 4 + 3] = pts[i][1];
      }
    }

    return next;
  }

  function nextHighlight(pts: Pt[]) {
    const next = [...vectors()];

    for (let i = 0; i < 6; i++) {
      next[i * 4 + 2] = pts[i][0];
      next[i * 4 + 3] = pts[i][1];

      if (linked()) {
        next[i * 4] = pts[i][0];
        next[i * 4 + 1] = pts[i][1];
      }
    }

    return next;
  }

  function commitVectors(next: number[]) {
    const current = state();
    setState("refraction", {
      ...current.refraction,
      bypass: false,
      mapVectors: next,
      separation: separation(),
    });
    setLiveVectors(null);
    queueMicrotask(() => untrack(() => props.clearPreviewPatch?.("refraction-commit")));
  }

  function toggleLink(on: boolean) {
    setLinked(on);

    if (on) {
      const next = nextShadow(shadowPts(vectors()));
      preview(next);
      commitVectors(next);
    }
  }

  const fmt = (pts: () => Pt[], sel: () => number) => {
    const p = pts()[sel()];

    return {
      h: `${Math.floor(p[0])}°`,
      s: `${Math.round(100 * p[1])}%`,
    };
  };

  const shReadout = () => fmt(() => shadowPts(vectors()), selShadow);
  const hlReadout = () => fmt(() => highlightPts(vectors()), selHighlight);

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        "align-items": "stretch",
        gap: "10px",
        padding: "8px 2px 10px",
        width: "100%",
        "min-width": "0",
        "box-sizing": "border-box",
      }}
    >
      {/* compact horizontal readout row */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": "minmax(0, 1fr) minmax(104px, 132px) minmax(0, 1fr)",
          "align-items": "center",
          "justify-items": "center",
          gap: "4px",
          width: "100%",
          "min-width": "0",
          padding: "0 2px",
          "box-sizing": "border-box",
          overflow: "visible",
        }}
      >
        <ReadoutPill
          icon="/assets/icons/shadows_icon.svg"
          alt="Shadows"
          h={shReadout().h}
          s={shReadout().s}
        />

        <SepPill
          linked={linked()}
          onToggle={toggleLink}
          sepValue={separation()}
          onSepInput={(v) => {
            setLiveSeparation(v);
            props.previewEditPatch?.(
              {
                refraction: {
                  ...state().refraction,
                  bypass: false,
                  mapVectors: vectors(),
                  separation: v,
                },
              },
              "refraction-separation-drag",
            );
          }}
          onSepChange={(v) => {
            const current = state();
            setState("refraction", {
              ...current.refraction,
              bypass: false,
              mapVectors: vectors(),
              separation: v,
            });
            setLiveSeparation(null);
            queueMicrotask(() => untrack(() => props.clearPreviewPatch?.("refraction-separation-commit")));
          }}
        />

        <ReadoutPill
          icon="/assets/icons/highlights_icon.svg"
          alt="Highlights"
          h={hlReadout().h}
          s={hlReadout().s}
        />
      </div>

      {/* hex wheels always horizontal */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": "minmax(0, 1fr) minmax(0, 1fr)",
          gap: "10px",
          "align-items": "start",
          "justify-items": "center",
          width: "100%",
          "min-width": "0",
          overflow: "visible",
        }}
      >
        <div
          style={{
            "min-width": "0",
            transform: "scale(0.92)",
            "transform-origin": "top center",
          }}
        >
          <HexagonalSlider
            points={shadowPts(vectors())}
            defaultPoints={DEFAULT_POINTS}
            colors={PRIMARY_COLORS}
            background="conic-gradient(#980202, #c38a03, #009412, #0080b4, #3d07ad, #a40084, #980202)"
            selected={selShadow()}
            onSelect={setSelShadow}
            onInput={(pts) => preview(nextShadow(pts))}
            onChange={(pts) => commitVectors(nextShadow(pts))}
          />
        </div>

        <div
          style={{
            "min-width": "0",
            transform: "scale(0.92)",
            "transform-origin": "top center",
          }}
        >
          <HexagonalSlider
            points={highlightPts(vectors())}
            defaultPoints={DEFAULT_POINTS}
            colors={PRIMARY_COLORS}
            background="conic-gradient(#f84e4e, #e0d462, #41b84d, #74bec4, #4b5ccc, #b03c96, #f84e4e)"
            selected={selHighlight()}
            onSelect={setSelHighlight}
            onInput={(pts) => preview(nextHighlight(pts))}
            onChange={(pts) => commitVectors(nextHighlight(pts))}
          />
        </div>
      </div>
    </div>
  );
}
