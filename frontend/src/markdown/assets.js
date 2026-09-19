export function isLocalMarkdownAssetSource(source) {
  const value = String(source || '').trim();
  if (!value) return false;
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

export function createMarkdownAssetResolver({
  getContext,
  resolveAsset,
  getRoot = () => document.body,
  Observer = globalThis.MutationObserver,
}) {
  const queuedImages = new WeakSet();
  let observer = null;

  async function resolveImage(img) {
    const context = getContext?.();
    const originalSource = img.getAttribute('src');
    if (!context || !isLocalMarkdownAssetSource(originalSource)) return;

    let source = originalSource.split(/[?#]/, 1)[0];
    try {
      source = decodeURIComponent(source);
    } catch (error) {
      // Keep malformed escapes unchanged and let the native resolver reject them.
    }

    try {
      const resolvedSource = await resolveAsset({ ...context, source });
      if (!img.isConnected || img.getAttribute('src') !== originalSource) return;
      img.src = resolvedSource;
      img.dataset.localAssetState = 'loaded';
    } catch (error) {
      img.dataset.localAssetState = 'error';
      img.dataset.localAssetSource = source;
    }
  }

  function process(rootNode) {
    if (!rootNode) return;
    const images = [];
    if (rootNode.nodeType === 1 && rootNode.matches?.('img')) images.push(rootNode);
    if (rootNode.querySelectorAll) images.push(...rootNode.querySelectorAll('img'));

    for (const img of images) {
      if (queuedImages.has(img)) continue;
      const source = img.getAttribute('src');
      if (!isLocalMarkdownAssetSource(source)) {
        img.dataset.localAssetState = 'external';
        continue;
      }
      queuedImages.add(img);
      void resolveImage(img);
    }
  }

  function start() {
    if (observer || typeof Observer !== 'function') return;
    observer = new Observer(records => {
      for (const record of records) {
        for (const node of record.addedNodes) process(node);
      }
    });
    const root = getRoot() || document.body;
    observer.observe(root, { childList: true, subtree: true });
    process(root);
  }

  function stop() {
    observer?.disconnect();
    observer = null;
  }

  return {
    process,
    start,
    stop,
  };
}
