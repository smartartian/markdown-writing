import { Context, definePlugin } from '../../node_modules/lattice/context.ts';
import { PluginManagerPlugin } from '../../node_modules/lattice/plugins/plugin-manager/index.ts';
import { compareVersions, parsePluginPackage } from './package.js';

const PLUGIN_EVENTS = [
  'plugin:activated',
  'plugin:disposed',
  'plugin:state-changed',
  'plugin:failed',
];

const MAX_LOG_ENTRIES = 300;

function errorPayload(error, fallback = '插件操作失败') {
  if (error instanceof Error) {
    return {
      code: error.name || 'PLUGIN_ERROR',
      message: error.message || fallback,
      stack: error.stack,
    };
  }
  return {
    code: 'PLUGIN_ERROR',
    message: String(error || fallback),
  };
}

function compileUserPlugin(pkg) {
  let entryFactory;
  try {
    entryFactory = new Function(`"use strict"; return (${pkg.entry});`)();
  } catch (error) {
    throw new Error(`插件入口语法错误: ${error.message || error}`);
  }
  if (typeof entryFactory !== 'function') throw new Error('插件 entry 必须导出函数');

  const base = {
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    layer: pkg.layer,
    inject: pkg.inject,
    protected: false,
  };
  if (pkg.async) {
    return definePlugin()({
      ...base,
      async setup(ctx) {
        return entryFactory(ctx);
      },
    });
  }
  return definePlugin()({
    ...base,
    apply(ctx) {
      return entryFactory(ctx);
    },
  });
}

function pluginDefinition({ id, name, version, layer, inject = [], protected: isProtected = false, provides }) {
  return definePlugin()({
    id,
    name,
    version,
    layer,
    inject,
    protected: isProtected,
    apply(ctx) {
      for (const [serviceName, serviceValue] of Object.entries(provides)) {
        ctx.provide(serviceName, serviceValue, { version });
      }
    },
  });
}

