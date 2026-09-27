import type { CurvePoint, ManualCurveMode } from "../../engine/state/EditState";
import { prepareCurveEvaluator } from "../../engine/curve/CurveEvaluator";
import { SplineCurve } from "./SplineCurve";
import {
  clonePoints,
  contrastTemplatesForCount,
  morphContrastPoints,
  type CurvePointModel,
} from "./curveEditorMath";

/**
 * Legacy contrast-panel: the lumaVsLuma tone curve plus a rolling-slider that
 * morphs the whole curve toward a contrast-increase (drag up) or contrast-decrease
 * (drag down) preset S-shape. Drag captures the current curve as the base, lerps it
 * toward the point-count-matched preset by |value−0.5|·2 live, and commits; the
 * slider eases back to center while the morphed curve stays. The spline editor
 * remains for direct point edits.
 */

const templateEvaluatorCache = new WeakMap<readonly CurvePointModel[], (x: number) => number>();

function sampleCubicTemplate(points: readonly CurvePointModel[], x: number) {
  let evaluate = templateEvaluatorCache.get(points);

  if (!evaluate) {
    evaluate = prepareCurveEvaluator("cubic", points as readonly CurvePoint[]);
    templateEvaluatorCache.set(points, evaluate);
  }

  return evaluate(x);
}

export function ContrastCurve(props: {
  points: CurvePoint[];
  defaultPoints?: CurvePoint[];
  mode: ManualCurveMode;
  colors?: string[];
  onInput?: (points: CurvePoint[]) => void;
  onChange: (points: CurvePoint[]) => void;
  onModeChange: (mode: ManualCurveMode) => void;
  onReset: () => void;
  resetActive?: boolean;
}) {
  let base: CurvePointModel[] = [];
  let latest: CurvePoint[] | null = null;
  let cachedTemplateCount = -1;
  let cachedTemplates: {
    low: CurvePointModel[];
    high: CurvePointModel[];
  } | null = null;

  const getTemplates = (count: number) => {
    if (!cachedTemplates || cachedTemplateCount !== count) {
      cachedTemplateCount = count;
      cachedTemplates = contrastTemplatesForCount(count, sampleCubicTemplate);
    }

    return cachedTemplates;
  };

  const onRollStart = () => {
    base = clonePoints(props.points);
    latest = null;
  };

  const onRoll = (value: number) => {
    if (base.length !== props.points.length) {
      base = clonePoints(props.points);
    }

    const { low, high } = getTemplates(base.length);
    const pts = morphContrastPoints(base, value, low, high) as CurvePoint[];

    latest = pts;

    return pts;
  };

  const onRollCommit = () => {
    if (latest) {
      props.onChange(latest);
    }

    latest = null;
  };

  return (
    <SplineCurve
      points={props.points}
      defaultPoints={props.defaultPoints}
      mode={props.mode}
      yMin={0}
      yMax={1}
      colors={props.colors}
      onRoll={onRoll}
      onRollStart={onRollStart}
      onRollCommit={onRollCommit}
      onInput={props.onInput}
      onChange={props.onChange}
      onModeChange={props.onModeChange}
      onReset={props.onReset}
      resetActive={props.resetActive}
    />
  );
}
