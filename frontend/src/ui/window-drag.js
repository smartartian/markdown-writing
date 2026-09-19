const INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  '[contenteditable]',
  '.btn-icon',
  '.btn-primary',
  '.sidebar-resizer',
  '.modal-close',
].join(', ');

export function createWindowDragController({
  enabled = true,
  topArea = 44,
  getWindowPosition,
  setWindowPosition,
}) {
  let disposed = false;
  let windowPosition = null;
  let dragState = null;
  let dragFrame = null;
  let previousCursor = '';

  function stop() {
    dragState = null;
    if (dragFrame) {
      cancelAnimationFrame(dragFrame);
      dragFrame = null;
    }
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', stop);
  }

  function onMouseMove(event) {
    if (!dragState || dragFrame) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = null;
      if (!dragState) return;
      const nextX = dragState.windowX + event.screenX - dragState.screenX;
      const nextY = dragState.windowY + event.screenY - dragState.screenY;
      void setWindowPosition(nextX, nextY);
    });
  }

  function onMouseDown(event) {
    if (event.clientY > topArea || !windowPosition) return;
    if (event.target.closest(INTERACTIVE_SELECTOR)) return;

    dragState = {
      screenX: event.screenX,
      screenY: event.screenY,
      windowX: windowPosition.x,
      windowY: windowPosition.y,
    };
    previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stop);
  }

  async function start() {
    if (!enabled || disposed) return;
    try {
      windowPosition = await getWindowPosition();
    } catch {
      windowPosition = null;
    }
    if (disposed) return;
    document.addEventListener('mousedown', onMouseDown);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    document.removeEventListener('mousedown', onMouseDown);
  }

  return {
    start,
    dispose,
  };
}
