export function bootstrapApplication({
  init,
  onError = error => console.error(error),
}) {
  const disposeHandlers = [];
  let startPromise = null;
  let disposePromise = null;

  async function dispose() {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      for (const handler of disposeHandlers.reverse()) {
        try {
          await handler();
        } catch (error) {
          onError(error);
        }
      }
      document.documentElement.dataset.appState = 'disposed';
    })();
    return disposePromise;
  }

  function onDispose(handler) {
    if (typeof handler === 'function') disposeHandlers.push(handler);
  }

  function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      document.documentElement.dataset.appState = 'starting';
      await init();
      document.documentElement.dataset.appState = 'ready';
    })().catch(error => {
      document.documentElement.dataset.appState = 'failed';
      onError(error);
    });
    return startPromise;
  }

  window.addEventListener('pagehide', () => {
    void dispose();
  });

  return {
    start,
    dispose,
    onDispose,
  };
}
