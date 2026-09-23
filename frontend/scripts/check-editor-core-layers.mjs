import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = resolve(frontendRoot, 'src/editor-core');
const baselinePath = resolve(frontendRoot, 'scripts/editor-core-layer-baseline.json');
const baseline = new Set(JSON.parse(readFileSync(baselinePath, 'utf8')));

const L0_DIRS = new Set(['model', 'transaction', 'parser', 'serializer', 'session', 'commands']);
const FORBIDDEN_IMPORTS = /^(marked|turndown|dompurify|lattice)(\/|$)/;
// App-layer paths (rule 1). Matches bare or Vite root-absolute specifiers such as
// 'ui/editor.js' or '/src/modules/settings.js' that would escape the kernel.
const APP_LAYER_SEGMENTS =
  'app|core|dev-tools|editor|i18n|markdown|modules|plugin-runtime|services|themes|ui';
const APP_IMPORT = new RegExp(
  `^(?:/src/)?(?:${APP_LAYER_SEGMENTS})/|(?:^|/)(?:main|editor)\\.js$`,
);
const HOST_TOKENS = [
  ['document.(addEventListener|createElement|querySelector|querySelectorAll|createRange|getSelection|documentElement|body|activeElement)', 'document'],
  ['window.', 'window'],
  ['localStorage', 'localStorage'],
  ['new Worker', 'Worker'],
];

// Scans every .js file under editor-core, including tests/: a kernel test that
// imports the app layer is the same layering break as production code doing it.
// Integration tests that need app modules belong in src/ui/tests/.
function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && path.endsWith('.js')) files.push(path);
  }
  return files;
}

function importSpecifiers(source) {
  const specs = [];
  const patterns = [
    /^\s*import\s+(?:[^;]*?\s+from\s+)?[\x27\x22]([^\x27\x22]+)[\x27\x22]/gm,
    /^\s*export\s+[^;]*?\s+from\s+[\x27\x22]([^\x27\x22]+)[\x27\x22]/gm,
    /\bimport\(\s*[\x27\x22]([^\x27\x22]+)[\x27\x22]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
}

function isL0(file) {
  const rel = relative(coreRoot, file).replaceAll('\\', '/');
  return L0_DIRS.has(rel.split('/')[0]);
}

function addViolation(violations, file, rule, detail) {
  const rel = relative(frontendRoot, file).replaceAll('\\', '/');
  violations.push({ id: `${rel}:${rule}:${detail}`, file: rel, rule, detail });
}

const violations = [];
for (const file of walk(coreRoot)) {
  const source = readFileSync(file, 'utf8');
  for (const specifier of importSpecifiers(source)) {
    if (specifier.startsWith('node:')) continue;
    if (FORBIDDEN_IMPORTS.test(specifier)) {
      addViolation(violations, file, 'forbidden-package', specifier);
      continue;
    }
    if (!specifier.startsWith('.')) {
      if (APP_IMPORT.test(specifier)) {
        addViolation(violations, file, 'app-layer-import', specifier);
      }
      continue;
    }
    const target = resolve(dirname(file), specifier);
    const relTarget = relative(coreRoot, target).replaceAll('\\', '/');
    if (relTarget.startsWith('..') || resolve(coreRoot, relTarget) !== target) {
      addViolation(violations, file, 'outside-editor-core', specifier);
    }
  }

  if (isL0(file)) {
    for (const [token, label] of HOST_TOKENS) {
      if (new RegExp(token).test(source)) addViolation(violations, file, "host-api", label);
    }
  }
}

const current = new Set(violations.map(item => item.id));
const stale = [...baseline].filter(id => !current.has(id));
const fresh = violations.filter(item => !baseline.has(item.id));

if (fresh.length > 0) {
  console.error('editor-core layer violation');
  for (const item of fresh) console.error(`- ${item.file} [${item.rule}] ${item.detail}`);
  process.exitCode = 1;
}

if (stale.length > 0) {
  console.warn('editor-core layer baseline entries can be removed:');
  for (const id of stale) console.warn(`- ${id}`);
}

if (fresh.length === 0 && stale.length === 0) {
  console.log('editor-core layers: clean');
}
