export const shouldStartTaskSwipe = (dx: number, dy: number) =>
  Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy);

export function resolveSwipeProgress(amount: number, wasOpen: boolean, width: number) {
  const opening = Math.max(0, amount);
  return {
    isOpen: wasOpen ? opening > 76 : opening >= 100,
    position: opening <= width ? opening : width + (opening - width) * 0.2,
  };
}
