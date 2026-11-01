export type TimelineZoomTarget = { scale: number; offset: number };
export type TimelineZoomAnchor = { distance: number; scale: number; minute: number };

export function timelineZoomTarget(anchor: TimelineZoomAnchor, distance: number, center: number, height: number): TimelineZoomTarget {
  const scale = Math.max(0.5, Math.min(3, anchor.scale * distance / Math.max(1, anchor.distance)));
  const maxOffset = Math.max(0, 1440 * scale - height);
  return { scale, offset: Math.max(0, Math.min(maxOffset, anchor.minute * scale - center)) };
}

/** Coalesce touch events, retaining the last sample when a gesture ends. */
export function createFrameQueue<T>(commit: (value: T) => void, request: (callback: () => void) => number, cancel: (id: number) => void) {
  let frame: number | null = null;
  let pending: { value: T } | null = null;
  const flush = () => {
    if (frame !== null) cancel(frame);
    frame = null;
    const next = pending;
    pending = null;
    if (next) commit(next.value);
  };
  return {
    push(value: T) {
      pending = { value };
      if (frame === null) frame = request(flush);
    },
    flush,
    cancel() {
      if (frame !== null) cancel(frame);
      frame = null;
      pending = null;
    },
  };
}
