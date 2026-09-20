// Lattice plugin: verify
//
// 自检插件：35 个场景的测试本体 + 断言脚手架，挂载后**不自动执行**，
// 通过 ctx.verify.run() 按需触发。
//
// 设计要点：
// - 每个场景内部 new Context()，跑在独立容器上，完全不污染宿主容器；
// - 断言脚手架用「当前运行」作用域（activeRun），同一时刻只允许一次 run()；
// - 文件末尾带 argv 守卫：直接以本文件为入口执行时，承担 CLI 职责并返回退出码
//   （与 web-server.ts 同一模式），因此不需要额外的 verify.ts 入口文件。

import {
  Context,
  Plugin,
  PluginRecord,
  definePlugin,
  DuplicateServiceError,
  DuplicatePluginError,
  ServiceInUseError,
  ContainerDisposedError,
  PluginDependencyError,
  PluginStartError,
  PluginNotFoundError,
  InvalidPluginStateError,
  ProtectedPluginError,
} from '../../context.js';
import {
  LatticeCoreServiceMap,
  ToolService,
  ToolDefinition,
  DuplicateToolError,
  VerifyReport,
  VerifyService,
  VerifyRunOptions,
  VerifyFailure,
  VerifyScenarioResult,
} from '../../contracts/index.js';
// 提供 tools 服务：直接复用真实的 ToolsPlugin，避免在测试里复刻一份实现
import { ToolsPlugin as ToolsProvider } from '../tools/index.js';
import { PluginManagerPlugin } from '../plugin-manager/index.js';

declare const process: any;

// ==========================================
// 1. 断言脚手架（run 作用域）
// ==========================================

interface ActiveRun {
  log: boolean;
  passed: number;
  failures: VerifyFailure[];
  results: VerifyScenarioResult[];
  current: VerifyScenarioResult;
}

let activeRun: ActiveRun | null = null;

