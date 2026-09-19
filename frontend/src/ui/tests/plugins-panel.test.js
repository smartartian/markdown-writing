import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPluginStatusPanel,
  STATUS_LABELS,
  statusLabel,
} from '../settings/plugins-panel.js';

function makePlugins() {
  return [
    {
      id: 'plugin-manager',
      name: 'Plugin Manager',
      version: '0.0.1',
      layer: 'system',
      status: 'active',
      inject: [],
      provides: ['pluginInventory', 'pluginManager'],
      tools: [],
      protected: true,
      runtimeDisableAllowed: false,
      attempt: 1,
    },
    {
      id: 'markdown-editor-core',
      name: 'Markdown Editor Core',
      version: '0.0.2',
      layer: 'business',
      status: 'active',
      inject: ['host'],
      provides: ['editorCore', 'markdown', 'shortcuts'],
      tools: [],
      protected: true,
      runtimeDisableAllowed: false,
      attempt: 1,
    },
    {
      id: 'user-plugin',
      name: 'User Plugin',
      version: '1.0.0',
      layer: 'business',
      status: 'active',
      inject: [],
      provides: ['exampleService'],
      tools: [],
      protected: false,
      runtimeDisableAllowed: true,
      canUninstall: true,
      canUpgrade: true,
      attempt: 1,
    },
  ];
}

function makeTarget({ pluginId = null, action = null, filter = null, globalAction = null, packageAction = null } = {}) {
  return {
    closest(selector) {
      if (selector === '[data-plugin-panel]') return {};
      if (selector === '[data-plugin-filter]' && filter) {
        return { dataset: { pluginFilter: filter } };
      }
      if (selector === '[data-plugin-action]' && action) {
        return {
          dataset: { pluginAction: action, pluginId },
          textContent: action === 'retry' ? '重试' : '操作',
        };
      }
      if (selector === '[data-plugin-global-action]' && globalAction) {
        return { dataset: { pluginGlobalAction: globalAction } };
      }
      if (selector === '[data-plugin-package-action]' && packageAction) {
        return { dataset: { pluginPackageAction: packageAction, pluginId } };
      }
      if (selector === '[data-plugin-id]' && pluginId) {
        return { dataset: { pluginId } };
      }
      return null;
    },
  };
}

function makeRuntime() {
  const plugins = makePlugins();
  return {
    snapshot: async () => ({
      generatedAt: Date.now(),
      plugins,
      logs: [{ level: 'info', pluginId: 'runtime', message: 'ready', at: new Date().toISOString() }],
    }),
    performAction: async (action, pluginId) => {
      const plugin = plugins.find(item => item.id === pluginId);
      if (action === 'disable') plugin.status = 'disposed';
      if (action === 'enable' || action === 'restart' || action === 'retry') plugin.status = 'active';
      plugin.attempt += 1;
      return { ok: true, pluginId, status: plugin.status };
    },
    uninstallPlugin: async pluginId => {
      const index = plugins.findIndex(item => item.id === pluginId);
      if (index >= 0) plugins.splice(index, 1);
    },
    clearLogs: () => {},
  };
}

test('plugin panel renders live runtime summary and plugin rows', async () => {
  const panel = createPluginStatusPanel({ runtime: makeRuntime() });
  await panel.refresh();
  const html = panel.render();

  assert.match(html, /运行状态/);
  assert.match(html, /插件列表/);
  assert.match(html, /Markdown Editor Core/);
  assert.match(html, /实时数据/);
  assert.doesNotMatch(html, /预览数据/);
  assert.match(html, /运行日志/);
  assert.match(html, /ready/);
});

test('plugin panel requests plugin package installation', async () => {
  const panel = createPluginStatusPanel({ runtime: makeRuntime() });
  await panel.refresh();
  const result = await panel.handleClick({
    target: makeTarget({ globalAction: 'install' }),
  });
  assert.equal(result.requestInstall, true);
});

test('plugin panel delegates user plugin uninstall', async () => {
  const panel = createPluginStatusPanel({ runtime: makeRuntime() });
  await panel.refresh();
  const result = await panel.handleClick({
    target: makeTarget({ pluginId: 'user-plugin', packageAction: 'uninstall' }),
  });
  const html = panel.render();
  assert.equal(result.rerender, true);
  assert.doesNotMatch(html, /data-plugin-id="user-plugin"/);
});

test('plugin panel search narrows the visible list', async () => {
  const panel = createPluginStatusPanel({ runtime: makeRuntime() });
  await panel.refresh();
  panel.setQuery('plugin-manager');
  const html = panel.render();

  assert.match(html, /Plugin Manager/);
  assert.doesNotMatch(html, /data-plugin-id="markdown-editor-core"/);
});

test('plugin panel actions are delegated to the runtime', async () => {
  const panel = createPluginStatusPanel({ runtime: makeRuntime() });
  await panel.refresh();
  const result = await panel.handleClick({
    target: makeTarget({ pluginId: 'markdown-editor-core', action: 'disable' }),
  });
  const html = panel.render();

  assert.equal(result.rerender, true);
  assert.equal(statusLabel('failed'), '异常');
  assert.equal(STATUS_LABELS.disposed, '已停用');
  assert.match(html, /Markdown Editor Core[\s\S]*已停用/);
});
