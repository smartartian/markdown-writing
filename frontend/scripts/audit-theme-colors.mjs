import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stylePath = fileURLToPath(new URL('../src/style.css', import.meta.url));
const source = readFileSync(stylePath, 'utf8');
const matches = source.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [];
const legacyThemeBlocks = source.match(/html\[data-theme=/g) || [];
const maxAllowed = 520;

console.log(`theme color literals: ${matches.length}`);
console.log(`legacy theme blocks: ${legacyThemeBlocks.length}`);

if (legacyThemeBlocks.length > 0) {
  console.error('legacy html[data-theme] blocks must not be added; use theme tokens instead');
  process.exitCode = 1;
}

if (matches.length > maxAllowed) {
  console.error(`theme color literal budget exceeded: ${matches.length} > ${maxAllowed}`);
  process.exitCode = 1;
}
