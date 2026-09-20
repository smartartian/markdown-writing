const DEFAULT_DURATION = 400;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function createClone(source, rect, role) {
  if (!source || !rect || rect.width <= 0 || rect.height <= 0) return null;
  const clone = source.cloneNode(true);
  clone.classList.add('view-morph-clone');
  clone.dataset.morphRole = role;
  clone.setAttribute('aria-hidden', 'true');
  clone.inert = true;
  Object.assign(clone.style, {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  return clone;
}

function removeClone(clone) {
  clone?.remove();
}

function restoreNode(styleTarget) {
  if (!styleTarget) return;
  styleTarget.style.removeProperty('opacity');
  styleTarget.style.removeProperty('transform');
  styleTarget.style.removeProperty('will-change');
}

export async function animateHomeToEditor({
  sourcePanel,
  fadingPanel,
  target = 'writing',
  exitDirection = 'right',
  render,
  duration = DEFAULT_DURATION,
}) {
  if (typeof render !== 'function') return;
  if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches || typeof Element.prototype.animate !== 'function') {
    await render();
    return;
  }

  const sourceRect = sourcePanel?.getBoundingClientRect();
  const fadingRect = fadingPanel?.getBoundingClientRect();
  const sourceClone = createClone(sourcePanel, sourceRect, 'source');
  const fadingClone = createClone(fadingPanel, fadingRect, 'exit');
  if (sourceClone) document.body.appendChild(sourceClone);
  if (fadingClone) document.body.appendChild(fadingClone);

  await render();
  await nextFrame();

  const targetPanel = document.querySelector(
    target === 'sidebar'
      ? '.editor-sidebar-panel'
      : '.editor-writing-area',
  );
  const targetRect = targetPanel?.getBoundingClientRect();
  const sidebarPanel = document.querySelector('.editor-sidebar-panel');

  if (!targetPanel || !targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
    removeClone(sourceClone);
    removeClone(fadingClone);
    return;
  }

  targetPanel.style.opacity = '0';
  targetPanel.style.willChange = 'opacity, transform';
  if (sidebarPanel && sidebarPanel !== targetPanel) {
    sidebarPanel.style.opacity = '0';
    sidebarPanel.style.willChange = 'opacity, transform';
  }

  const animations = [];
  if (sourceClone && sourceRect) {
    const scaleX = targetRect.width / sourceRect.width;
    const scaleY = targetRect.height / sourceRect.height;
    const deltaX = targetRect.left - sourceRect.left;
    const deltaY = targetRect.top - sourceRect.top;
    animations.push(sourceClone.animate([
      {
        transform: 'translate3d(0, 0, 0) scale(1)',
        opacity: 1,
      },
      {
        offset: 0.72,
        transform: `translate3d(${deltaX * 0.92}px, ${deltaY * 0.92}px, 0) scale(${1 + (scaleX - 1) * 0.9}, ${1 + (scaleY - 1) * 0.9})`,
        opacity: 0.72,
      },
      {
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
        opacity: 0,
      },
    ], {
      duration,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      fill: 'forwards',
    }).finished.catch(() => {}));
  }

  if (fadingClone && fadingRect) {
    const exitX = exitDirection === 'right'
      ? fadingRect.width + 28
      : -(fadingRect.width + 28);
    animations.push(fadingClone.animate([
      { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
      { transform: `translate3d(${exitX}px, 0, 0) scale(0.985)`, opacity: 0 },
    ], {
      duration: Math.round(duration * 0.82),
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'forwards',
    }).finished.catch(() => {}));
  }

  animations.push(targetPanel.animate([
    {
      opacity: 0,
      transform: target === 'sidebar'
        ? 'translate3d(-10px, 0, 0) scale(0.992)'
        : 'translate3d(0, 12px, 0) scale(0.992)',
    },
    {
      opacity: 1,
      transform: 'translate3d(0, 0, 0) scale(1)',
    },
  ], {
    duration: Math.round(duration * 0.88),
    delay: Math.round(duration * 0.18),
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    fill: 'both',
  }).finished.catch(() => {}));

  if (sidebarPanel && sidebarPanel !== targetPanel) {
    animations.push(sidebarPanel.animate([
      {
        opacity: 0,
        transform: 'translate3d(-18px, 0, 0) scale(0.992)',
      },
      {
        opacity: 1,
        transform: 'translate3d(0, 0, 0) scale(1)',
      },
    ], {
      duration: Math.round(duration * 0.9),
      delay: Math.round(duration * 0.1),
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      fill: 'both',
    }).finished.catch(() => {}));
  }

  try {
    await Promise.all(animations);
  } finally {
    removeClone(sourceClone);
    removeClone(fadingClone);
    restoreNode(targetPanel);
    restoreNode(sidebarPanel);
  }
}
