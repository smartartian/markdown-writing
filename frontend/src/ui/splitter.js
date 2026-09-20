/**
 * 面板分隔条拖动。
 *
 * axis = 'x'：左右并排的两个面板之间，拖动改变宽度
 * axis = 'y'：上下堆叠的两个面板之间，拖动改变高度
 *
 * side 表示被拖动的面板位于分隔条的哪一侧，决定拖动方向与尺寸增减的关系。
 */

export function createSplitter({
  handle,
  axis = 'x',
  side = 'right',
  min = 0,
  max = Infinity,
  collapseAt = 0,
  getSize,
  setSize,
  onCollapse,
  onCommit,
  isBlocked = () => false,
}) {
  if (!handle) return null;

  const cursor = axis === 'x' ? 'col-resize' : 'row-resize';
  const growsOnNegativeDelta = side === 'right' || side === 'bottom';

  let dragging = false;
  let startPointer = 0;
  let startSize = 0;

  function release() {
    dragging = false;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  function onMove(event) {
    if (!dragging) return;
    const delta = (axis === 'x' ? event.clientX : event.clientY) - startPointer;
    let next = growsOnNegativeDelta ? startSize - delta : startSize + delta;

    if (collapseAt && next < collapseAt) {
      release();
      onCollapse?.();
      onCommit?.();
      return;
    }

    if (next < min) next = min;
    if (next > max) next = max;
    setSize(next);
  }

  function onMouseUp() {
    if (!dragging) return;
    release();
    onCommit?.();
  }

  handle.addEventListener('mousedown', event => {
    if (event.button !== 0 || isBlocked()) return;
    dragging = true;
    startPointer = axis === 'x' ? event.clientX : event.clientY;
    startSize = getSize();
    document.body.style.cursor = cursor;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onMouseUp);
    event.preventDefault();
  });

  return {
    destroy() {
      if (dragging) release();
    },
  };
}