function check(name: string, condition: boolean, detail = '') {
  const run = activeRun;
  if (!run) throw new Error('check() 只能在 verify run 过程中调用');
  if (condition) {
    run.passed += 1;
    run.current.passed += 1;
    if (run.log) console.log(`  ✅ ${name}`);
  } else {
    run.current.failed += 1;
    run.failures.push({
      scenario: run.current.title,
      assertion: name,
      detail: detail || undefined,
    });
    if (run.log) console.log(`  ❌ ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

async function scenario(title: string, body: () => Promise<void> | void) {
  const run = activeRun;
  if (!run) throw new Error('scenario() 只能在 verify run 过程中调用');

  run.current = { title, passed: 0, failed: 0 };
  if (run.log) console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

  try {
    await body();
  } catch (err) {
    const detail = (err as Error).message;
    run.current.failed += 1;
    run.failures.push({ scenario: title, assertion: `${title}（场景抛错）`, detail });
    if (run.log) console.log(`  ❌ 场景抛错: ${detail}`);
  }

  run.results.push(run.current);
}

// ==========================================
// 2. 测试用插件与工具
// ==========================================

const tool = (name: string): ToolDefinition => ({
  name,
  description: `${name} 的描述`,
  parameters: { type: 'object', properties: {} },
  execute: async () => `${name}-ok`,
});

const toolNames = (tools: ToolService) => tools.getSchemas().map((t) => t.name);

/** 只依赖「列出插件记录」这一能力，因此任意服务表的容器都能传进来 */
function recordOf(ctx: { listPlugins(): PluginRecord[] }, name: string) {
  const rec = ctx.listPlugins().find((p) => p.name === name);
  if (!rec) throw new Error(`插件记录不存在: ${name}`);
  return rec;
}

/** 按稳定插件 id 查找（控制台的寻址方式） */
function recordById(ctx: { listPlugins(): PluginRecord[] }, id: string) {
  const rec = ctx.listPlugins().find((p) => p.id === id);
  if (!rec) throw new Error(`插件记录不存在: ${id}`);
  return rec;
}

/**
 * 读取根对象上的动态属性（Proxy 的运行时兼容通道）。
 *
 * 仅用于校验「销毁后不残留悬空服务根属性」这一不变量 —— 业务代码一律走
 * `getService()` / `requireService()`，不再依赖动态属性。
 */
function rootProp(root: unknown, name: string): unknown {
  return (root as Record<string, unknown>)[name];
}

/**
 * 测试容器使用的服务表：只声明该场景真正用到的服务。
 *
 * 每个场景都是独立的容器，服务表也跟着场景走 —— 既拿到了 `provide()` 的名称/类型校验，
 * 又不会把 `svc` / `dup` 这类临时服务名污染进应用的 `LatticeCoreServiceMap`。
 */
type ToolsMap = { tools: ToolService };
type DupMap = { dup: { from: string } };
type Dup2Map = { dup2: { from: string } };
type FlakyMap = { 'flaky-svc': { ok: boolean } };
type SvcHelloMap = { svc: { hello(): string } };
type OrderMap = { 'order-svc': { ok: boolean } };
type ToolsLLMMap = { tools: ToolService; llm: unknown };
type SvcOkMap = { svc: { ok: number } };
type CleanupMap = { 'svc-a': { a: number }; 'svc-b': { b: number }; 'svc-c': { c: number } };
type SvcEmptyMap = { svc: Record<string, never> };
type WaitQueueMap = { svc: unknown; svc2: unknown };
/**
 * 需要装配内置插件（按核心服务表 `LatticeCoreServiceMap` 定义）的场景：
 * 服务表必须是应用服务表的**超集**，否则两个容器之间不可互相赋值。
 */
type AppMap<Extra> = LatticeCoreServiceMap & Extra;

type DisposingMap = AppMap<{ svc: unknown; 'late-svc': unknown }>;
type LateSvcMap = { svc: { v: number }; 'late-svc': unknown };
type MySvcMap = AppMap<{ 'my-svc': { v: number } }>;

// ==========================================
// 3. 全部场景
// ==========================================

async function runAllScenarios() {
  // ---------- 工具重名保护 ----------

  await scenario('1. 工具重名：默认拒绝，显式 replace 才允许', () => {
    const ctx = new Context<ToolsMap>();
    ctx.plugin(ToolsProvider);
    const tools = ctx.requireService('tools');

    tools.register(tool('calc'), { ownerId: 'owner-a' });
    check('首次注册成功', toolNames(tools).includes('calc'));

    let dupErr: unknown;
    try {
      tools.register(tool('calc'), { ownerId: 'owner-b' });
    } catch (err) {
      dupErr = err;
    }
    check('同名默认注册抛 DuplicateToolError', dupErr instanceof DuplicateToolError);
    check(
      '错误信息包含已有工具的 ownerId',
      dupErr instanceof DuplicateToolError && dupErr.existingOwner === 'owner-a',
      (dupErr as Error)?.message,
    );
    check('拒绝后原工具未被改动', toolNames(tools).includes('calc'));

    tools.register(tool('calc'), { ownerId: 'owner-b', replace: true });
    check('显式 replace 后注册成功', toolNames(tools).includes('calc'));
  });

  await scenario('2. 校验失败时不触碰内部状态（注册原子化）', () => {
    const ctx = new Context<ToolsMap>();
    ctx.plugin(ToolsProvider);
    const tools = ctx.requireService('tools');

    let nameErr: unknown;
    try {
      tools.register(tool('bad name!'), { ownerId: 'owner-a' });
    } catch (err) {
      nameErr = err;
    }
    check('非法工具名被拒绝', (nameErr as Error)?.name === 'InvalidToolDefinitionError');

    let execErr: unknown;
    try {
      tools.register({ ...tool('no-exec'), execute: undefined as any }, { ownerId: 'owner-a' });
    } catch (err) {
      execErr = err;
    }
    check('缺少 execute 被拒绝', (execErr as Error)?.name === 'InvalidToolDefinitionError');
    check('两次校验失败后工具表仍为空', toolNames(tools).length === 0);
  });

  // ---------- Disposer 幂等与代次 ----------

  await scenario('3. Disposer 幂等：旧句柄不会误删新注册的工具', () => {
    const ctx = new Context<ToolsMap>();
    ctx.plugin(ToolsProvider);
    const tools = ctx.requireService('tools');

    const oldDisposer = tools.register(tool('calc'), { ownerId: 'owner-a' });
    const newDisposer = tools.register(tool('calc'), { ownerId: 'owner-b', replace: true });

    oldDisposer();
    check('被替换工具的旧 Disposer 不删除新工具', toolNames(tools).includes('calc'));

    newDisposer();
    check('新 Disposer 正常删除', !toolNames(tools).includes('calc'));

    newDisposer();
    newDisposer();
    check('同一 Disposer 连续调用两次不产生副作用', !toolNames(tools).includes('calc'));

    const reRegistered = tools.register(tool('calc'), { ownerId: 'owner-c' });
    newDisposer();
    check('已失效的旧 Disposer 二次调用不影响后来者', toolNames(tools).includes('calc'));
    reRegistered();
  });

  // ---------- 插件失败状态与事务回滚 ----------

  await scenario('4. 插件注册工具后初始化失败 → 工具自动回滚 + 状态 failed', () => {
    const ctx = new Context<ToolsMap>();
    ctx.plugin(ToolsProvider);
    const tools = ctx.requireService('tools');

    const broken: Plugin<ToolsMap, 'tools'> = {
      name: 'broken-tool-plugin',
      inject: ['tools'],
      apply(pluginCtx) {
        // 显式 ctx.effect：即使之后抛错，工具也会被回滚
        pluginCtx.effect(tools.register(tool('ghost'), { ownerId: pluginCtx.ownerId }));
        throw new Error('故意在注册工具之后失败');
      },
    };

    ctx.plugin(broken);

    check('工具已被自动回滚', !toolNames(tools).includes('ghost'));
    const rec = recordOf(ctx, 'broken-tool-plugin');
    check('插件状态为 failed', rec.status === 'failed', rec.status);
    check('记录了可序列化错误摘要', rec.error?.message.includes('故意') === true);
    check('attempt 已递增为 1', rec.attempt === 1, String(rec.attempt));
    check(
      'failed 插件不留在等待队列',
      ctx.listPlugins().filter((p) => p.status === 'pending').length === 0,
    );
  });

  await scenario('5. 插件服务重名 → DuplicateServiceError 且不覆盖已有服务', () => {
    // 宽松模式（默认）：provide() 内部抛错 → 该插件回滚并记为 failed，不冒泡给 plugin() 调用方
    const ctx = new Context<DupMap>();
    ctx.plugin({ name: 'provider-a', apply: (c) => void c.provide('dup', { from: 'a' }) });
    ctx.plugin({ name: 'provider-b', apply: (c) => void c.provide('dup', { from: 'b' }) });

    const rec = recordOf(ctx, 'provider-b');
    check('重复提供者状态为 failed', rec.status === 'failed', rec.status);
    check(
      '失败原因记录为 DuplicateServiceError',
      rec.error?.code === 'DuplicateServiceError',
      JSON.stringify(rec.error),
    );
    check(
      '错误信息包含双方插件 id',
      rec.error?.message.includes('provider-a') === true &&
        rec.error?.message.includes('provider-b') === true,
      rec.error?.message,
    );
    const dup = ctx.requireService('dup');
    check('先注册的服务未被覆盖', dup.from === 'a', JSON.stringify(dup));
    check('服务注册表仍只有一份 dup', ctx.listServices().filter((s) => s.name === 'dup').length === 1);
    check('失败方没有产出任何服务', ctx.listServices().every((s) => (s.value as any)?.from !== 'b'));

    // 严格模式：同样的冲突会直接抛给调用方
    const strictCtx = new Context<Dup2Map>(undefined, { strictPlugins: true });
    strictCtx.plugin({ name: 'p-a', apply: (c) => void c.provide('dup2', { from: 'a' }) });
    let thrown: unknown;
    try {
      strictCtx.plugin({ name: 'p-b', apply: (c) => void c.provide('dup2', { from: 'b' }) });
    } catch (err) {
      thrown = err;
    }
    check('严格模式下直接抛 DuplicateServiceError', thrown instanceof DuplicateServiceError);
    check('严格模式下原服务同样未被覆盖', strictCtx.requireService('dup2').from === 'a');
  });

  await scenario('6. failed → retryPlugin → active', async () => {
    const ctx = new Context<FlakyMap>();
    let shouldFail = true;

    const flaky: Plugin<FlakyMap> = {
      name: 'flaky-plugin',
      apply(pluginCtx) {
        if (shouldFail) throw new Error('第一次故意失败');
        pluginCtx.provide('flaky-svc', { ok: true });
      },
    };

    ctx.plugin(flaky);
    const id = recordOf(ctx, 'flaky-plugin').id;
    check('首次激活后状态为 failed', recordOf(ctx, 'flaky-plugin').status === 'failed');
    check('失败时未提供任何服务', ctx.getService('flaky-svc') === undefined);

    shouldFail = false;
    await ctx.retryPlugin(id);

    const rec = recordOf(ctx, 'flaky-plugin');
    check('重试后状态为 active', rec.status === 'active', rec.status);
    check('重试后 error 已清除', rec.error === undefined);
    check('attempt 递增为 2', rec.attempt === 2, String(rec.attempt));
    check('重试后服务已提供', ctx.getService('flaky-svc') !== undefined);
  });

  // ---------- 服务卸载与依赖保护 ----------

  await scenario('7. 服务提供者卸载：有活跃依赖时拒绝，依赖先卸载后引用消失', async () => {
    const ctx = new Context<SvcHelloMap>();
    ctx.plugin({ name: 'svc-provider', apply: (c) => void c.provide('svc', { hello: () => 'hi' }) });
    ctx.plugin({ name: 'svc-consumer', inject: ['svc'], apply: () => {} });

    const providerId = recordOf(ctx, 'svc-provider').id;
    const consumerId = recordOf(ctx, 'svc-consumer').id;

    check('服务已挂载到 root', ctx.getService('svc') !== undefined);
    check('依赖方已成功激活', recordOf(ctx, 'svc-consumer').status === 'active');

    let inUse: unknown;
    try {
      await ctx.unloadPlugin(providerId);
    } catch (err) {
      inUse = err;
    }
    check('活跃依赖存在时拒绝卸载提供者', inUse instanceof ServiceInUseError);
    check(
      '错误中列出依赖方 id',
      inUse instanceof ServiceInUseError && inUse.dependents.includes(consumerId),
      (inUse as Error)?.message,
    );
    check('拒绝后服务仍然可用', ctx.getService('svc') !== undefined);
    check('拒绝后提供者仍是 active', recordOf(ctx, 'svc-provider').status === 'active');

    await ctx.unloadPlugin(consumerId);
    check('依赖方已 disposed', recordOf(ctx, 'svc-consumer').status === 'disposed');
    check('依赖方卸载后服务仍在（提供者未卸载）', ctx.getService('svc') !== undefined);

    await ctx.unloadPlugin(providerId);
    check('提供者卸载后 root 上的服务引用消失', ctx.getService('svc') === undefined);
    check('服务注册表已同步移除', ctx.listServices().every((s) => s.name !== 'svc'));
    check('提供者状态为 disposed', recordOf(ctx, 'svc-provider').status === 'disposed');
  });

  // ---------- 销毁顺序与全量清理 ----------

  await scenario('8. 根容器销毁：依赖方先于提供方被清理', async () => {
    const ctx = new Context<OrderMap>();
    const order: string[] = [];

    ctx.plugin({
      name: 'order-provider',
      apply(c) {
        c.provide('order-svc', { ok: true });
        c.effect(() => void order.push('provider'));
      },
    });
    ctx.plugin({
      name: 'order-consumer',
      inject: ['order-svc'],
      apply(c) {
        c.effect(() => void order.push('consumer'));
      },
    });

    await ctx.dispose();

    check('两个插件都执行了清理', order.length === 2, JSON.stringify(order));
    check(
      '依赖方(consumer)先于提供方(provider)被清理',
      order.indexOf('consumer') !== -1 && order.indexOf('consumer') < order.indexOf('provider'),
      JSON.stringify(order),
    );
  });

  await scenario('9. dispose() 后服务/工具/事件/Waterfall/插件状态全部清理', async () => {
    const ctx = new Context<ToolsLLMMap>();
    ctx.plugin(ToolsProvider);
    ctx.plugin({
      name: 'calc-plugin',
      inject: ['tools'],
      apply(c) {
        c.effect(c.tools.register(tool('calculate'), { ownerId: c.ownerId }));
      },
    });
    ctx.plugin({ name: 'llm-plugin', apply: (c) => void c.provide('llm', { chat: async () => ({}) }) });
    ctx.plugin({ name: 'consumer-plugin', inject: ['llm'], apply: () => {} });

    const toolsRef = ctx.requireService('tools');
    ctx.on('custom-event', () => {});
    ctx.waterfall('custom-hook', async (arg: any, next: any) => next());

    check(
      '销毁前：服务、工具、事件、中间件都在位',
      ctx.getService('tools') !== undefined &&
        ctx.getService('llm') !== undefined &&
        toolNames(toolsRef).length === 1 &&
        (ctx.root as any)._events.size === 1 &&
        (ctx.root as any)._waterfalls.size === 1,
    );

    await ctx.dispose();

    check('服务引用全部消失', ctx.getService('tools') === undefined && ctx.getService('llm') === undefined);
    check('服务注册表为空', ctx.listServices().length === 0);
    check('工具已全部注销', toolNames(toolsRef).length === 0);
    check('Waterfall 已清空', (ctx.root as any)._waterfalls.size === 0);
    check('事件监听已清空', (ctx.root as any)._events.size === 0);
    check('没有插件停留在 active', ctx.listPlugins().every((p) => p.status !== 'active'));
    check(
      '所有插件进入终态 disposed',
      ctx.listPlugins().every((p) => p.status === 'disposed'),
      JSON.stringify(ctx.listPlugins().map((p) => `${p.name}:${p.status}`)),
    );
  });

  await scenario('10. 清理函数抛错：不中断其他插件，且记录 cleanupError', async () => {
    const ctx = new Context();
    const order: string[] = [];

    ctx.plugin({
      name: 'bad-cleanup',
      apply(c) {
        c.effect(() => {
          order.push('bad-cleanup');
          throw new Error('清理故意失败');
        });
      },
    });
    ctx.plugin({
      name: 'good-cleanup',
      apply(c) {
        c.effect(() => void order.push('good-cleanup'));
      },
    });

    await ctx.dispose();

    check('清理异常未中断其他插件', order.includes('good-cleanup'), JSON.stringify(order));
    check('抛错插件仍进入 disposed', recordOf(ctx, 'bad-cleanup').status === 'disposed');
    check(
      '记录了 cleanupError',
      recordOf(ctx, 'bad-cleanup').cleanupError?.message.includes('故意') === true,
    );
  });

  // ---------- 严格模式 ----------

  await scenario('11. strictPlugins：异常直接抛出给 plugin() 调用方', () => {
    const ctx = new Context(undefined, { strictPlugins: true });

    let thrown: unknown;
    try {
      ctx.plugin({
        name: 'strict-boom',
        apply: () => {
          throw new Error('strict 模式故意失败');
        },
      });
    } catch (err) {
      thrown = err;
    }

    check('异常被抛出到调用方', (thrown as Error)?.message.includes('strict') === true);
    check('状态仍记录为 failed', recordOf(ctx, 'strict-boom').status === 'failed');

    const lenient = new Context();
    let lenientThrown = false;
    try {
      lenient.plugin({
        name: 'lenient-boom',
        apply: () => {
          throw new Error('宽松模式故意失败');
        },
      });
    } catch {
      lenientThrown = true;
    }
    check('默认宽松模式不抛出', !lenientThrown);
    check('默认宽松模式记录为 failed', recordOf(lenient, 'lenient-boom').status === 'failed');
  });

  // ---------- 事务边界：严格模式下的嵌套激活 ----------

  await scenario('12. 等待队列失败不牵连提供方（严格/宽松一致）', () => {
    // 队列中的插件是独立生命周期：消费者失败不会沿 provide() 冒泡回提供方
    const build = (strict: boolean) => {
      const ctx = strict
        ? new Context<SvcOkMap>(undefined, { strictPlugins: true })
        : new Context<SvcOkMap>();
      ctx.plugin({
        name: 'consumer',
        inject: ['svc'],
        apply() {
          throw new Error('消费者激活失败');
        },
      });
      let thrown: unknown;
      try {
        ctx.plugin({ name: 'provider', apply: (c) => void c.provide('svc', { ok: 1 }) });
      } catch (err) {
        thrown = err;
      }
      return { ctx, thrown };
    };

    const strict = build(true);
    check('严格模式下队列失败不冒泡给 plugin() 调用方', strict.thrown === undefined);
    check('消费者状态为 failed', recordOf(strict.ctx, 'consumer').status === 'failed');
    check('提供方保持 active（不被消费者拖垮）', recordOf(strict.ctx, 'provider').status === 'active');
    check('提供方 attempt 仍为 1（未被回滚重试）', recordOf(strict.ctx, 'provider').attempt === 1);
    check('服务未被误撤销', strict.ctx.requireService('svc').ok === 1);
    check('服务注册表恰好一份 svc', strict.ctx.listServices().filter((s) => s.name === 'svc').length === 1);

    strict.ctx.plugin({ name: 'consumer-2', inject: ['svc'], apply: () => {} });
    check('失败后容器仍可继续装配', recordOf(strict.ctx, 'consumer-2').status === 'active');

    // 对照：宽松模式行为完全一致（strictPlugins 只作用于直接 plugin()）
    const lenient = build(false);
    check('宽松模式：提供方同样 active', recordOf(lenient.ctx, 'provider').status === 'active');
    check('宽松模式：消费者同样 failed', recordOf(lenient.ctx, 'consumer').status === 'failed');
    check('宽松模式：服务同样可用', lenient.ctx.requireService('svc').ok === 1);
  });

  await scenario('13. 激活失败后 dispose()：服务与根属性均被清除', async () => {
    const ctx = new Context<SvcOkMap>();
    ctx.plugin({
      name: 'consumer',
      inject: ['svc'],
      apply() {
        throw new Error('依赖插件激活失败');
      },
    });
    ctx.plugin({ name: 'provider', apply: (c) => void c.provide('svc', { ok: 1 }) });

    const namesBefore = ctx.listServices().map((s) => s.name);
    check('前置：svc 已挂载到 root', ctx.getService('svc')?.ok === 1);
    check('前置：存在 failed 插件', ctx.listPlugins().some((p) => p.status === 'failed'));

    await ctx.dispose();

    check('dispose 后 root 上的服务引用消失', ctx.getService('svc') === undefined);
    check('dispose 后服务注册表为空', ctx.listServices().length === 0);
    check(
      '所有曾注册的服务名均无悬空根属性',
      namesBefore.every((n) => rootProp(ctx.root, n) === undefined),
      JSON.stringify(namesBefore),
    );
    check('没有插件停留在 active', ctx.listPlugins().every((p) => p.status !== 'active'));
    check('正常插件进入 disposed', recordOf(ctx, 'provider').status === 'disposed');
    check('failed 插件保持 failed（不被伪装成 disposed）', recordOf(ctx, 'consumer').status === 'failed');
    check('容器进入 disposed 终态', ctx.state === 'disposed');
  });

  // ---------- 异步回滚时序 ----------

  await scenario('14. 异步 Disposer 未完成前不能开始插件重试', async () => {
    const ctx = new Context();
    const events: string[] = [];
    let releaseCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let shouldFail = true;

    ctx.plugin({
      name: 'slow-cleanup',
      apply(c) {
        if (shouldFail) {
          c.effect(async () => {
            await cleanupGate;
            events.push('cleanup-done');
          });
          throw new Error('第一次故意失败');
        }
        events.push('retry-activated');
      },
    });

    const id = recordOf(ctx, 'slow-cleanup').id;
    check('首次激活失败', recordOf(ctx, 'slow-cleanup').status === 'failed');
    check('异步清理尚未完成', !events.includes('cleanup-done'), JSON.stringify(events));

    shouldFail = false;
    const retry = ctx.retryPlugin(id);
    await Promise.resolve();
    await Promise.resolve();
    check(
      'retry 被回滚阻塞，尚未开始新生命周期',
      !events.includes('retry-activated'),
      JSON.stringify(events),
    );

    releaseCleanup();
    await retry;

    check(
      '异步清理先于重试激活完成',
      events.includes('cleanup-done') &&
        events.indexOf('cleanup-done') < events.indexOf('retry-activated'),
      JSON.stringify(events),
    );
    check('重试后状态为 active', recordOf(ctx, 'slow-cleanup').status === 'active');
  });

  // ---------- 根容器终态保护 ----------

  await scenario('15. 容器销毁后进入 disposed 终态，拒绝一切状态变更操作', async () => {
    const ctx = new Context<LateSvcMap>();
    ctx.plugin({ name: 'p', apply: (c) => void c.provide('svc', { v: 1 }) });
    const id = recordOf(ctx, 'p').id;
    check('销毁前状态为 active', ctx.state === 'active');

    await ctx.dispose();
    check('销毁后状态为 disposed', ctx.state === 'disposed');

    let pluginErr: unknown;
    try {
      ctx.plugin({ name: 'late', apply: () => {} });
    } catch (err) {
      pluginErr = err;
    }
    check('plugin() 抛 ContainerDisposedError', pluginErr instanceof ContainerDisposedError);
    check('被拒绝的插件未进入注册表', ctx.listPlugins().every((p) => p.name !== 'late'));

    let provideErr: unknown;
    try {
      ctx.provide('late-svc', {});
    } catch (err) {
      provideErr = err;
    }
    check('provide() 抛 ContainerDisposedError', provideErr instanceof ContainerDisposedError);
    check('被拒绝的服务未挂载', rootProp(ctx.root, 'late-svc') === undefined);
    check('服务注册表仍为空', ctx.listServices().length === 0);

    let retryErr: unknown;
    try {
      await ctx.retryPlugin(id);
    } catch (err) {
      retryErr = err;
    }
    check('retryPlugin() 抛 ContainerDisposedError', retryErr instanceof ContainerDisposedError);

    let unloadErr: unknown;
    try {
      await ctx.unloadPlugin(id);
    } catch (err) {
      unloadErr = err;
    }
    check('unloadPlugin() 抛 ContainerDisposedError', unloadErr instanceof ContainerDisposedError);

    await ctx.dispose();
    check('二次 dispose 幂等，不抛错且状态保持 disposed', ctx.state === 'disposed');
  });

  // ---------- 销毁兜底 ----------

  await scenario('16. 清理函数抛错时，其余服务仍正常回收', async () => {
    const ctx = new Context<CleanupMap>();
    ctx.plugin({ name: 'prov-a', apply: (c) => void c.provide('svc-a', { a: 1 }) });
    ctx.plugin({ name: 'prov-b', apply: (c) => void c.provide('svc-b', { b: 1 }) });
    ctx.plugin({
      name: 'bad-cleanup',
      apply(c) {
        c.provide('svc-c', { c: 1 });
        c.effect(() => {
          throw new Error('清理故意失败');
        });
      },
    });

    const names = ctx.listServices().map((s) => s.name);
    check(
      '前置：三个服务都已挂载到 root',
      names.length === 3 && names.every((n) => rootProp(ctx.root, n) !== undefined),
      JSON.stringify(names),
    );

    await ctx.dispose();

    check('抛错插件自己的服务也被回收', ctx.getService('svc-c') === undefined);
    check(
      '其他插件的服务正常回收',
      ctx.getService('svc-a') === undefined && ctx.getService('svc-b') === undefined,
    );
    check('服务注册表为空', ctx.listServices().length === 0);
    check(
      '无悬空根属性',
      names.every((n) => rootProp(ctx.root, n) === undefined),
      JSON.stringify(names),
    );
    check('抛错插件仍进入 disposed', recordOf(ctx, 'bad-cleanup').status === 'disposed');
    check(
      '记录了 cleanupError',
      recordOf(ctx, 'bad-cleanup').cleanupError?.message.includes('故意') === true,
    );
  });

  // ---------- 等待队列：独立生命周期 ----------

  await scenario('17. 队列逐个处理：前一个成功、后一个失败，互不牵连', () => {
    const ctx = new Context<SvcEmptyMap>(undefined, { strictPlugins: true });
    ctx.plugin({ name: 'ok-consumer', inject: ['svc'], apply: () => {} });
    ctx.plugin({
      name: 'bad-consumer',
      inject: ['svc'],
      apply() {
        throw new Error('第二个消费者失败');
      },
    });
    ctx.plugin({ name: 'provider', apply: (c) => void c.provide('svc', {}) });

    check('前一个消费者激活成功', recordOf(ctx, 'ok-consumer').status === 'active');
    check('后一个消费者为 failed', recordOf(ctx, 'bad-consumer').status === 'failed');
    check('成功者不因同批失败被回滚', recordOf(ctx, 'ok-consumer').status === 'active');
    check('提供方保持 active', recordOf(ctx, 'provider').status === 'active');
    check('失败插件不回队列', ctx.listPlugins().filter((p) => p.status === 'pending').length === 0);
    check('消费者自身已回滚，无残留', ctx.listServices().every((s) => s.name === 'svc'));
  });

  await scenario('18. 失败插件不丢队列：后续服务就绪时其余条目仍能激活', () => {
    const ctx = new Context<WaitQueueMap>();
    ctx.plugin({
      name: 'bad',
      inject: ['svc'],
      apply() {
        throw new Error('故意失败');
      },
    });
    ctx.plugin({ name: 'later', inject: ['svc2'], apply: () => {} });

    ctx.plugin({ name: 'p1', apply: (c) => void c.provide('svc', {}) });
    check('bad 失败为 failed', recordOf(ctx, 'bad').status === 'failed');
    check(
      '依赖未满足的 later 仍留在队列',
      ctx.listPlugins().filter((p) => p.status === 'pending').map((p) => p.name).join(',') === 'later',
      JSON.stringify(ctx.listPlugins().map((p) => `${p.name}:${p.status}`)),
    );

    ctx.plugin({ name: 'p2', apply: (c) => void c.provide('svc2', {}) });
    check('后续服务就绪后 later 成功激活', recordOf(ctx, 'later').status === 'active');
    check('队列已清空', ctx.listPlugins().every((p) => p.status !== 'pending'));
  });

  await scenario('19. 消费者失败后提供方保持 active，服务可正常使用', () => {
    const ctx = new Context<SvcHelloMap>(undefined, { strictPlugins: true });
    ctx.plugin({
      name: 'bad-consumer',
      inject: ['svc'],
      apply() {
        throw new Error('消费者失败');
      },
    });
    ctx.plugin({
      name: 'provider',
      apply(c) {
        c.provide('svc', { hello: () => 'hi' });
      },
    });

    const provider = recordOf(ctx, 'provider');
    check('提供方为 active', provider.status === 'active');
    check('提供方 attempt 仍为 1（未被回滚重试）', provider.attempt === 1, String(provider.attempt));
    check('提供方未记录 error', provider.error === undefined);
    check('服务可真实调用', ctx.requireService('svc').hello() === 'hi');
    check(
      '反向依赖索引未残留失败消费者',
      (ctx.root as any)._dependents.get('svc')?.has(recordOf(ctx, 'bad-consumer').id) !== true,
    );
  });

  // ---------- disposing 状态 ----------

  await scenario('20. disposing 期间 plugin/provide/工具注册/retry/unload 全部被拒绝', async () => {
    const ctx = new Context<DisposingMap>();
    ctx.plugin(ToolsProvider);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.plugin({
      name: 'slow-cleanup',
      apply(c) {
        c.provide('svc', {});
        // 返回 Promise 的 Disposer：销毁会 await 它，从而把容器卡在 disposing
        c.effect(() => gate.then(() => undefined));
      },
    });
    const id = recordOf(ctx, 'slow-cleanup').id;

    const disposing = ctx.dispose();
    await Promise.resolve();
    await Promise.resolve();
    check('状态已切到 disposing', ctx.state === 'disposing', ctx.state);

    const expectRejected = (label: string, fn: () => unknown) => {
      let err: unknown;
      try {
        fn();
      } catch (e) {
        err = e;
      }
      check(`${label} 被拒绝`, err instanceof ContainerDisposedError, (err as Error)?.message);
    };

    expectRejected('plugin()', () => ctx.plugin({ name: 'late', apply: () => {} }));
    expectRejected('provide()', () => ctx.provide('late-svc', {}));
    expectRejected('tools.register()', () =>
      ctx.requireService('tools').register(tool('late-tool'), { ownerId: 'x' }),
    );

    let retryErr: unknown;
    try {
      await ctx.retryPlugin(id);
    } catch (e) {
      retryErr = e;
    }
    check('retryPlugin() 被拒绝', retryErr instanceof ContainerDisposedError);

    let unloadErr: unknown;
    try {
      await ctx.unloadPlugin(id);
    } catch (e) {
      unloadErr = e;
    }
    check('unloadPlugin() 被拒绝', unloadErr instanceof ContainerDisposedError);

    release();
    await disposing;
    check('状态切到 disposed', ctx.state === 'disposed', ctx.state);
  });

  await scenario('21. 并发 dispose() 拿到同一个 Promise，等同一次清理', async () => {
    const ctx = new Context();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let cleanupFinished = false;
    ctx.plugin({
      name: 'slow',
      apply(c) {
        c.effect(async () => {
          await gate;
          cleanupFinished = true;
        });
      },
    });

    const p1 = ctx.dispose();
    const p2 = ctx.dispose();
    check('两次 dispose() 返回同一 Promise 对象', p1 === p2);
    check('清理尚未完成', !cleanupFinished);
    check('此时状态为 disposing', ctx.state === 'disposing', ctx.state);

    release();
    await Promise.all([p1, p2]);
    check('两者同时等到清理完成', cleanupFinished);
    check('最终状态为 disposed', ctx.state === 'disposed');
    check('重复 dispose 仍返回同一 Promise', ctx.dispose() === p1);
  });

  await scenario('22. 销毁期间加入的插件不会残留为 active', async () => {
    const ctx = new Context();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.plugin({
      name: 'slow',
      apply(c) {
        c.effect(() => gate.then(() => undefined));
      },
    });

    const disposing = ctx.dispose();
    await Promise.resolve();

    let err: unknown;
    try {
      ctx.plugin({ name: 'late-plugin', apply: () => {} });
    } catch (e) {
      err = e;
    }
    check('disposing 期间 plugin() 抛错', err instanceof ContainerDisposedError);
    check('被拒绝的插件未进入注册表', ctx.listPlugins().every((p) => p.name !== 'late-plugin'));

    release();
    await disposing;
    check('disposed 后没有 active 插件', ctx.listPlugins().every((p) => p.status !== 'active'));
    check(
      '所有插件处于终态（disposed / failed）',
      ctx.listPlugins().every((p) => p.status === 'disposed' || p.status === 'failed'),
      JSON.stringify(ctx.listPlugins().map((p) => `${p.name}:${p.status}`)),
    );
  });

  await scenario('23. dispose 后注册表/根属性/事件/Waterfall/实例全部为空', async () => {
    const ctx = new Context<MySvcMap>();
    ctx.plugin(ToolsProvider);
    ctx.plugin({ name: 'svc-plugin', apply: (c) => void c.provide('my-svc', { v: 1 }) });
    ctx.plugin({
      name: 'tool-plugin',
      inject: ['tools'],
      apply(c) {
        c.effect(c.tools.register(tool('my-tool'), { ownerId: c.ownerId }));
      },
    });
    ctx.on('custom-event', () => {});
    ctx.waterfall('custom-hook', async (arg: any, next: any) => next());

    const serviceNames = ctx.listServices().map((s) => s.name);
    check(
      '前置：服务、工具、事件、中间件都在位',
      serviceNames.length === 2 &&
        ctx.requireService('tools').getSchemas().length === 1 &&
        (ctx.root as any)._events.size === 1 &&
        (ctx.root as any)._waterfalls.size === 1,
      JSON.stringify(serviceNames),
    );

    await ctx.dispose();

    check('服务注册表为空', ctx.listServices().length === 0);
    check(
      '所有服务根属性已删除',
      serviceNames.every((n) => rootProp(ctx.root, n) === undefined),
      JSON.stringify(serviceNames.map((n) => `${n}=${typeof rootProp(ctx.root, n)}`)),
    );
    check(
      '根上没有服务实例残留',
      ctx.getService('tools') === undefined && ctx.getService('my-svc') === undefined,
    );
    check('事件表为空', (ctx.root as any)._events.size === 0);
    check('Waterfall 为空', (ctx.root as any)._waterfalls.size === 0);
    check('实例表为空', (ctx.root as any)._instances.size === 0);
    check('等待队列为空', (ctx.root as any)._pendingPlugins.length === 0);
    check('后台回滚任务表为空', (ctx.root as any)._pendingCleanups.size === 0);
    check('插件注册表无 active', ctx.listPlugins().every((p) => p.status !== 'active'));
  });

  await scenario('24. async setup：提供方就绪后才激活依赖方', async () => {
    interface AsyncMap {
      asyncSvc: { value: number };
    }

    const ctx = new Context<AsyncMap>();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    ctx.plugin({
      name: 'async-provider',
      async setup(c) {
        events.push('provider-start');
        await gate;
        events.push('provider-service');
        c.provide('asyncSvc', { value: 42 });
        events.push('provider-ready');
      },
    });
    ctx.plugin({
      name: 'async-consumer',
      inject: ['asyncSvc'],
      setup() {
        events.push('consumer-ready');
      },
    });

    check('异步提供方进入 starting', recordOf(ctx, 'async-provider').status === 'starting');
    check('依赖方仍在 pending', recordOf(ctx, 'async-consumer').status === 'pending');

    const starting = ctx.start();
    await Promise.resolve();
    check('setup 已开始但尚未提供依赖', events.includes('provider-start'));
    check('依赖方尚未激活', !events.includes('consumer-ready'));

    release();
    await starting;

    check('异步提供方最终 active', recordOf(ctx, 'async-provider').status === 'active');
    check('依赖方在服务就绪后 active', recordOf(ctx, 'async-consumer').status === 'active');
    check(
      '事件顺序正确',
      events.indexOf('provider-service') < events.indexOf('consumer-ready'),
      JSON.stringify(events),
    );
    check('服务值可正常读取', ctx.requireService('asyncSvc').value === 42);
  });

  await scenario('25. async setup 失败：回滚副作用并由 start() 上报', async () => {
    const ctx = new Context<Record<string, never>>();
    const events: string[] = [];

    ctx.plugin({
      name: 'async-fail',
      async setup(c) {
        c.effect(() => void events.push('cleanup'));
        await Promise.resolve();
        throw new Error('异步初始化失败');
      },
    });

    let thrown: unknown;
    try {
      await ctx.start();
    } catch (err) {
      thrown = err;
    }

    check('start() 抛 PluginStartError', thrown instanceof PluginStartError);
    check('失败插件状态为 failed', recordOf(ctx, 'async-fail').status === 'failed');
    check('错误摘要已记录', recordOf(ctx, 'async-fail').error?.message.includes('异步') === true);
    check('失败副作用已回滚', events.includes('cleanup'));
  });

  await scenario('26. start() 在依赖缺失时拒绝并列出缺失服务', async () => {
    interface MissingMap {
      missing: { ok: boolean };
    }

    const ctx = new Context<MissingMap>();
    ctx.plugin({
      name: 'waiting-plugin',
      inject: ['missing'],
      apply() {},
    });

    let thrown: unknown;
    try {
      await ctx.start();
    } catch (err) {
      thrown = err;
    }

    check('start() 抛 PluginDependencyError', thrown instanceof PluginDependencyError);
    check(
      '错误包含缺失服务',
      thrown instanceof PluginDependencyError && thrown.missingServices.includes('missing'),
      (thrown as Error)?.message,
    );
    check('插件仍保持 pending', recordOf(ctx, 'waiting-plugin').status === 'pending');
  });

  // ---------- 稳定插件 id ----------

  await scenario('27. 稳定插件 id：显式 id 优先 / 回退 name / 匿名带序号', () => {
    const ctx = new Context();
    ctx.plugin({ id: 'stable-id', name: 'display-name', apply() {} });
    ctx.plugin({ name: 'from-name', apply() {} });
    ctx.plugin({ apply() {} });
    ctx.plugin({ apply() {} });

    const ids = ctx.listPlugins().map((p) => p.id);
    check(
      '显式 id 优先于 name',
      recordById(ctx, 'stable-id').name === 'display-name',
      JSON.stringify(ids),
    );
    check('未声明 id 时回退 name', ids.includes('from-name'), JSON.stringify(ids));
    check(
      '只有匿名插件才带序号',
      ids.includes('anonymous-plugin#1') && ids.includes('anonymous-plugin#2'),
      JSON.stringify(ids),
    );
    check(
      '具名插件的 id 里不含序号',
      ids.filter((id) => id.includes('#')).length === 2,
      JSON.stringify(ids),
    );
  });

  await scenario('28. 插件 id 冲突：拒绝注册且不留痕', () => {
    const ctx = new Context();
    ctx.plugin({ id: 'same', name: 'first', apply() {} });
    const before = ctx.listPlugins().length;

    let thrown: unknown;
    try {
      ctx.plugin({ id: 'same', name: 'second', apply() {} });
    } catch (err) {
      thrown = err;
    }

    check('抛 DuplicatePluginError', thrown instanceof DuplicatePluginError);
    check(
      '冲突插件未进入注册表',
      ctx.listPlugins().length === before &&
        ctx.listPlugins().every((p) => p.name !== 'second'),
      JSON.stringify(ctx.listPlugins().map((p) => p.name)),
    );
    check('已有插件不受影响', recordById(ctx, 'same').status === 'active');
  });

  // ---------- protected 保护 ----------

  await scenario('29. protected 插件拒绝 disable / unload，普通插件不受限', async () => {
    const ctx = new Context();
    ctx.plugin({ id: 'guard', name: 'guard', protected: true, apply() {} });
    ctx.plugin({ id: 'normal', name: 'normal', apply() {} });

    check('listPlugins 暴露 protected 标记', recordById(ctx, 'guard').protected === true);
    check('未声明 protected 时默认为 false', recordById(ctx, 'normal').protected === false);

    let disableErr: unknown;
    try {
      await ctx.disablePlugin('guard');
    } catch (err) {
      disableErr = err;
    }
    check('disable protected 抛 ProtectedPluginError', disableErr instanceof ProtectedPluginError);
    check('被拒绝后仍是 active', recordById(ctx, 'guard').status === 'active');

    let unloadErr: unknown;
    try {
      await ctx.unloadPlugin('guard');
    } catch (err) {
      unloadErr = err;
    }
    check('unload protected 抛 ProtectedPluginError', unloadErr instanceof ProtectedPluginError);

    await ctx.disablePlugin('normal');
    check('普通插件可以 disable', recordById(ctx, 'normal').status === 'disposed');
    check('protected 插件未被牵连', recordById(ctx, 'guard').status === 'active');
  });

  // ---------- enable / disable 闭环 ----------

  await scenario('30. enable/disable：停用后可再启用，依赖与状态双重守卫', async () => {
    interface EnableMap {
      dep: { v: number };
    }

    const ctx = new Context<EnableMap>();
    ctx.plugin({ id: 'provider', name: 'provider', apply: (c) => void c.provide('dep', { v: 1 }) });
    ctx.plugin({ id: 'consumer', name: 'consumer', inject: ['dep'], apply() {} });
    await ctx.start();

    check('前置：提供方与消费方都 active', recordById(ctx, 'consumer').status === 'active');

    await ctx.disablePlugin('consumer');
    check('consumer 停用后为 disposed', recordById(ctx, 'consumer').status === 'disposed');

    await ctx.enablePlugin('consumer');
    check('enable 后回到 active', recordById(ctx, 'consumer').status === 'active');
    check('attempt 递增为 2', recordById(ctx, 'consumer').attempt === 2);

    let inUse: unknown;
    try {
      await ctx.disablePlugin('provider');
    } catch (err) {
      inUse = err;
    }
    check('有活跃依赖时 disable 被拒绝', inUse instanceof ServiceInUseError);
    check('被拒绝后 provider 仍 active', recordById(ctx, 'provider').status === 'active');

    let repeatErr: unknown;
    try {
      await ctx.enablePlugin('provider');
    } catch (err) {
      repeatErr = err;
    }
    check('active 插件不能重复 enable', repeatErr instanceof InvalidPluginStateError);

    await ctx.disablePlugin('consumer');
    await ctx.disablePlugin('provider');
    let depErr: unknown;
    try {
      await ctx.enablePlugin('consumer');
    } catch (err) {
      depErr = err;
    }
    check('依赖缺失时 enable 抛 PluginDependencyError', depErr instanceof PluginDependencyError);
    check(
      '失败后 consumer 状态未被改变',
      recordById(ctx, 'consumer').status === 'disposed',
      recordById(ctx, 'consumer').status,
    );

    // 提供方先回来，consumer 才能启用
    await ctx.enablePlugin('provider');
    await ctx.enablePlugin('consumer');
    check('提供方就绪后 consumer 可启用', recordById(ctx, 'consumer').status === 'active');
  });

  // ---------- 生命周期事件 ----------

  await scenario('31. 生命周期事件：activated / failed / disposed / state-changed', async () => {
    interface EventMap {
      dep: { v: number };
    }

    const ctx = new Context<EventMap>();
    const seen: { event: string; id: string; status: string; from?: string; reason?: string }[] = [];
    for (const name of [
      'plugin:activated',
      'plugin:failed',
      'plugin:disposed',
      'plugin:state-changed',
    ]) {
      ctx.on(name, (payload: any) => {
        seen.push({
          event: name,
          id: payload.id,
          status: payload.status,
          from: payload.from,
          reason: payload.reason,
        });
      });
    }

    ctx.plugin({ id: 'p1', name: 'p1', apply: (c) => void c.provide('dep', { v: 1 }) });
    ctx.plugin({ id: 'p2', name: 'p2', apply() {} });
    await ctx.start();

    check(
      '激活发出 plugin:activated',
      seen.some((e) => e.event === 'plugin:activated' && e.id === 'p1'),
    );
    check(
      '状态事件带 from → to（pending → activating）',
      seen.some(
        (e) =>
          e.event === 'plugin:state-changed' &&
          e.id === 'p1' &&
          e.from === 'pending' &&
          e.status === 'activating',
      ),
      JSON.stringify(seen.filter((e) => e.id === 'p1')),
    );

    await ctx.disablePlugin('p1');
    check(
      '停用发出 plugin:disposed（reason=disable）',
      seen.some((e) => e.event === 'plugin:disposed' && e.id === 'p1' && e.reason === 'disable'),
    );

    ctx.plugin({
      id: 'boom',
      name: 'boom',
      apply() {
        throw new Error('故意失败');
      },
    });
    check(
      '失败发出 plugin:failed',
      seen.some((e) => e.event === 'plugin:failed' && e.id === 'boom'),
      JSON.stringify(seen.filter((e) => e.id === 'boom')),
    );

    // 容器销毁：仍是 active 的 p2 会被强制收尾，事件要能发出来
    await ctx.dispose();
    check(
      '容器销毁发出 plugin:disposed（reason=container-dispose）',
      seen.some(
        (e) => e.event === 'plugin:disposed' && e.id === 'p2' && e.reason === 'container-dispose',
      ),
      JSON.stringify(seen.filter((e) => e.event === 'plugin:disposed')),
    );
  });

  await scenario('32. 按 id 操作不存在的插件抛 PluginNotFoundError', async () => {
    const ctx = new Context();

    const cases: [string, () => Promise<void>][] = [
      ['enablePlugin', () => ctx.enablePlugin('nope')],
      ['disablePlugin', () => ctx.disablePlugin('nope')],
      ['retryPlugin', () => ctx.retryPlugin('nope')],
      ['unloadPlugin', () => ctx.unloadPlugin('nope')],
    ];

    for (const [label, run] of cases) {
      let thrown: unknown;
      try {
        await run();
      } catch (err) {
        thrown = err;
      }
      check(`${label} 抛 PluginNotFoundError`, thrown instanceof PluginNotFoundError, (thrown as Error)?.message);
    }
  });

  await scenario('33. onRoot 订阅根事件，监听器错误相互隔离', async () => {
    const ctx = new Context();
    const calls: string[] = [];

    ctx.onRoot('custom:event', () => {
      calls.push('first');
      throw new Error('listener failed');
    });
    ctx.onRoot('custom:event', () => {
      calls.push('second');
    });

    await ctx.emit('custom:event');

    check('第一个监听器已执行', calls.includes('first'), JSON.stringify(calls));
    check('第二个监听器未被前一个错误阻断', calls.includes('second'), JSON.stringify(calls));
    await ctx.dispose();
  });

  await scenario('34. PluginInventoryService 返回插件、服务与工具归属', async () => {
    const ctx = new Context<LatticeCoreServiceMap>();
    ctx.plugin(PluginManagerPlugin);
    ctx.plugin(ToolsProvider);
    ctx.plugin({
      id: 'inventory-tool-owner',
      inject: ['tools'],
      apply(c) {
        c.effect(c.tools.register(tool('inventory-tool'), { ownerId: c.ownerId }));
      },
    });
    await ctx.start();

    const inventory = ctx.requireService('pluginInventory');
    const managerView = inventory.get('plugin-manager');
    const toolsView = inventory.get('tools-service');
    const ownerView = inventory.get('inventory-tool-owner');

    check('inventory 能按稳定 id 查询插件', managerView?.name === 'plugin-manager');
    check('inventory 标记 protected 插件', managerView?.protected === true);
    check(
      'inventory 能计算插件提供的服务',
      managerView?.provides.includes('pluginInventory') === true &&
        managerView?.provides.includes('pluginManager') === true,
      JSON.stringify(managerView?.provides),
    );
    check('inventory 能计算工具归属', ownerView?.tools.includes('inventory-tool') === true);
    check(
      'inventory snapshot 带生成时间',
      inventory.snapshot().plugins.length >= 3 &&
        inventory.snapshot().generatedAt > 0,
    );
    await ctx.dispose();
  });

  await scenario('35. PluginManagerService 支持 disable / enable / restart', async () => {
    const ctx = new Context<LatticeCoreServiceMap>();
    ctx.plugin(PluginManagerPlugin);
    ctx.plugin({ id: 'managed-plugin', apply() {} });
    await ctx.start();

    const manager = ctx.requireService('pluginManager');
    const inventory = ctx.requireService('pluginInventory');

    await manager.disable('managed-plugin');
    check('manager.disable 后为 disposed', recordById(ctx, 'managed-plugin').status === 'disposed');

    await manager.enable('managed-plugin');
    check('manager.enable 后为 active', recordById(ctx, 'managed-plugin').status === 'active');

    await manager.restart('managed-plugin');
    check('manager.restart 后为 active', recordById(ctx, 'managed-plugin').status === 'active');
    check('restart 递增 attempt', recordById(ctx, 'managed-plugin').attempt >= 3);
    check('protected 插件不允许运行时 disable', inventory.get('plugin-manager')?.runtimeDisableAllowed === false);
    await ctx.dispose();
  });
}

// ==========================================
// 4. 插件本体
// ==========================================

export const SCENARIO_TITLES = [
  '1. 工具重名：默认拒绝，显式 replace 才允许',
  '2. 校验失败时不触碰内部状态（注册原子化）',
  '3. Disposer 幂等：旧句柄不会误删新注册的工具',
  '4. 插件注册工具后初始化失败 → 工具自动回滚 + 状态 failed',
  '5. 插件服务重名 → DuplicateServiceError 且不覆盖已有服务',
  '6. failed → retryPlugin → active',
  '7. 服务提供者卸载：有活跃依赖时拒绝，依赖先卸载后引用消失',
  '8. 根容器销毁：依赖方先于提供方被清理',
  '9. dispose() 后服务/工具/事件/Waterfall/插件状态全部清理',
  '10. 清理函数抛错：不中断其他插件，且记录 cleanupError',
  '11. strictPlugins：异常直接抛出给 plugin() 调用方',
  '12. 等待队列失败不牵连提供方（严格/宽松一致）',
  '13. 激活失败后 dispose()：服务与根属性均被清除',
  '14. 异步 Disposer 未完成前不能开始插件重试',
  '15. 容器销毁后进入 disposed 终态，拒绝一切状态变更操作',
  '16. 清理函数抛错时，其余服务仍正常回收',
  '17. 队列逐个处理：前一个成功、后一个失败，互不牵连',
  '18. 失败插件不丢队列：后续服务就绪时其余条目仍能激活',
  '19. 消费者失败后提供方保持 active，服务可正常使用',
  '20. disposing 期间 plugin/provide/工具注册/retry/unload 全部被拒绝',
  '21. 并发 dispose() 拿到同一个 Promise，等同一次清理',
  '22. 销毁期间加入的插件不会残留为 active',
  '23. dispose 后注册表/根属性/事件/Waterfall/实例全部为空',
  '24. async setup：提供方就绪后才激活依赖方',
  '25. async setup 失败：回滚副作用并由 start() 上报',
  '26. start() 在依赖缺失时拒绝并列出缺失服务',
  '27. 稳定插件 id：显式 id 优先 / 回退 name / 匿名带序号',
  '28. 插件 id 冲突：拒绝注册且不留痕',
  '29. protected 插件拒绝 disable / unload，普通插件不受限',
  '30. enable/disable：停用后可再启用，依赖与状态双重守卫',
  '31. 生命周期事件：activated / failed / disposed / state-changed',
  '32. 按 id 操作不存在的插件抛 PluginNotFoundError',
  '33. onRoot 订阅根事件，监听器错误相互隔离',
  '34. PluginInventoryService 返回插件、服务与工具归属',
  '35. PluginManagerService 支持 disable / enable / restart',
];

/**
 * 自检插件：挂载后**不自动执行**，只把 verify 服务提供出去。
 *
 * 每个场景都在自己的 `new Context()` 上运行，因此不会改动宿主容器的任何状态。
 */
export const VerifyPlugin = definePlugin<LatticeCoreServiceMap>()({
  id: 'verify-plugin',
  name: 'verify-plugin',
  version: '0.0.1',
  layer: 'system',
  apply(ctx) {
    const verify: VerifyService = {
      async run(opts: VerifyRunOptions = {}): Promise<VerifyReport> {
        if (activeRun) {
          throw new Error('验证已在运行中：verify 服务同一时刻只支持一次 run()');
        }
        const run: ActiveRun = {
          log: opts.log !== false,
          passed: 0,
          failures: [],
          results: [],
          current: { title: '', passed: 0, failed: 0 },
        };
        activeRun = run;
        try {
          await runAllScenarios();
        } finally {
          activeRun = null;
        }
        return {
          passed: run.passed,
          failed: run.failures.length,
          failures: run.failures,
          scenarios: run.results,
        };
      },
      listScenarios() {
        return [...SCENARIO_TITLES];
      },
    };

    ctx.provide('verify', verify);
  },
});

// ==========================================
// 5. CLI 入口（argv 守卫）
// ==========================================

/**
 * 以本文件为入口直接执行时的 CLI 职责：
 * 装配容器 → 挂载自检插件 → 触发一次 run() → 把报告翻译成进程退出码。
 *
 * 插件本身不该决定进程退出码，所以这段逻辑只在「本文件就是入口」时生效；
 * 被 main.ts / web-server.ts 通过 plugins/index.ts 间接引入时不会触发。
 */
async function runAsCli(): Promise<void> {
  const ctx = new Context<LatticeCoreServiceMap>();
  ctx.plugin(VerifyPlugin);
  await ctx.start();

  const report = await ctx.requireService('verify').run();

  console.log(`\n${'═'.repeat(60)}`);
  if (report.failed === 0) {
    console.log(`✅ 全部通过：${report.passed} 项断言`);
    process.exit(0);
  }
  console.log(`❌ 失败 ${report.failed} 项 / 通过 ${report.passed} 项`);
  for (const failure of report.failures) {
    console.log(`   - [${failure.scenario}] ${failure.assertion}`);
  }
  process.exit(1);
}

const ENTRY = String(process.argv[1] ?? '').replace(/\\/g, '/');
if (ENTRY.endsWith('plugins/verify/index.ts') || ENTRY.endsWith('plugins/verify/index.js')) {
  runAsCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
