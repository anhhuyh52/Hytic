type PerfDrag = {
  id: number;
  source: string;
  startedAt: number;
  pointerEvents: number;
  stateCommits: number;
  warned?: Set<string>;
};

/**
 * Resource operations that must NEVER run while a control drag is active — the
 * acceptance-test "Not allowed during drag" list, minus the release-time commit
 * counters (committed-state/autosave/history fire legitimately on pointerup, whose
 * ordering vs endPerfDrag is control-specific, so warning on them would false-positive).
 * Each fires a single throttled console.warn per drag so a regression is loud but not spammy.
 */
function warnForbiddenDuringDrag(label: string): void {
  if (!import.meta.env.DEV) return;
  const drag = perf.currentDrag;
  if (!drag) return;
  (drag.warned ??= new Set<string>());
  if (drag.warned.has(label)) return;
  drag.warned.add(label);
  console.warn(
    `[poto-perf] forbidden hot-path work during "${drag.source}" drag: ${label}. ` +
      `This should only happen on import/commit, never per pointermove.`,
  );
}

export type PotoPerfSnapshot = {
  rendersPerSecond: number;
  stateCommitsPerDrag: number;
  pointerEventsPerDrag: number;
  uniformUpdatesPerFrame: number;
  activePanelSubscriptions: number;
  pendingRenderRequests: number;
  totalStateCommits: number;
  totalRenderFrames: number;
  totalUniformUpdates: number;
  currentDrag: PerfDrag | null;
  rawDecodeCount: number;
  sourceTextureUploadCount: number;
  previewRenderCount: number;
  committedStateSetCount: number;
  transmittedStateSetCount: number;
  autosaveCount: number;
  historyPushCount: number;
  histogramComputeCount: number;
  histogramReadbackCount: number;
  fullResReadbackCount: number;
  createImageBitmapCount: number;
  dataTextureUploadCount: number;
  fullImageDataWriteCount: number;
  mediaSwitchCount: number;
  activeImageLoadMs: number;
  thumbnailObjectUrlCount: number;
  revokedThumbnailUrlCount: number;
  rawDecodeDuringSwitchCount: number;
  heavyDecodeDuringSwitchCount: number;
  createImageBitmapDuringSwitchCount: number;
  staleBitmapClosedCount: number;
  activeStateJsonLoadCount: number;
  contextMenuOpenCount: number;
  contextMenuFullImageLoadCount: number;
  contextMenuDecodeCount: number;
  metadataJsonReadCount: number;
  copiedEditStateCount: number;
  pastedEditStateCount: number;
  flattenedImageCount: number;
  matchReferenceFromMediaCount: number;
};

const perf = {
  totalStateCommits: 0,
  totalRenderFrames: 0,
  totalUniformUpdates: 0,
  pendingRenderRequests: 0,
  rendersThisSecond: 0,
  rendersPerSecond: 0,
  uniformUpdatesThisFrame: 0,
  lastUniformUpdatesPerFrame: 0,
  completedDragCommits: 0,
  completedDragPointers: 0,
  completedDrags: 0,
  activePanelSubscriptions: 0,
  currentDrag: null as PerfDrag | null,
  nextDragId: 1,
  rawDecodeCount: 0,
  sourceTextureUploadCount: 0,
  previewRenderCount: 0,
  committedStateSetCount: 0,
  transmittedStateSetCount: 0,
  autosaveCount: 0,
  historyPushCount: 0,
  histogramComputeCount: 0,
  histogramReadbackCount: 0,
  fullResReadbackCount: 0,
  createImageBitmapCount: 0,
  dataTextureUploadCount: 0,
  fullImageDataWriteCount: 0,
  mediaSwitchCount: 0,
  activeImageLoadMs: 0,
  thumbnailObjectUrlCount: 0,
  revokedThumbnailUrlCount: 0,
  rawDecodeDuringSwitchCount: 0,
  heavyDecodeDuringSwitchCount: 0,
  createImageBitmapDuringSwitchCount: 0,
  staleBitmapClosedCount: 0,
  activeStateJsonLoadCount: 0,
  contextMenuOpenCount: 0,
  contextMenuFullImageLoadCount: 0,
  contextMenuDecodeCount: 0,
  metadataJsonReadCount: 0,
  copiedEditStateCount: 0,
  pastedEditStateCount: 0,
  flattenedImageCount: 0,
  matchReferenceFromMediaCount: 0,
};

