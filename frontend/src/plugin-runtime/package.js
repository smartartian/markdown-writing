const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const MAX_PLUGIN_SOURCE_LENGTH = 256 * 1024;

export function compareVersions(left, right) {
  const leftParts = String(left || '0').split('.').map(Number);
  const rightParts = String(right || '0').split('.').map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

export function parsePluginPackage(content) {
  const source = typeof content === 'string' ? content : JSON.stringify(content);
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('插件包必须是 JSON 对象');
  }
  const id = String(parsed.id || '').trim().toLowerCase();
  if (!PLUGIN_ID_PATTERN.test(id)) {
    throw new Error('插件 id 必须符合 [a-z0-9][a-z0-9_-]{1,63}');
  }
  const version = String(parsed.version || '').trim();
  if (!version) throw new Error('插件包缺少 version');
  const entry = String(parsed.entry || '').trim();
  if (!entry) throw new Error('插件包缺少 entry');
  if (entry.length > MAX_PLUGIN_SOURCE_LENGTH) throw new Error('插件源码超过 256KB 限制');
  const layer = parsed.layer === 'system' ? 'system' : 'business';
  const inject = Array.isArray(parsed.inject) ? parsed.inject.map(String) : [];
  return {
    schemaVersion: Number(parsed.schemaVersion || 1),
    id,
    name: String(parsed.name || id),
    version,
    description: String(parsed.description || ''),
    layer,
    inject,
    async: Boolean(parsed.async),
    entry,
    source,
  };
}

export {
  MAX_PLUGIN_SOURCE_LENGTH,
  PLUGIN_ID_PATTERN,
};
