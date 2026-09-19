import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findTextMatches,
  replaceAllText,
  replaceTextRange,
} from '../editor/find-replace.js';

test('find replace: finds non-overlapping matches', () => {
  const matches = findTextMatches('Alpha alpha ALPHA', 'alpha');
  assert.deepEqual(matches.map(match => [match.start, match.end]), [[0, 5], [6, 11], [12, 17]]);
});

test('find replace: supports case-sensitive matching', () => {
  const matches = findTextMatches('Alpha alpha ALPHA', 'alpha', { caseSensitive: true });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].start, 6);
});

test('find replace: replaces one range without shifting earlier offsets', () => {
  const text = 'one two one';
  const matches = findTextMatches(text, 'one');
  assert.equal(replaceTextRange(text, matches[1], 'three'), 'one two three');
});

test('find replace: replaces all matches in reverse order', () => {
  const result = replaceAllText('one two one', 'one', '1');
  assert.equal(result.count, 2);
  assert.equal(result.text, '1 two 1');
});

test('find replace: empty query is a no-op', () => {
  assert.deepEqual(findTextMatches('abc', ''), []);
  assert.deepEqual(replaceAllText('abc', '', 'x'), { text: 'abc', count: 0, matches: [] });
});
