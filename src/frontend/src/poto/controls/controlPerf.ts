import { beginPerfDrag, endPerfDrag, recordPerfPointerEvent } from "../../app/performanceCounters";

export function createControlPerf(source: string) {
  let active = false;

  return {
    begin() {
      active = true;
      beginPerfDrag(source);
      recordPerfPointerEvent();
    },
    pointer() {
      if (active) recordPerfPointerEvent();
    },
    end() {
      if (!active) return;
      active = false;
      endPerfDrag();
    },
  };
}