export function createAppPluginRuntime({
  appVersion,
  hostName = 'Browser',
  hostService,
  editorCoreService,
  markdownService,
  shortcutService,
  workspaceService,
  documentStoreService,
  settingsService,
  exportService,
  recoveryService,
  pluginStorage = {},
  loadPreferences = async () => ({}),
  savePreferences = async () => {},
} = {}) {
  const listeners = new Set();
  const logs = [];
  const builtInPlugins = [
    pluginDefinition({
      id: 'desktop-host',
      name: 'Desktop Host',
      version: appVersion,
      layer: 'system',
      protected: true,
      provides: { host: hostService },
    }),
    pluginDefinition({
      id: 'markdown-editor-core',
      name: 'Markdown Editor Core',
      version: appVersion,
      layer: 'business',
      inject: ['host'],
      protected: true,
      provides: {
        editorCore: editorCoreService,
        markdown: markdownService,
        shortcuts: shortcutService,
      },
    }),
    pluginDefinition({
      id: 'workspace-service',
      name: 'Workspace Service',
      version: appVersion,
      layer: 'business',
      inject: ['host'],
      protected: true,
      provides: { workspace: workspaceService },
    }),
    pluginDefinition({
      id: 'document-store',
      name: 'Document Store',
      version: appVersion,
      layer: 'business',
      inject: ['host'],
      protected: true,
      provides: { documentStore: documentStoreService },
    }),
    pluginDefinition({
      id: 'settings-service',
      name: 'Settings Service',
      version: appVersion,
      layer: 'business',
      inject: ['host'],
      protected: true,
      provides: { settings: settingsService },
    }),
    pluginDefinition({
      id: 'recovery-service',
      name: 'Recovery Service',
      version: appVersion,
      layer: 'business',
      inject: ['documentStore'],
      protected: true,
      provides: { recovery: recoveryService },
    }),
    pluginDefinition({
      id: 'export-service',
      name: 'Export Service',
      version: appVersion,
      layer: 'business',
      inject: ['host', 'markdown'],
      protected: false,
      provides: { export: exportService },
    }),
  ];

  const builtInIds = new Set([...builtInPlugins.map(plugin => plugin.id), 'plugin-manager']);
  let context = null;
  let startPromise = null;
  let started = false;
  let startError = null;
  let preferences = {};
  let userPackages = new Map();

  function appendLog(level, pluginId, message, detail = '') {
    logs.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      level,
      pluginId: pluginId || 'runtime',
      message: String(message || ''),
      detail: detail ? String(detail) : '',
    });
    if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;
  }

  function notify() {
    for (const listener of listeners) listener('runtime:changed');
  }

  function bindEvents() {
    for (const eventName of PLUGIN_EVENTS) {
      context.onRoot(eventName, payload => {
        const level = eventName === 'plugin:failed' ? 'error' : 'info';
        appendLog(level, payload?.id, `${eventName}${payload?.status ? `: ${payload.status}` : ''}`, payload?.error?.message || '');
        notify();
      });
    }
  }

  async function loadUserPackages() {
    userPackages = new Map();
    if (typeof pluginStorage.listUserPlugins !== 'function') return;
    try {
      const files = await pluginStorage.listUserPlugins() || {};
      for (const [id, content] of Object.entries(files)) {
        try {
          const pkg = parsePluginPackage(content);
          userPackages.set(pkg.id, pkg);
        } catch (error) {
          appendLog('error', id, '用户插件包加载失败', error.message || String(error));
        }
      }
    } catch (error) {
      appendLog('error', 'runtime', '无法读取用户插件目录', error.message || String(error));
    }
  }

  async function initializeContext() {
    if (context) {
      try { await context.dispose(); } catch (error) { appendLog('warning', 'runtime', '旧插件上下文清理失败', error.message || String(error)); }
    }
    context = new Context();
    startError = null;

    for (const plugin of builtInPlugins) context.plugin(plugin);
    for (const pkg of userPackages.values()) {
      try {
        context.plugin(compileUserPlugin(pkg));
        appendLog('info', pkg.id, `已加载用户插件 v${pkg.version}`);
      } catch (error) {
        appendLog('error', pkg.id, '用户插件注册失败', error.message || String(error));
      }
    }
    context.plugin(PluginManagerPlugin);
    bindEvents();

    try {
      await context.start();
    } catch (error) {
      startError = errorPayload(error, '插件运行时启动失败');
      appendLog('error', 'runtime', startError.message, startError.stack || '');
    }
    appendLog('info', 'runtime', 'Lattice 应用运行时已初始化', `${builtInPlugins.length} 个内置插件，${userPackages.size} 个用户插件`);
    await applyPreferences();
    notify();
  }

  async function applyPreferences() {
    const manager = context?.getService('pluginManager');
    const inventory = context?.getService('pluginInventory');
    if (!manager || !inventory) return;

    for (const [pluginId, enabled] of Object.entries(preferences)) {
      const plugin = inventory.get(pluginId);
      if (!plugin || plugin.protected) continue;
      try {
        if (!enabled && plugin.status === 'active') {
          await manager.disable(pluginId);
          appendLog('info', pluginId, '已恢复停用状态');
        } else if (enabled && plugin.status === 'disposed') {
          await manager.enable(pluginId);
          appendLog('info', pluginId, '已恢复启用状态');
        }
      } catch (error) {
        appendLog('warning', pluginId, '恢复插件状态失败', error.message || String(error));
      }
    }
  }

  async function persistPreferences() {
    try {
      await savePreferences({ ...preferences });
    } catch (error) {
      appendLog('warning', 'runtime', '保存插件状态失败', error.message || String(error));
    }
  }

  async function rebuild() {
    await loadUserPackages();
    await initializeContext();
  }

  async function start() {
    if (started) return;
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        preferences = await loadPreferences() || {};
      } catch (error) {
        appendLog('warning', 'runtime', '读取插件状态失败', error.message || String(error));
        preferences = {};
      }
      await rebuild();
      started = true;
    })().finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  function normalizeInventoryPlugin(plugin) {
    const isUserPlugin = userPackages.has(plugin.id);
    return {
      ...plugin,
      source: builtInIds.has(plugin.id) ? 'builtin' : isUserPlugin ? 'user' : 'lattice',
      canUninstall: isUserPlugin,
      canUpgrade: isUserPlugin,
      userVersion: userPackages.get(plugin.id)?.version || plugin.version,
    };
  }

  async function snapshot() {
    await start();
    const inventory = context?.getService('pluginInventory');
    if (inventory?.snapshot) {
      const snapshot = inventory.snapshot();
      return {
        ...snapshot,
        plugins: snapshot.plugins.map(normalizeInventoryPlugin),
        error: startError,
        logs: [...logs],
      };
    }
    return {
      generatedAt: Date.now(),
      plugins: (context?.listPlugins() || []).map(normalizeInventoryPlugin),
      error: startError,
      logs: [...logs],
    };
  }

  async function performAction(action, pluginId) {
    await start();
    const manager = context?.getService('pluginManager');
    if (!manager || typeof manager[action] !== 'function') {
      return {
        ok: false,
        pluginId,
        error: { code: 'PLUGIN_MANAGER_UNAVAILABLE', message: '插件管理器尚未就绪' },
      };
    }

    appendLog('info', pluginId, `执行操作: ${action}`);
    try {
      const inventory = context.getService('pluginInventory');
      const pluginBeforeAction = inventory?.get(pluginId);
      await manager[action](pluginId);
      if (pluginBeforeAction && !pluginBeforeAction.protected && (action === 'enable' || action === 'disable')) {
        preferences[pluginId] = action === 'enable';
        await persistPreferences();
      }
      appendLog('success', pluginId, `操作完成: ${action}`, inventory?.get(pluginId)?.status || '');
      notify();
      return {
        ok: true,
        pluginId,
        status: inventory?.get(pluginId)?.status,
      };
    } catch (error) {
      const payload = errorPayload(error);
      appendLog('error', pluginId, `操作失败: ${action}`, payload.message);
      notify();
      return {
        ok: false,
        pluginId,
        error: payload,
      };
    }
  }

  async function installPlugin(content, { upgrade = false } = {}) {
    await start();
    const pkg = parsePluginPackage(content);
    if (builtInIds.has(pkg.id)) throw new Error('不能覆盖系统内置插件');
    const existing = userPackages.get(pkg.id);
    if (existing && !upgrade) throw new Error(`插件 ${pkg.id} 已安装`);
    if (upgrade && !existing) throw new Error(`插件 ${pkg.id} 尚未安装`);
    if (existing && compareVersions(pkg.version, existing.version) <= 0) {
      throw new Error(`升级版本必须高于当前版本 ${existing.version}`);
    }
    if (typeof pluginStorage.saveUserPlugin !== 'function') {
      throw new Error('当前存储不支持用户插件');
    }
    await pluginStorage.saveUserPlugin(pkg.id, pkg.source);
    appendLog('info', pkg.id, existing ? `升级到 v${pkg.version}` : `安装 v${pkg.version}`);
    await rebuild();
    return { ok: true, pluginId: pkg.id, version: pkg.version };
  }

  async function uninstallPlugin(pluginId) {
    await start();
    if (!userPackages.has(pluginId)) throw new Error('只能卸载用户插件');
    if (typeof pluginStorage.deleteUserPlugin !== 'function') throw new Error('当前存储不支持用户插件');
    await pluginStorage.deleteUserPlugin(pluginId);
    delete preferences[pluginId];
    await persistPreferences();
    appendLog('info', pluginId, '已卸载用户插件');
    await rebuild();
    return { ok: true, pluginId };
  }

  function getService(serviceName) {
    return context?.getService(serviceName);
  }

  function invokeService(serviceName, method, fallback, ...args) {
    const service = getService(serviceName);
    const handler = service?.[method];
    if (typeof handler === 'function') return handler.apply(service, args);
    if (typeof fallback === 'function') return fallback(...args);
    throw new Error(`服务未就绪: ${serviceName}.${method}`);
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    hostName,
    start,
    snapshot,
    performAction,
    installPlugin,
    uninstallPlugin,
    getService,
    invokeService,
    getLogs: () => [...logs],
    clearLogs: () => {
      logs.length = 0;
      notify();
    },
    getPluginDirectory: async () => typeof pluginStorage.getUserPluginsDirectory === 'function'
      ? pluginStorage.getUserPluginsDirectory()
      : '',
    revealPluginDirectory: async () => typeof pluginStorage.revealUserPluginsDirectory === 'function'
      ? pluginStorage.revealUserPluginsDirectory()
      : undefined,
    subscribe,
    dispose: () => context?.dispose(),
    getStartError: () => startError,
  };
}

export {
  compareVersions,
  parsePluginPackage,
};
