import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVersions,
  parsePluginPackage,
} from '../../plugin-runtime/package.js';

test('plugin packages: compare semantic versions', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.0', '1.0.0'), -1);
});

test('plugin packages: parse a valid single-file package', () => {
  const pkg = parsePluginPackage(JSON.stringify({
    schemaVersion: 1,
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    inject: ['markdown'],
    entry: 'ctx => { ctx.provide("testService", { ok: true }); }',
  }));
  assert.equal(pkg.id, 'test-plugin');
  assert.deepEqual(pkg.inject, ['markdown']);
});

test('plugin packages: reject unsafe or incomplete packages', () => {
  assert.throws(() => parsePluginPackage('{"id":"../escape"}'), /id/);
  assert.throws(() => parsePluginPackage('{"id":"valid-id"}'), /version/);
  assert.throws(() => parsePluginPackage('{"id":"valid-id","version":"1.0.0"}'), /entry/);
});
