export type TouchPoint = { x: number; y: number };
export type InputBounds = TouchPoint & { width: number; height: number };

export function shouldDismissKeyboard(start: TouchPoint, end: TouchPoint, bounds: InputBounds | null, focusChanged: boolean): boolean {
  if (!bounds || focusChanged || Math.hypot(end.x - start.x, end.y - start.y) > 8) return false;
  return !(start.x >= bounds.x && start.x <= bounds.x + bounds.width && start.y >= bounds.y && start.y <= bounds.y + bounds.height);
}
