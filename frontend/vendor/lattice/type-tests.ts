// Lattice compile-time tests
//
// 编译期类型测试：只做类型检查，**不被任何入口 import**，因此不会在运行时执行。
// 全部断言放在一个从不调用的函数里，避免有人直接 tsx 本文件时触发真实的 provide()。
//
// 运行方式（与自检插件互补，一个查运行时行为、一个查类型系统）：
//   npx -y typescript@5 tsc --noEmit -p tsconfig.json
//
// 说明：`@ts-expect-error` 只在「下一行确实报错」时才算通过，
// 如果类型系统放松了约束，这里会直接变成编译错误。

import { Context, definePlugin } from './context.js';
import { Context as PublicContext, PluginManagerPlugin } from './index.js';
import {
  LatticeCoreServiceMap,
  LatticeWebServiceMap,
  ToolService,
  WebServerService,
  TelemetryService,
} from './contracts/index.js';

export function compileTimeChecks() {
  // ---- 0. 公共入口导出 ----
  const publicCtx = new PublicContext<LatticeCoreServiceMap>();
  void publicCtx;
  void PluginManagerPlugin;

  // ---- 1. provide() 校验服务名与服务类型 ----

  new Context<LatticeCoreServiceMap>().provide('tools', {} as ToolService); // OK：名称与类型都对上

  // @ts-expect-error 服务类型不匹配：tools 要求 ToolService
  new Context<LatticeCoreServiceMap>().provide('tools', { invalid: true });

  // @ts-expect-error 服务名不存在：LatticeCoreServiceMap 里没有 not-exists
  new Context<LatticeCoreServiceMap>().provide('not-exists', {});

  // ---- 2. inject 能推导出插件上下文的依赖类型 ----

  definePlugin<LatticeCoreServiceMap>()({
    name: 'calc',
    inject: ['tools'],
    apply(ctx) {
      ctx.tools.getSchemas(); // OK：由 inject 推导为 ToolService，无需断言
      ctx.tools.execute('x', {}); // OK
      // @ts-expect-error 未声明的依赖不应出现在插件上下文中
      ctx.llm.chat([]);
    },
  });

  // ---- 3. inject 只接受服务表里存在的名称 ----

  definePlugin<LatticeCoreServiceMap>()({
    name: 'bad-inject',
    // @ts-expect-error 无效服务名在编译期报错
    inject: ['not-exists'],
    apply() {},
  });

  // ---- 3.1 异步 setup() 支持 Promise 与 Disposer ----

  definePlugin<LatticeCoreServiceMap>()({
    name: 'async-setup',
    inject: ['tools'],
    async setup(ctx) {
      await Promise.resolve();
      ctx.tools.getSchemas();
      return () => {};
    },
  });

  // @ts-expect-error apply 与 setup 不能同时声明
  definePlugin<LatticeCoreServiceMap>()({
    name: 'invalid-both-lifecycles',
    apply() {},
    setup() {},
  });

  // ---- 4. 应用可以通过扩展接口增加新服务 ----

  type ExtendedMap = LatticeCoreServiceMap & { cache: { get(key: string): string | undefined } };
  const extended = new Context<ExtendedMap>();
  extended.provide('cache', { get: () => undefined });
  extended.provide('tools', {} as ToolService);
  const cached: string | undefined = extended.requireService('cache').get('k');
  void cached;

  // ---- 5. Context 默认泛型仍允许测试使用自定义服务表 ----

  const testCtx = new Context<{ svc: { hello(): string } }>();
  testCtx.provide('svc', { hello: () => 'hi' });
  const greeting: string = testCtx.requireService('svc').hello();
  void greeting;
  // @ts-expect-error 自定义服务表里没有 tools
  testCtx.provide('tools', {} as ToolService);

  // ---- 6. getService() 返回可选值，requireService() 返回必选值 ----

  const optionalAgent = new Context<LatticeCoreServiceMap>().getService('agent');
  if (optionalAgent) {
    void optionalAgent.run;
  }
  const requiredTools: ToolService = new Context<LatticeCoreServiceMap>().requireService('tools');
  void requiredTools;

  // ---- 7. Core 与 Web 服务表边界 ----

  const web = new Context<LatticeWebServiceMap>();
  web.provide('webServer', {} as WebServerService);
  web.provide('telemetry', {} as TelemetryService);

  // @ts-expect-error Core 服务表不应暴露 webServer
  new Context<LatticeCoreServiceMap>().provide('webServer', {} as WebServerService);

  // @ts-expect-error Core 服务表不应暴露 telemetry
  new Context<LatticeCoreServiceMap>().provide('telemetry', {} as TelemetryService);
}
