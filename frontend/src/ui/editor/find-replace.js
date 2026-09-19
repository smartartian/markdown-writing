export function findTextMatches(text, query, { caseSensitive = false } = {}) {
  const source = String(text ?? '');
  const needle = String(query ?? '');
  if (!needle) return [];

  const haystack = caseSensitive ? source : source.toLocaleLowerCase();
  const normalizedNeedle = caseSensitive ? needle : needle.toLocaleLowerCase();
  const matches = [];
  let cursor = 0;

  while (cursor <= haystack.length - normalizedNeedle.length) {
    const start = haystack.indexOf(normalizedNeedle, cursor);
    if (start === -1) break;
    matches.push({
      start,
      end: start + normalizedNeedle.length,
      text: source.slice(start, start + normalizedNeedle.length),
    });
    cursor = start + Math.max(normalizedNeedle.length, 1);
  }

  return matches;
}

export function replaceTextRange(text, match, replacement) {
  const source = String(text ?? '');
  if (!match) return source;
  return source.slice(0, match.start) + String(replacement ?? '') + source.slice(match.end);
}

export function replaceAllText(text, query, replacement, options = {}) {
  const source = String(text ?? '');
  const matches = findTextMatches(source, query, options);
  if (!matches.length) return { text: source, count: 0, matches };

  let next = source;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    next = replaceTextRange(next, matches[index], replacement);
  }
  return { text: next, count: matches.length, matches };
}
