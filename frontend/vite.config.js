import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const doPurifyEntry = fileURLToPath(
  new URL('./node_modules/dompurify/dist/purify.es.mjs', import.meta.url),
);

// Some TypeScript dependencies use NodeNext-style `.js` specifiers while
// shipping the matching sources as `.ts`. Resolve those imports in dev/HMR
// without changing the dependency or the Lattice kernel.
const typescriptSourceResolver = {
  name: 'typescript-source-resolver',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!importer || !source.endsWith('.js')) return null;
    const usesTypescriptSources = importer.includes('/lattice/')
      || importer.includes('/node_modules/dompurify/src/');
    if (!usesTypescriptSources) return null;
    const candidate = path.resolve(path.dirname(importer), source.replace(/\.js$/, '.ts'));
    return existsSync(candidate) ? candidate : null;
  },
};

export default defineConfig({
  plugins: [typescriptSourceResolver],
  server: {
    port: 5100,
    strictPort: true,
  },
  resolve: {
    alias: {
      dompurify: doPurifyEntry,
    },
  },
  optimizeDeps: {
    exclude: ['dompurify', 'lattice'],
  },
});
