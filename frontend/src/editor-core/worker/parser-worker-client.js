export class ParserWorkerClient {
  constructor() {
    this.sequence = 0;
    this.pending = new Map();
    this.worker = typeof Worker !== 'undefined'
      ? new Worker(new URL('./parser-worker.js', import.meta.url), { type: 'module' })
      : null;
    if (this.worker) {
      this.worker.onmessage = event => {
        const { id } = event.data || {};
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.resolve(event.data);
      };
      this.worker.onerror = event => {
        for (const pending of this.pending.values()) {
          pending.reject(new Error(event.message || 'parser worker failed'));
        }
        this.pending.clear();
      };
    }
  }

  compare(markdown) {
    if (!this.worker) return Promise.resolve(null);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, markdown });
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

export function createParserWorkerClient() {
  return new ParserWorkerClient();
}