if (import.meta.env.DEV) {
  const intervalId = setInterval(() => {
    perf.rendersPerSecond = perf.rendersThisSecond;
    perf.rendersThisSecond = 0;
  }, 1000);
  (intervalId as unknown as { unref?: () => void }).unref?.();
}

export function recordStateCommit() {
  if (!import.meta.env.DEV) return;
  perf.totalStateCommits += 1;
  perf.committedStateSetCount += 1;
  if (perf.currentDrag) perf.currentDrag.stateCommits += 1;
}

export function recordRenderRequest() {
  if (!import.meta.env.DEV) return;
  perf.pendingRenderRequests += 1;
}

export function recordRenderFrame() {
  if (!import.meta.env.DEV) return;
  perf.totalRenderFrames += 1;
  perf.previewRenderCount += 1;
  perf.rendersThisSecond += 1;
  perf.lastUniformUpdatesPerFrame = perf.uniformUpdatesThisFrame;
  perf.uniformUpdatesThisFrame = 0;
  perf.pendingRenderRequests = 0;
}

export function recordUniformUpdate(count = 1) {
  if (!import.meta.env.DEV) return;
  perf.totalUniformUpdates += count;
  perf.uniformUpdatesThisFrame += count;
}

export function beginPerfDrag(source: string) {
  if (!import.meta.env.DEV) return;
  perf.currentDrag = {
    id: perf.nextDragId,
    source,
    startedAt: performance.now(),
    pointerEvents: 0,
    stateCommits: 0,
  };
  perf.nextDragId += 1;
}

export function recordPerfPointerEvent() {
  if (!import.meta.env.DEV) return;
  if (perf.currentDrag) perf.currentDrag.pointerEvents += 1;
}

export function endPerfDrag() {
  if (!import.meta.env.DEV) return;
  const drag = perf.currentDrag;
  if (!drag) return;
  perf.completedDrags += 1;
  perf.completedDragCommits += drag.stateCommits;
  perf.completedDragPointers += drag.pointerEvents;
  perf.currentDrag = null;
}

export function registerPanelSubscription() {
  if (!import.meta.env.DEV) return () => {};
  perf.activePanelSubscriptions += 1;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    perf.activePanelSubscriptions = Math.max(0, perf.activePanelSubscriptions - 1);
  };
}

export function recordRawDecode() { if (import.meta.env.DEV) { perf.rawDecodeCount++; warnForbiddenDuringDrag("rawDecode"); } }
export function recordSourceTextureUpload() { if (import.meta.env.DEV) { perf.sourceTextureUploadCount++; warnForbiddenDuringDrag("sourceTextureUpload"); } }
export function recordAutosave() { if (import.meta.env.DEV) perf.autosaveCount++; }
export function recordHistogramCompute() { if (import.meta.env.DEV) perf.histogramComputeCount++; }
export function recordCreateImageBitmap() { if (import.meta.env.DEV) { perf.createImageBitmapCount++; warnForbiddenDuringDrag("createImageBitmap"); } }
export function recordFullImageDataWrite() { if (import.meta.env.DEV) { perf.fullImageDataWriteCount++; warnForbiddenDuringDrag("fullImageDataWrite"); } }
// Transmitted (live preview) state writes — allowed to climb during a drag.
export function recordTransmittedStateSet() { if (import.meta.env.DEV) perf.transmittedStateSetCount++; }
// Committed undo-history pushes — must NOT climb during a drag (only on release).
export function recordHistoryPush() { if (import.meta.env.DEV) perf.historyPushCount++; }
// Small LUT/curve DataTexture re-uploads — allowed (tiny, in place) during a drag.
export function recordDataTextureUpload() { if (import.meta.env.DEV) perf.dataTextureUploadCount++; }
// Throttled, capped (<=256px) scope/histogram readbacks.
export function recordHistogramReadback() { if (import.meta.env.DEV) perf.histogramReadbackCount++; }
// Full-resolution GPU->CPU readbacks — must stay 0 during a drag (export only).
export function recordFullResReadback() { if (import.meta.env.DEV) { perf.fullResReadbackCount++; warnForbiddenDuringDrag("fullResReadback"); } }

