// Lattice plugin: plugin manager + inventory

import {
  Context,
  InvalidPluginStateError,
  PluginNotFoundError,
  ProtectedPluginError,
  definePlugin,
} from '../../context.js';
import {
  LatticeCoreServiceMap,
  PluginInventoryService,
  PluginInventorySnapshot,
  PluginManagerService,
  PluginView,
} from '../../contracts/index.js';

function buildPluginView(
  ctx: Context<LatticeCoreServiceMap>,
  plugin: ReturnType<Context<LatticeCoreServiceMap>['listPlugins']>[number],
): PluginView {
  const services = ctx.root
    .listServices()
    .filter((service) => service.ownerId === plugin.id)
    .map((service) => service.name);

  const tools = (ctx.root.getService('tools')?.list() ?? [])
    .filter((tool) => tool.ownerId === plugin.id)
    .map((tool) => tool.name);

  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    layer: plugin.layer,
    status: plugin.status,
    inject: [...plugin.inject],
    provides: services,
    tools,
    error: plugin.error ? { ...plugin.error } : undefined,
    cleanupError: plugin.cleanupError ? { ...plugin.cleanupError } : undefined,
    activatedAt: plugin.activatedAt,
    disposedAt: plugin.disposedAt,
    attempt: plugin.attempt,
    protected: plugin.protected,
    runtimeDisableAllowed: !plugin.protected && plugin.status === 'active',
  };
}

export const PluginManagerPlugin = definePlugin<LatticeCoreServiceMap>()({
  id: 'plugin-manager',
  name: 'plugin-manager',
  version: '0.0.1',
  layer: 'system',
  protected: true,
  apply(ctx) {
    const inventory: PluginInventoryService = {
      list() {
        return ctx.root.listPlugins().map((plugin) => buildPluginView(ctx, plugin));
      },
      get(id) {
        return this.list().find((plugin) => plugin.id === id);
      },
      snapshot(): PluginInventorySnapshot {
        return {
          generatedAt: Date.now(),
          plugins: this.list(),
        };
      },
    };

    const manager: PluginManagerService = {
      async enable(id) {
        await ctx.root.enablePlugin(id);
      },
      async disable(id) {
        await ctx.root.disablePlugin(id);
      },
      async retry(id) {
        await ctx.root.retryPlugin(id);
      },
      async restart(id) {
        const record = ctx.root.listPlugins().find((plugin) => plugin.id === id);
        if (!record) throw new PluginNotFoundError(id);
        if (record.protected) throw new ProtectedPluginError(id, 'restart');

        if (record.status === 'active') {
          await ctx.root.disablePlugin(id);
          await ctx.root.enablePlugin(id);
          return;
        }

        if (record.status === 'failed') {
          await ctx.root.retryPlugin(id);
          return;
        }

        if (record.status === 'disposed') {
          await ctx.root.enablePlugin(id);
          return;
        }

        throw new InvalidPluginStateError(id, record.status, 'restart');
      },
    };

    ctx.provide('pluginInventory', inventory);
    ctx.provide('pluginManager', manager);
  },
});
