const logoBlackUrl = new URL('../assets/logos/logo-black.png', import.meta.url).href;
const logoBlueOnWhiteUrl = new URL('../assets/logos/logo-blue-on-white.png', import.meta.url).href;
const logoBlueUrl = new URL('../assets/logos/logo-blue.png', import.meta.url).href;
const logoGrayUrl = new URL('../assets/logos/logo-gray.png', import.meta.url).href;
const logoPurpleUrl = new URL('../assets/logos/logo-purple.png', import.meta.url).href;
const logoTealUrl = new URL('../assets/logos/logo-teal.png', import.meta.url).href;

export const DEFAULT_LOGO_ID = 'blue-on-white';

// 打包图标（build/appicon.png）：2048 画布上图形占 1156px，即 56.45%，icns 里的
// 1024 / 512 是同一比例。动态应用图标要让图形占画布同样的比例，程序坞里选中的 logo
// 才会和打包图标一样大。
export const PACKAGED_ICON_ARTWORK_RATIO = 1156 / 2048;

// 六个 logo 资源都是 512 画布：底色方块铺满整块画布（圆角半径实测 ≈114.8px），图形
// （圆环）占画布 321px ≈ 62.7%。动态应用图标保留满幅的底色方块，只把图形缩到打包比例
// （≈0.9），这样底色方块和图形都和打包图标一样大。
export const LOGO_TILE_CORNER_RATIO = 114.8 / 512;
export const LOGO_ARTWORK_RATIO = 321 / 512;

// 程序坞里可见图标（底色方块）占画布的比例：macOS 26 起会把打包图标缩进磁贴的约 80%
// （824/1024）再套上新图标样式，而运行时用 setApplicationIcon 设置的图标不会缩进、直接铺满
// 磁贴。所以这些系统上要自己先按同一比例缩进去，程序坞里才和打包图标一样大（否则大 ≈1.24
// 倍，实测 78px vs 63px）。旧系统打包图标本来就是满磁贴的，缩进去反而会变小，因此实际比例
// 由运行环境给出（macOS 见 application_icon.go，取不到时用这里的兜底值）。
export const APPLICATION_ICON_CONTENT_RATIO = 824 / 1024;

// 运行环境给出的比例可能缺失或非法（浏览器预览、旧系统返回 1）。
export function normalizeApplicationIconContentRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    return APPLICATION_ICON_CONTENT_RATIO;
  }
  return ratio;
}

// 图形缩放系数：图形先缩到打包比例，再随底色方块一起缩进（新系统 ≈0.72，旧系统 ≈0.9）。
export function getApplicationIconScale(contentRatio = APPLICATION_ICON_CONTENT_RATIO) {
  return (PACKAGED_ICON_ARTWORK_RATIO / LOGO_ARTWORK_RATIO)
    * normalizeApplicationIconContentRatio(contentRatio);
}

export function getApplicationIconDrawRect(canvasWidth, canvasHeight, imageWidth, imageHeight, scale = 1) {
  const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const width = imageWidth * ratio;
  const height = imageHeight * ratio;
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

export const LOGO_OPTIONS = [
  { id: 'blue-on-white', labelKey: 'settings.brand.logoBlueOnWhite', src: logoBlueOnWhiteUrl },
  { id: 'blue', labelKey: 'settings.brand.logoBlue', src: logoBlueUrl },
  { id: 'teal', labelKey: 'settings.brand.logoTeal', src: logoTealUrl },
  { id: 'purple', labelKey: 'settings.brand.logoPurple', src: logoPurpleUrl },
  { id: 'black', labelKey: 'settings.brand.logoBlack', src: logoBlackUrl },
  { id: 'gray', labelKey: 'settings.brand.logoGray', src: logoGrayUrl },
];

export function getLogoOption(id) {
  return LOGO_OPTIONS.find(option => option.id === id)
    || LOGO_OPTIONS.find(option => option.id === DEFAULT_LOGO_ID)
    || LOGO_OPTIONS[0];
}

export function getLogoUrl(id) {
  return getLogoOption(id).src;
}

export function brandHeroHtml(logoId = DEFAULT_LOGO_ID) {
  const logo = getLogoOption(logoId);
  return `
    <div class="brand-hero">
      <img class="brand-hero-mark" src="${logo.src}" alt="">
      <h1>Markdown Writing</h1>
    </div>
  `;
}
