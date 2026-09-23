import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_ICON_CONTENT_RATIO,
  DEFAULT_LOGO_ID,
  getApplicationIconDrawRect,
  getApplicationIconScale,
  getLogoOption,
  LOGO_ARTWORK_RATIO,
  LOGO_OPTIONS,
  LOGO_TILE_CORNER_RATIO,
  normalizeApplicationIconContentRatio,
  PACKAGED_ICON_ARTWORK_RATIO,
} from '../brand.js';

test('brand: dynamic application icon matches packaged icon geometry', () => {
  // 打包图标：2048 画布上图形 1156px → 56.45%。
  assert.ok(Math.abs(PACKAGED_ICON_ARTWORK_RATIO - 0.564453125) < 1e-9);

  // logo 资源：底色方块满幅、圆角 ≈114.8/512，图形 321/512。
  assert.ok(Math.abs(LOGO_TILE_CORNER_RATIO - 0.22421875) < 1e-9);
  assert.ok(Math.abs(LOGO_ARTWORK_RATIO - 0.626953125) < 1e-9);

  // 程序坞只对打包图标做 824/1024 缩进，运行时图标铺满磁贴，所以运行时图标要自己先缩进去，
  // 否则程序坞里会比旁边应用大 ≈1.24 倍（实测 78px vs 63px）。
  assert.equal(APPLICATION_ICON_CONTENT_RATIO, 824 / 1024);

  // 图形缩放系数：先缩到打包比例（≈0.9），再随底色方块一起缩进 → ≈0.7245。
  const scale = getApplicationIconScale();
  assert.ok(Math.abs(scale - (1156 / 1284) * (824 / 1024)) < 1e-12);
  assert.ok(Math.abs(scale - 0.7244694314641744) < 1e-12);

  // 512 画布上：底色方块缩进到 412px、圆角 ≈92.378；图形缩到 ≈232.555px。
  const tileSide = 512 * APPLICATION_ICON_CONTENT_RATIO;
  assert.ok(Math.abs(tileSide - 412) < 1e-9);
  assert.ok(Math.abs(tileSide * LOGO_TILE_CORNER_RATIO - 92.378125) < 1e-9);
  assert.ok(Math.abs(LOGO_ARTWORK_RATIO * scale * 512 - 232.5546875) < 1e-9);

  // 关键不变量：图形 / 底色方块 = 打包图标的 56.45%。
  assert.ok(Math.abs(LOGO_ARTWORK_RATIO * scale / APPLICATION_ICON_CONTENT_RATIO - PACKAGED_ICON_ARTWORK_RATIO) < 1e-12);

  // 图形居中绘制。
  const rect = getApplicationIconDrawRect(512, 512, 512, 512, scale);
  assert.ok(Math.abs(rect.width - 370.928348909657) < 1e-9);
  assert.ok(Math.abs(rect.height - 370.928348909657) < 1e-9);
  assert.ok(Math.abs(rect.x - 70.535825545171) < 1e-9);
  assert.ok(Math.abs(rect.y - 70.535825545171) < 1e-9);
  assert.ok(Math.abs(rect.x - (512 - rect.width) / 2) < 1e-9);
  assert.ok(Math.abs(rect.y - (512 - rect.height) / 2) < 1e-9);
});

test('brand: draw rect falls back to the unscaled image for invalid scales', () => {
  const rect = getApplicationIconDrawRect(512, 512, 512, 512);

  assert.equal(rect.width, 512);
  assert.equal(rect.height, 512);
  assert.equal(rect.x, 0);
  assert.equal(rect.y, 0);
});

test('brand: logo options resolve to the default icon safely', () => {
  const ids = LOGO_OPTIONS.map(option => option.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(getLogoOption(DEFAULT_LOGO_ID).id, DEFAULT_LOGO_ID);
  assert.equal(getLogoOption('missing').id, DEFAULT_LOGO_ID);
});

test('brand: legacy systems keep the full-bleed icon (no Dock inset)', () => {
  // macOS 26 之前打包图标就是满磁贴的，运行时图标也不能缩进，否则会比打包图标小 20%。
  const scale = getApplicationIconScale(1);
  assert.ok(Math.abs(scale - 0.9003115264797508) < 1e-12);
  assert.ok(Math.abs(LOGO_ARTWORK_RATIO * scale - PACKAGED_ICON_ARTWORK_RATIO) < 1e-12);

  const rect = getApplicationIconDrawRect(512, 512, 512, 512, scale);
  assert.ok(Math.abs(rect.width - 460.9595015576324) < 1e-9);
});

test('brand: icon content ratio rejects missing or invalid runtime values', () => {
  assert.equal(normalizeApplicationIconContentRatio(0.8046875), 0.8046875);
  assert.equal(normalizeApplicationIconContentRatio(1), 1);

  [undefined, null, NaN, 0, -0.5, 1.2, 'nope'].forEach(value => {
    assert.equal(normalizeApplicationIconContentRatio(value), APPLICATION_ICON_CONTENT_RATIO);
  });
});
