const STATUS_ORDER = {
  failed: 0,
  activating: 1,
  starting: 2,
  pending: 3,
  active: 4,
  disposing: 5,
  disposed: 6,
};

const STATUS_LABELS = {
  active: '运行中',
  pending: '等待依赖',
  activating: '激活中',
  starting: '启动中',
  disposing: '停用中',
  disposed: '已停用',
  failed: '异常',
};

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '运行中' },
  { key: 'pending', label: '等待' },
  { key: 'failed', label: '异常' },
  { key: 'disposed', label: '已停用' },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizePlugin(plugin = {}) {
  return {
    ...plugin,
    id: String(plugin.id || plugin.name || 'unknown-plugin'),
    name: String(plugin.name || plugin.id || 'Unknown Plugin'),
    layer: plugin.layer === 'system' ? 'system' : 'business',
    status: plugin.status || 'pending',
    inject: Array.isArray(plugin.inject) ? [...plugin.inject] : [],
    provides: Array.isArray(plugin.provides) ? [...plugin.provides] : [],
    tools: Array.isArray(plugin.tools) ? [...plugin.tools] : [],
    attempt: Number(plugin.attempt || 0),
    protected: Boolean(plugin.protected),
    runtimeDisableAllowed: Boolean(plugin.runtimeDisableAllowed),
    source: plugin.source || 'lattice',
    canUninstall: Boolean(plugin.canUninstall),
    canUpgrade: Boolean(plugin.canUpgrade),
    userVersion: plugin.userVersion || plugin.version,
    error: plugin.error ? { ...plugin.error } : undefined,
    cleanupError: plugin.cleanupError ? { ...plugin.cleanupError } : undefined,
  };
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function statusLabel(status, text = null) {
  return text?.(`plugin.status.${status}`, STATUS_LABELS[status]) || STATUS_LABELS[status] || status;
}

function statusBadge(status, text) {
  return `
    <span class="plugin-status plugin-status-${escapeHtml(status)}">
      <span class="plugin-status-dot"></span>
      ${escapeHtml(statusLabel(status, text))}
    </span>
  `;
}

function chips(items, emptyLabel = '无') {
  if (!items.length) return `<span class="plugin-chip plugin-chip-empty">${emptyLabel}</span>`;
  return items.map(item => `<span class="plugin-chip">${escapeHtml(item)}</span>`).join('');
}

function renderMetric(label, value, tone = '') {
  return `
    <div class="plugin-metric ${tone ? `plugin-metric-${tone}` : ''}">
      <span class="plugin-metric-label">${escapeHtml(label)}</span>
      <strong class="plugin-metric-value">${escapeHtml(value)}</strong>
    </div>
  `;
}

function matchesFilter(plugin, filter) {
  if (filter === 'all') return true;
  if (filter === 'pending') {
    return plugin.status === 'pending' || plugin.status === 'activating' || plugin.status === 'starting';
  }
  return plugin.status === filter;
}

function matchesQuery(plugin, query) {
  if (!query) return true;
  const searchable = [
    plugin.id,
    plugin.name,
    plugin.status,
    plugin.layer,
    ...plugin.inject,
    ...plugin.provides,
    ...plugin.tools,
  ].join(' ').toLowerCase();
  return searchable.includes(query);
}

function actionButton(action, plugin, label, primary = false) {
  const disabled = ['activating', 'starting', 'disposing'].includes(plugin.status);
  return `
    <button class="plugin-action ${primary ? 'plugin-action-primary' : ''}"
      type="button" data-plugin-action="${action}" data-plugin-id="${escapeHtml(plugin.id)}"
      ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>
  `;
}

function renderDetail(plugin, text) {
  if (!plugin) {
    return `
      <aside class="plugin-detail plugin-detail-empty" id="plugin-detail">
        <span>${text('plugin.detail.empty', '选择一个插件查看详情')}</span>
      </aside>
    `;
  }

  const canRestart = plugin.runtimeDisableAllowed && plugin.status === 'active';
  const canDisable = plugin.runtimeDisableAllowed && plugin.status === 'active';
  const canEnable = plugin.status === 'disposed';
  const canRetry = plugin.status === 'failed';
  const canUpgrade = plugin.canUpgrade;
  const canUninstall = plugin.canUninstall;
  const hasAction = canRestart || canDisable || canEnable || canRetry || canUpgrade || canUninstall;

  return `
    <aside class="plugin-detail" id="plugin-detail">
      <div class="plugin-detail-head">
        <div>
          <span class="plugin-detail-kicker">${text('plugin.detail.kicker', 'PLUGIN DETAIL')}</span>
          <h3>${escapeHtml(plugin.name)}</h3>
          <code>${escapeHtml(plugin.id)}</code>
        </div>
        ${statusBadge(plugin.status, text)}
      </div>

      <div class="plugin-detail-meta">
        <div><span>${text('plugin.detail.version', '版本')}</span><strong>${escapeHtml(plugin.version || '—')}</strong></div>
        <div><span>${text('plugin.detail.layer', '层级')}</span><strong>${plugin.layer === 'system' ? text('plugin.detail.system', '系统') : text('plugin.detail.business', '业务')}</strong></div>
        <div><span>${text('plugin.detail.attempts', '尝试次数')}</span><strong>${escapeHtml(plugin.attempt)}</strong></div>
        <div><span>${text('plugin.detail.protection', '保护状态')}</span><strong>${plugin.protected ? text('plugin.detail.protected', '受保护') : text('plugin.detail.manageable', '可管理')}</strong></div>
      </div>

      <div class="plugin-detail-group">
        <span class="plugin-detail-label">${text('plugin.detail.provides', '提供能力')}</span>
        <div class="plugin-chip-list">${chips(plugin.provides, text('plugin.detail.none', '无'))}</div>
      </div>

      <div class="plugin-detail-group">
        <span class="plugin-detail-label">${text('plugin.detail.inject', '依赖服务')}</span>
        <div class="plugin-chip-list">${chips(plugin.inject, text('plugin.detail.none', '无'))}</div>
      </div>

      <div class="plugin-detail-group">
        <span class="plugin-detail-label">${text('plugin.detail.tools', '注册工具')}</span>
        <div class="plugin-chip-list">${chips(plugin.tools, text('plugin.detail.none', '无'))}</div>
      </div>

      <div class="plugin-detail-times">
        <span>${text('plugin.detail.activated', '激活：{time}', { time: escapeHtml(formatTime(plugin.activatedAt)) })}</span>
        <span>${text('plugin.detail.disposed', '停用：{time}', { time: escapeHtml(formatTime(plugin.disposedAt)) })}</span>
      </div>

      ${plugin.error ? `
        <div class="plugin-error">
          <strong>${escapeHtml(plugin.error.code || 'PLUGIN_ERROR')}</strong>
          <p>${escapeHtml(plugin.error.message)}</p>
          <span>${escapeHtml(formatTime(plugin.error.at))}</span>
        </div>
      ` : ''}

      <div class="plugin-detail-actions">
        ${canRetry ? actionButton('retry', plugin, text('plugin.action.retry', '重试'), true) : ''}
        ${canRestart ? actionButton('restart', plugin, text('plugin.action.restart', '重启')) : ''}
        ${canEnable ? actionButton('enable', plugin, text('plugin.action.enable', '启用'), true) : ''}
        ${canDisable ? actionButton('disable', plugin, text('plugin.action.disable', '停用')) : ''}
        ${canUpgrade ? `<button class="plugin-action" type="button" data-plugin-package-action="upgrade" data-plugin-id="${escapeHtml(plugin.id)}">${text('plugin.action.upgrade', '升级')}</button>` : ''}
        ${canUninstall ? `<button class="plugin-action plugin-action-danger" type="button" data-plugin-package-action="uninstall" data-plugin-id="${escapeHtml(plugin.id)}">${text('plugin.action.uninstall', '卸载')}</button>` : ''}
        ${!hasAction ? `<span class="plugin-action-hint">${text('plugin.detail.noAction', '当前状态无需操作')}</span>` : ''}
      </div>
    </aside>
  `;
}

export function createPluginStatusPanel({ runtime = null, hostName = 'Browser', t = null } = {}) {
  const text = (key, fallback, variables) => {
    if (!t) {
      return String(fallback).replace(/\{(\w+)\}/g, (_, name) => String(variables?.[name] ?? ''));
    }
    const value = t(key, variables);
    return value === key ? fallback : value;
  };
  let plugins = [];
  let selectedPluginId = null;
  let activeFilter = 'all';
  let query = '';
  let loading = Boolean(runtime);
  let generatedAt = null;
  let loadError = null;
  let runtimeLogs = [];

  async function refresh() {
    if (!runtime) {
      plugins = [];
      loading = false;
      loadError = { message: '插件运行时尚未连接' };
      return;
    }

    loading = true;
    loadError = null;
    try {
      const snapshot = await runtime.snapshot();
      generatedAt = snapshot?.generatedAt || Date.now();
      plugins = (snapshot?.plugins || []).map(normalizePlugin);
      runtimeLogs = Array.isArray(snapshot?.logs) ? [...snapshot.logs] : [];
      if (snapshot?.error) loadError = { ...snapshot.error };
      if (!selectedPluginId || !plugins.some(plugin => plugin.id === selectedPluginId)) {
        selectedPluginId = plugins.find(plugin => plugin.id === 'markdown-editor-core')?.id ||
          plugins.find(plugin => plugin.id === 'plugin-manager')?.id ||
          plugins[0]?.id ||
          null;
      }
    } catch (error) {
      plugins = [];
      loadError = { message: error?.message || String(error) };
    } finally {
      loading = false;
    }
  }

  function filteredPlugins() {
    return plugins
      .filter(plugin => matchesFilter(plugin, activeFilter))
      .filter(plugin => matchesQuery(plugin, query))
      .sort((left, right) => {
        const order = (STATUS_ORDER[left.status] ?? 99) - (STATUS_ORDER[right.status] ?? 99);
        return order || left.name.localeCompare(right.name);
      });
  }

  function renderList() {
    const visible = filteredPlugins();
    if (loading) {
      return `<div class="plugin-list plugin-list-empty" id="plugin-list"><span>${text('plugin.list.loading', '正在读取 Lattice 运行时...')}</span></div>`;
    }
    if (!visible.length) {
      return `
        <div class="plugin-list plugin-list-empty" id="plugin-list">
          <span>${plugins.length ? text('plugin.list.emptyQuery', '没有符合条件的插件') : text('plugin.list.empty', '没有可显示的插件')}</span>
        </div>
      `;
    }

    return `
      <div class="plugin-list" id="plugin-list" role="list">
        ${visible.map(plugin => `
          <button class="plugin-row ${plugin.id === selectedPluginId ? 'active' : ''}"
            type="button" role="listitem" data-plugin-id="${escapeHtml(plugin.id)}">
            <span class="plugin-row-mark"></span>
            <span class="plugin-row-main">
              <span class="plugin-row-title">${escapeHtml(plugin.name)}</span>
              <code>${escapeHtml(plugin.id)}</code>
            </span>
            <span class="plugin-row-meta">
              <span class="plugin-layer">${plugin.layer === 'system' ? text('plugin.detail.system', '系统') : text('plugin.detail.business', '业务')}</span>
              ${statusBadge(plugin.status, text)}
            </span>
            <span class="plugin-row-capabilities">
              ${plugin.provides.length || plugin.tools.length
                ? text(
                  plugin.provides.length + plugin.tools.length === 1
                    ? 'plugin.list.capabilityCountOne'
                    : 'plugin.list.capabilityCount',
                  plugin.provides.length + plugin.tools.length === 1 ? '{count} 项能力' : '{count} 项能力',
                  { count: plugin.provides.length + plugin.tools.length },
                )
                : text('plugin.list.noCapabilities', '未提供能力')}
            </span>
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderStatusPanel() {
    const activeCount = plugins.filter(plugin => plugin.status === 'active').length;
    const pendingCount = plugins.filter(plugin => ['pending', 'activating', 'starting'].includes(plugin.status)).length;
    const failedCount = plugins.filter(plugin => plugin.status === 'failed').length;
    const serviceCount = new Set(plugins.flatMap(plugin => plugin.provides)).size;
    const toolCount = new Set(plugins.flatMap(plugin => plugin.tools)).size;
    const warning = plugins.find(plugin => plugin.status === 'failed') ||
      plugins.find(plugin => ['pending', 'activating', 'starting'].includes(plugin.status));
    const overallState = loadError
      ? text('plugin.runtime.error', '异常')
      : failedCount
        ? text('plugin.runtime.error', '异常')
        : pendingCount
          ? text('plugin.runtime.warning', '注意')
          : text('plugin.runtime.normal', '正常');
    const overallTone = loadError || failedCount ? 'error' : pendingCount ? 'warning' : 'ok';

    return `
      <section class="plugin-status-panel">
        <div class="plugin-status-head">
          <div>
            <span class="plugin-panel-kicker">${text('plugin.runtime.kicker', 'RUNTIME STATUS')}</span>
            <h2>${text('plugin.runtime.title', '运行状态')}</h2>
            <p>${text('plugin.runtime.desc', '数据直接来自 Lattice 插件清单和生命周期服务。')}</p>
          </div>
          <div class="plugin-overall plugin-overall-${overallTone}">
            <span></span>${loading ? text('plugin.runtime.loading', '读取中') : overallState}
          </div>
        </div>

        <div class="plugin-metric-grid">
          ${renderMetric(text('plugin.metric.total', '插件总数'), plugins.length)}
          ${renderMetric(text('plugin.metric.active', '运行中'), activeCount, 'ok')}
          ${renderMetric(text('plugin.metric.pending', '等待依赖'), pendingCount, pendingCount ? 'warning' : '')}
          ${renderMetric(text('plugin.metric.failed', '异常插件'), failedCount, failedCount ? 'error' : '')}
        </div>

        <div class="plugin-runtime-strip">
          <span>${text('plugin.runtime.services', '{count} 个服务', { count: serviceCount })}</span>
          <span>${text('plugin.runtime.tools', '{count} 个工具', { count: toolCount })}</span>
          <span>Host <strong>${escapeHtml(hostName)}</strong></span>
          <span>${text('plugin.runtime.updated', '更新于 {time}', { time: escapeHtml(formatTime(generatedAt || Date.now())) })}</span>
          <span class="plugin-live-badge">${text('plugin.runtime.live', '实时数据')}</span>
        </div>

        ${loadError ? `
          <div class="plugin-warning plugin-warning-error">
            <span class="plugin-warning-mark"></span>
            <div>
              <strong>${text('plugin.warning.runtimeUnavailable', '插件运行时不可用')}</strong>
              <p>${escapeHtml(loadError.message || text('plugin.warning.loadError', '无法读取插件状态'))}</p>
            </div>
          </div>
        ` : warning ? `
          <div class="plugin-warning ${warning.status === 'failed' ? 'plugin-warning-error' : ''}">
            <span class="plugin-warning-mark"></span>
            <div>
              <strong>${warning.status === 'failed'
                ? text('plugin.warning.startFailed', '{name} 启动失败', { name: escapeHtml(warning.name) })
                : text('plugin.warning.waiting', '{name} 正在等待依赖', { name: escapeHtml(warning.name) })}</strong>
              <p>${escapeHtml(warning.error?.message || text('plugin.warning.missing', '缺少服务：{services}', {
                services: warning.inject.filter(service => !plugins.some(plugin => plugin.provides.includes(service))).join(', ') || text('plugin.warning.waitingReady', '等待依赖就绪'),
              }))}</p>
            </div>
            <button type="button" data-plugin-id="${escapeHtml(warning.id)}">${text('plugin.action.details', '查看详情')}</button>
          </div>
        ` : ''}
      </section>
    `;
  }

  function renderListSection() {
    const selected = plugins.find(plugin => plugin.id === selectedPluginId) || null;
    const visibleCount = filteredPlugins().length;

    return `
      <section class="plugin-list-panel">
        <div class="plugin-list-head">
          <div>
            <span class="plugin-panel-kicker">${text('plugin.list.kicker', 'PLUGINS')}</span>
            <h2>${text('plugin.list.title', '插件列表')}</h2>
            <p>${text('plugin.list.shown', '当前显示 {visible} / {total} 个插件。', { visible: visibleCount, total: plugins.length })}</p>
          </div>
          <div class="plugin-list-tools">
            <label class="plugin-search">
              <svg data-lucide="search" width="14" height="14"></svg>
              <input type="search" data-plugin-search value="${escapeHtml(query)}" placeholder="${text('plugin.search.placeholder', '搜索插件、服务或工具')}">
            </label>
            <button class="plugin-package-button" type="button" data-plugin-global-action="install">${text('plugin.action.install', '安装插件')}</button>
            <button class="plugin-package-button" type="button" data-plugin-global-action="open-folder">${text('plugin.action.openFolder', '打开目录')}</button>
          </div>
        </div>

        <div class="plugin-filterbar" role="group" aria-label="插件状态筛选">
          ${FILTERS.map(filter => `
            <button type="button" data-plugin-filter="${filter.key}"
              class="${activeFilter === filter.key ? 'active' : ''}">
              ${text(`plugin.filter.${filter.key}`, filter.label)}
            </button>
          `).join('')}
        </div>

        <div class="plugin-list-layout">
          ${renderList()}
          ${renderDetail(selected, text)}
        </div>
      </section>
    `;
  }

  function render() {
    return `
      <div class="plugin-panel" data-plugin-panel>
        ${renderStatusPanel()}
        ${renderListSection()}
        ${renderLogs()}
      </div>
    `;
  }

  function renderLogs() {
    const visible = runtimeLogs.slice(0, 12);
    return `
      <section class="plugin-log-panel">
        <div class="plugin-log-head">
          <div>
            <span class="plugin-panel-kicker">LOGS</span>
            <h2>${text('plugin.log.title', '运行日志')}</h2>
          </div>
          ${runtimeLogs.length ? `<button type="button" data-plugin-global-action="clear-logs">${text('plugin.log.clear', '清空')}</button>` : ''}
        </div>
        <div class="plugin-log-list">
          ${visible.length ? visible.map(entry => `
            <div class="plugin-log-row plugin-log-${escapeHtml(entry.level || 'info')}">
              <span class="plugin-log-time">${escapeHtml(formatTime(entry.at))}</span>
              <span class="plugin-log-source">${escapeHtml(entry.pluginId || 'runtime')}</span>
              <span class="plugin-log-message">${escapeHtml(entry.message || '')}</span>
              ${entry.detail ? `<span class="plugin-log-detail">${escapeHtml(entry.detail)}</span>` : ''}
            </div>
          `).join('') : `<span class="plugin-log-empty">${text('plugin.log.empty', '暂无运行日志')}</span>`}
        </div>
      </section>
    `;
  }

  function setQuery(value) {
    query = String(value || '').trim().toLowerCase();
  }

  async function handleClick(event) {
    const panel = event.target.closest('[data-plugin-panel]');
    if (!panel) return null;

    const filter = event.target.closest('[data-plugin-filter]');
    if (filter) {
      activeFilter = filter.dataset.pluginFilter;
      return { rerender: true };
    }

    const globalAction = event.target.closest('[data-plugin-global-action]');
    if (globalAction) {
      const action = globalAction.dataset.pluginGlobalAction;
      if (action === 'clear-logs') {
        runtime?.clearLogs?.();
        await refresh();
        return { rerender: true, toast: text('plugin.log.cleared', '运行日志已清空') };
      }
      if (action === 'install') return { requestInstall: true };
      if (action === 'open-folder') return { openPluginFolder: true };
    }

    const packageAction = event.target.closest('[data-plugin-package-action]');
    if (packageAction) {
      const pluginId = packageAction.dataset.pluginId;
      const action = packageAction.dataset.pluginPackageAction;
      if (action === 'upgrade') return { requestUpgrade: pluginId };
      if (action === 'uninstall') {
        try {
          await runtime.uninstallPlugin(pluginId);
          await refresh();
          return { rerender: true, toast: text('plugin.action.uninstalled', '插件已卸载') };
        } catch (error) {
          return { rerender: true, toast: `${text('plugin.action.uninstallFailed', '卸载失败')}: ${error.message || error}` };
        }
      }
    }

    const action = event.target.closest('[data-plugin-action]');
    if (action) {
      if (!runtime) {
        return { rerender: true, toast: text('plugin.runtime.notConnected', '插件运行时尚未连接') };
      }
      const pluginId = action.dataset.pluginId;
      const actionName = action.dataset.pluginAction;
      const result = await runtime.performAction(actionName, pluginId);
      await refresh();
      const plugin = plugins.find(item => item.id === pluginId);
      return {
        rerender: true,
        toast: result?.ok
          ? text('plugin.action.done', '{name} 已完成操作', { name: plugin?.name || pluginId })
          : text('plugin.action.failed', '操作失败：{message}', { message: result?.error?.message || text('plugin.action.unknownError', '未知错误') }),
      };
    }

    const pluginTarget = event.target.closest('[data-plugin-id]');
    if (pluginTarget) {
      selectedPluginId = pluginTarget.dataset.pluginId;
      return { rerender: true };
    }

    return null;
  }

  return {
    refresh,
    render,
    setQuery,
    handleClick,
  };
}

export {
  FILTERS,
  STATUS_LABELS,
  statusLabel,
};
