import { browserAdapter } from './browser-adapter';
import { wailsAdapter } from './wails-adapter';

export function isBrowserMode() {
  return typeof window.go === 'undefined' || !window.go.main;
}

export const storage = isBrowserMode() ? browserAdapter : wailsAdapter;
