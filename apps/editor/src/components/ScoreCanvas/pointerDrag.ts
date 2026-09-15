export type PointerDragFinish = (cancelled: boolean, event: PointerEvent) => void;

/** Listen for one captured pointer drag and always remove every terminal listener. */
export function listenForPointerDrag(
  pointerId: number,
  onMove: (event: PointerEvent) => void,
  onFinish: PointerDragFinish,
): void {
  const cleanup = (): void => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  };
  const onUp = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId || event.button !== 0) return;
    cleanup();
    onFinish(false, event);
  };
  const onCancel = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    cleanup();
    onFinish(true, event);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) onMove(event);
  };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