export function getPotoPerfSnapshot(): PotoPerfSnapshot {
  const dragCount = Math.max(1, perf.completedDrags);
  return {
    rendersPerSecond: perf.rendersPerSecond,
    stateCommitsPerDrag: perf.completedDragCommits / dragCount,
    pointerEventsPerDrag: perf.completedDragPointers / dragCount,
    uniformUpdatesPerFrame: perf.lastUniformUpdatesPerFrame,
    activePanelSubscriptions: perf.activePanelSubscriptions,
    pendingRenderRequests: perf.pendingRenderRequests,
    totalStateCommits: perf.totalStateCommits,
    totalRenderFrames: perf.totalRenderFrames,
    totalUniformUpdates: perf.totalUniformUpdates,
    currentDrag: perf.currentDrag ? { ...perf.currentDrag } : null,
    rawDecodeCount: perf.rawDecodeCount,
    sourceTextureUploadCount: perf.sourceTextureUploadCount,
    previewRenderCount: perf.previewRenderCount,
    committedStateSetCount: perf.committedStateSetCount,
    transmittedStateSetCount: perf.transmittedStateSetCount,
    autosaveCount: perf.autosaveCount,
    historyPushCount: perf.historyPushCount,
    histogramComputeCount: perf.histogramComputeCount,
    histogramReadbackCount: perf.histogramReadbackCount,
    fullResReadbackCount: perf.fullResReadbackCount,
    createImageBitmapCount: perf.createImageBitmapCount,
    dataTextureUploadCount: perf.dataTextureUploadCount,
    fullImageDataWriteCount: perf.fullImageDataWriteCount,
    mediaSwitchCount: perf.mediaSwitchCount,
    activeImageLoadMs: perf.activeImageLoadMs,
    thumbnailObjectUrlCount: perf.thumbnailObjectUrlCount,
    revokedThumbnailUrlCount: perf.revokedThumbnailUrlCount,
    rawDecodeDuringSwitchCount: perf.rawDecodeDuringSwitchCount,
    heavyDecodeDuringSwitchCount: perf.heavyDecodeDuringSwitchCount,
    createImageBitmapDuringSwitchCount: perf.createImageBitmapDuringSwitchCount,
    staleBitmapClosedCount: perf.staleBitmapClosedCount,
    activeStateJsonLoadCount: perf.activeStateJsonLoadCount,
    contextMenuOpenCount: perf.contextMenuOpenCount,
    contextMenuFullImageLoadCount: perf.contextMenuFullImageLoadCount,
    contextMenuDecodeCount: perf.contextMenuDecodeCount,
    metadataJsonReadCount: perf.metadataJsonReadCount,
    copiedEditStateCount: perf.copiedEditStateCount,
    pastedEditStateCount: perf.pastedEditStateCount,
    flattenedImageCount: perf.flattenedImageCount,
    matchReferenceFromMediaCount: perf.matchReferenceFromMediaCount,
  };
}

export function recordMediaSwitch(ms: number) { if (import.meta.env.DEV) { perf.mediaSwitchCount++; perf.activeImageLoadMs += ms; } }
export function recordThumbnailObjectUrlCreated() { if (import.meta.env.DEV) perf.thumbnailObjectUrlCount++; }
export function recordThumbnailObjectUrlRevoked() { if (import.meta.env.DEV) perf.revokedThumbnailUrlCount++; }
export function recordRawDecodeDuringSwitch() { if (import.meta.env.DEV) perf.rawDecodeDuringSwitchCount++; }
export function recordHeavyDecodeDuringSwitch() { if (import.meta.env.DEV) perf.heavyDecodeDuringSwitchCount++; }
export function recordCreateImageBitmapDuringSwitch() { if (import.meta.env.DEV) perf.createImageBitmapDuringSwitchCount++; }
export function recordStaleBitmapClosed() { if (import.meta.env.DEV) perf.staleBitmapClosedCount++; }
export function recordActiveStateJsonLoad() { if (import.meta.env.DEV) perf.activeStateJsonLoadCount++; }
export function recordContextMenuOpen() { if (import.meta.env.DEV) perf.contextMenuOpenCount++; }
export function recordContextMenuFullImageLoad() { if (import.meta.env.DEV) perf.contextMenuFullImageLoadCount++; }
export function recordContextMenuDecode() { if (import.meta.env.DEV) perf.contextMenuDecodeCount++; }
export function recordMetadataJsonRead() { if (import.meta.env.DEV) perf.metadataJsonReadCount++; }
export function recordCopiedEditState() { if (import.meta.env.DEV) perf.copiedEditStateCount++; }
export function recordPastedEditState(count = 1) { if (import.meta.env.DEV) perf.pastedEditStateCount += count; }
export function recordFlattenedImage() { if (import.meta.env.DEV) perf.flattenedImageCount++; }
export function recordMatchReferenceFromMedia() { if (import.meta.env.DEV) perf.matchReferenceFromMediaCount++; }

if (import.meta.env.DEV && typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__potoPerf = getPotoPerfSnapshot;
}
