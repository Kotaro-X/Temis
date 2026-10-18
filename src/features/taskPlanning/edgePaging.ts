export type EdgeHold = { direction: number; since: number; fired: boolean };
export const emptyEdgeHold = (): EdgeHold => ({ direction: 0, since: 0, fired: false });
// Leaving the edge rearms paging; scrolling within the week must finish first.
export function edgePaging(state: EdgeHold, direction: number, atBoundary: boolean, now: number): { state: EdgeHold; page: number } {
  if (!direction) return { state: emptyEdgeHold(), page: 0 };
  if (state.fired) return { state, page: 0 };
  if (!atBoundary) return { state: { direction, since: now, fired: false }, page: 0 };
  if (state.direction !== direction) return { state: { direction, since: now, fired: false }, page: 0 };
  if (now - state.since < 600) return { state, page: 0 };
  return { state: { ...state, fired: true }, page: direction };
}
