import test from 'node:test';
import assert from 'node:assert/strict';

import { animateHomeToEditor } from '../view-transition.js';

test('view transition falls back to rendering when animations are unavailable', async () => {
  const originalWindow = globalThis.window;
  const originalElement = globalThis.Element;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.Element = function Element() {};
  let rendered = false;

  try {
    await animateHomeToEditor({
      render() {
        rendered = true;
      },
    });
    assert.equal(rendered, true);
  } finally {
    globalThis.window = originalWindow;
    globalThis.Element = originalElement;
  }
});
