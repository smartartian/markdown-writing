// Lattice kernel

export type Disposer = () => void | Promise<void>;
export type MaybePromise<T> = T | Promise<T>;
export type NextFn<T> = () => Promise<T>;
export type WaterfallHandler<T = any> = (arg: T, next: NextFn<T>) => Promise<T>;

/** 插件层级：system 为平台基础设施（宿主层），business 为 Agent 领域业务 */
export type PluginLayer = 'system' | 'business';

/** 插件生命周期状态机：pending → activating → starting → active → disposing → disposed */
export type PluginStatus =
  | 'pending'
  | 'activating'
  | 'starting'
  | 'active'
  | 'disposing'
  | 'disposed'
  | 'failed';

/** 可序列化的错误摘要，供状态接口与 UI 直接消费 */
export interface PluginError {
  code?: string;
  message: string;
  stack?: string;
  at: number;
}

// ---------------------------------------------------------------------------
// 类型化服务系统
//
// 内核只认识「服务」这个抽象：`ServiceMap` 是「服务名 -> 服务类型」的映射，
// 由应用在 contracts/ 里声明（如 LatticeCoreServiceMap），内核不导入任何业务契约。
// ---------------------------------------------------------------------------

/** 服务表的最小约束；使用 object 以兼容 interface 定义。 */
export type ServiceMap = object;

/** 未显式提供服务表时的宽松默认值，保留测试和原型阶段的任意服务名。 */
export type DefaultServiceMap = Record<string, any>;

/** 服务名：服务表的键，编译期受约束 */
export type ServiceName<S extends ServiceMap> = Extract<keyof S, string>;

/** 取某个服务名对应的服务类型 */
export type ServiceOf<S extends ServiceMap, K extends ServiceName<S>> = S[K];

/** 由 inject 声明的依赖推导出的属性袋：inject: ['tools'] => { readonly tools: ToolService } */
export type InjectedServices<S extends ServiceMap, D extends ServiceName<S>> = {
  readonly [K in D]: S[K];
};

/** 插件 apply() / setup() 拿到的上下文：内核能力 + 由 inject 推导出的服务属性 */
export type PluginContext<S extends ServiceMap, D extends ServiceName<S>> = Context<S> &
  InjectedServices<S, D>;

/** provide() 的可选元数据，为后续服务版本与作用域兼容性检查预留 */
export interface ProvideServiceOptions {
  /** 服务版本，预留给后续兼容性检查 */
  version?: string;
  /** 服务作用域，默认 root */
  scope?: 'root' | 'plugin';
}

interface PluginBase<
  S extends ServiceMap = ServiceMap,
  D extends ServiceName<S> = never,
  C = unknown,
> {
  /**
   * 稳定插件 id：控制台按 id 寻址插件。未声明时回退到 `name`；
   * `name` 也未声明时生成 `anonymous-plugin#N`（仅匿名插件才带序号）。
   */
  id?: string;
  name?: string;
  /** 插件版本，供控制台展示；不影响生命周期 */
  version?: string;
  /**
   * 系统保护标记：控制面自身（plugin-manager / console-api / web-server / telemetry）
   * 必须置为 true，否则控制台可以把自己关掉。protected 插件拒绝 disable / unload。
   */
  protected?: boolean;
  inject?: readonly D[]; // 声明依赖的服务名称（借鉴 Cordis 核心机制）；未声明时为 never
  layer?: PluginLayer; // 声明插件层级，未声明时视为 business
}

interface SyncPlugin<
  S extends ServiceMap = ServiceMap,
  D extends ServiceName<S> = never,
  C = unknown,
> extends PluginBase<S, D, C> {
  // 刻意用「方法」而不是函数属性：方法的参数按双变（bivariant）比较，
  // 这样按应用服务表定义的插件（Plugin<LatticeCoreServiceMap>）能被测试里的局部服务表容器装配。
  apply(ctx: PluginContext<S, D>, config?: C): void | Disposer;
  setup?: never;
}

interface AsyncPlugin<
  S extends ServiceMap = ServiceMap,
  D extends ServiceName<S> = never,
  C = unknown,
> extends PluginBase<S, D, C> {
  /** 异步初始化入口。调用 ctx.provide() 后若继续 await，请在 await 完成后再提供服务。 */
  setup(ctx: PluginContext<S, D>, config?: C): MaybePromise<void | Disposer>;
  apply?: never;
}

export type Plugin<
  S extends ServiceMap = ServiceMap,
  D extends ServiceName<S> = never,
  C = unknown,
> = SyncPlugin<S, D, C> | AsyncPlugin<S, D, C>;

/**
 * 类型化插件定义工厂。用法：
 *
 * ```ts
 * export const CalculatorToolPlugin = definePlugin<LatticeCoreServiceMap>()({
 *   name: 'calculator-tool',
 *   inject: ['tools'],
 *   apply(ctx) {
 *     ctx.tools.register(...);   // ctx.tools 自动推导为 ToolService，无需断言
 *   },
 * });
 * ```
 */
export function definePlugin<S extends ServiceMap>() {
  return <D extends ServiceName<S> = never, C = unknown>(
    plugin: Plugin<S, D, C>,
  ): Plugin<S, D, C> => plugin;
}

/** 插件注册表条目：状态机 + 错误摘要 + 时间戳，始终可序列化 */
export interface PluginRecord {
  /** 稳定插件 id：显式 `id` 优先，其次 `name`，匿名插件为 `anonymous-plugin#N` */
  id: string;
  name: string;
  /** 插件版本，来自插件定义 */
  version?: string;
  /** 系统保护标记：true 时拒绝 disable / unload */
  protected: boolean;
  inject: string[];
  layer: PluginLayer;
  status: PluginStatus;
  /** 激活尝试次数，retryPlugin 会使其递增 */
  attempt: number;
  error?: PluginError;
  /** 清理函数自身抛错时的记录；不影响插件进入 disposed */
  cleanupError?: PluginError;
  activatedAt?: number;
  disposedAt?: number;
}

/** plugin:disposed 的触发原因 */
export type PluginDisposeReason = 'unload' | 'disable' | 'container-dispose';

/**
 * 插件生命周期事件负载（`plugin:activated` / `plugin:disposed` /
 * `plugin:state-changed` / `plugin:failed` 共用同一形状），始终可序列化。
 */
export interface PluginEventPayload {
  id: string;
  name: string;
  layer: PluginLayer;
  /** 事件发生**之后**的状态 */
  status: PluginStatus;
  /** 仅 plugin:state-changed：变更前的状态 */
  from?: PluginStatus;
  /** 仅 plugin:disposed：触发原因 */
  reason?: PluginDisposeReason;
  /** 仅 plugin:failed */
  error?: PluginError;
  at: number;
}

/** 服务注册表条目：记录提供者，使注销可校验归属并保持幂等 */
export interface ServiceEntry<T = unknown> {
  name: string;
  value: T;
  ownerId: string;
  state: 'active' | 'disposing';
  providedAt: number;
  /** 服务版本，预留给后续兼容性检查 */
  version?: string;
  /** 服务作用域 */
  scope: 'root' | 'plugin';
}

export interface ContextOptions {
  /** 插件同步初始化抛错时是否直接向 plugin() 调用方抛出。默认 false。 */
  strictPlugins?: boolean;
}

/** 同一时刻不允许两个活跃插件提供同名服务 */
export class DuplicateServiceError extends Error {
  constructor(
    public serviceName: string,
    public existingOwner: string,
    public incomingOwner: string,
  ) {
    super(`服务 "${serviceName}" 已由插件 "${existingOwner}" 提供，拒绝 "${incomingOwner}" 重复提供`);
    this.name = 'DuplicateServiceError';
  }
}

/** 动态卸载服务提供者时，若其服务仍被活跃插件依赖则拒绝卸载 */
export class ServiceInUseError extends Error {
  constructor(
    public serviceName: string,
    public dependents: string[],
  ) {
    super(`服务 "${serviceName}" 仍被活跃插件依赖: ${dependents.join(', ')}，拒绝卸载其提供者`);
    this.name = 'ServiceInUseError';
  }
}

/** 根容器状态机：active → disposing → disposed，disposed 不可恢复 */
export type ContainerState = 'active' | 'disposing' | 'disposed';

/** 根容器正在销毁或已销毁，拒绝任何会改变容器状态的操作 */
export class ContainerDisposedError extends Error {
  constructor(
    public operation: string,
    public containerState: ContainerState = 'disposed',
  ) {
    super(`根容器已处于 ${containerState} 状态，拒绝执行 ${operation}()`);
    this.name = 'ContainerDisposedError';
  }
}

/** start() 时仍有插件依赖未满足 */
export class PluginDependencyError extends Error {
  constructor(public pluginNames: string[], public missingServices: string[]) {
    super(`插件依赖未满足: ${pluginNames.join(', ')}；缺少服务: ${missingServices.join(', ')}`);
    this.name = 'PluginDependencyError';
  }
}

/** start() 时存在激活失败的插件 */
export class PluginStartError extends Error {
  constructor(public failures: PluginRecord[]) {
    super(`插件启动失败: ${failures.map((item) => item.name).join(', ')}`);
    this.name = 'PluginStartError';
  }
}

/** 按 id 找不到插件 → 控制台映射 404 */
export class PluginNotFoundError extends Error {
  constructor(public pluginId: string) {
    super(`插件不存在: ${pluginId}`);
    this.name = 'PluginNotFoundError';
  }
}

/** 插件当前状态不允许该生命周期操作 → 控制台映射 409 */
export class InvalidPluginStateError extends Error {
  constructor(
    public pluginId: string,
    public status: PluginStatus,
    public operation: string,
  ) {
    super(`插件 "${pluginId}" 当前状态为 ${status}，拒绝执行 ${operation}()`);
    this.name = 'InvalidPluginStateError';
  }
}

/** 受保护的系统插件拒绝该操作 → 控制台映射 423 */
export class ProtectedPluginError extends Error {
  constructor(
    public pluginId: string,
    public operation: string,
  ) {
    super(`插件 "${pluginId}" 是受保护的系统插件，拒绝执行 ${operation}()`);
    this.name = 'ProtectedPluginError';
  }
}

/** 同一容器内插件 id 冲突：id 是控制台的寻址主键，不允许静默去重 */
export class DuplicatePluginError extends Error {
  constructor(public pluginId: string) {
    super(`插件 id "${pluginId}" 已存在，拒绝重复注册（id 是控制台寻址主键）`);
    this.name = 'DuplicatePluginError';
  }
}

/** 已激活插件的运行时实例（不对外暴露，故不进入 PluginRecord） */
interface PluginInstance<S extends ServiceMap = ServiceMap> {
  plugin: ErasedPlugin;
  config?: any;
  record: PluginRecord;
  subCtx: Context<S>;
}

/**
 * 内部擦除型插件引用。
 *
 * 容器的内部结构**不应该**随服务表泛型变化：否则 `Context<{tools}>` 与
 * `Context<LatticeCoreServiceMap>` 会因为私有字段类型不同而互相不可赋值，
 * 导致「同一份插件实现无法装配到服务表更窄的容器」。
 *
 * 类型安全由 `plugin()` / `provide()` 的**公开签名**保证；内部存储只关心行为。
 */
type ErasedPlugin = Plugin<any, any, any>;

function toPluginError(err: unknown): PluginError {
  if (err instanceof Error) {
    return { code: err.name, message: err.message, stack: err.stack, at: Date.now() };
  }
  return { message: String(err), at: Date.now() };
}

/**
 * 上下文容器。
 *
 * 泛型参数 `S` 是「服务名 -> 服务类型」映射（见 `ServiceMap`），
 * 决定 `provide()` / `getService()` / `requireService()` 的名称与类型约束。
 * 默认 `ServiceMap`（`string` 名称 + `unknown` 值），因此测试可以用任意自定义服务表。
 *
 * 注意：类上**没有** `[key: string]: any` 索引签名。`ctx.tools` 这类动态属性访问
 * 只由 Proxy 在运行时提供，类型层面则通过 `PluginContext` 的 `inject` 推导获得。
 */
export class Context<S extends ServiceMap = DefaultServiceMap> {
  private _events = new Map<string, Set<Function>>();
  private _waterfalls = new Map<string, WaterfallHandler[]>();
  private _disposers: Disposer[] = [];
  private _pendingPlugins: { plugin: ErasedPlugin; config?: any; record: PluginRecord }[] = [];

  // ---- 以下字段只在根上下文上有意义 ----
  private _pluginRecords = new Map<string, PluginRecord>();
  /** 插件定义，保留给 retryPlugin 使用（PluginRecord 需保持可序列化，故分开存） */
  private _pluginDefs = new Map<string, { plugin: ErasedPlugin; config?: any }>();
  private _instances = new Map<string, PluginInstance<any>>();
  /** 独立服务注册表，不再只依赖 root[name] 属性（键擦除为 string，避免容器泛型互相不可赋值） */
  private _services = new Map<string, ServiceEntry>();
  /** 反向依赖索引：服务名 -> 依赖它的活跃插件 id 集合 */
  private _dependents = new Map<string, Set<string>>();
  /** 激活失败后的后台异步回滚任务：插件 id -> 等待其彻底清理完成的 Promise */
  private _pendingCleanups = new Map<string, Promise<void>>();
  /** 正在执行异步 setup 的插件：插件 id -> 激活 Promise */
  private _activations = new Map<string, Promise<void>>();
  private _containerState: ContainerState = 'active';
  /** 销毁过程的共享 Promise：并发 dispose() 拿到同一个对象，等的是同一次清理 */
  private _disposePromise?: Promise<void>;
  /** start() 过程的共享 Promise */
  private _startPromise?: Promise<void>;
  private _seq = 0;
  private _ownerId?: string;
  private _options: ContextOptions = {};

  get root(): Context<S> {
    let curr: Context<S> = this;
    while (curr.parent) curr = curr.parent;
    return curr;
  }

  /** 当前上下文所属插件的 id；根上下文为 'root' */
  get ownerId(): string {
    return this._ownerId ?? 'root';
  }

  /** 根容器状态：'active' / 'disposing' / 'disposed' */
  get state(): ContainerState {
    return this.root._containerState;
  }

  /** 只有 active 状态允许改变容器状态；disposing 与 disposed 一律拒绝 */
  private _assertUsable(operation: string) {
    const state = this.root._containerState;
    if (state !== 'active') throw new ContainerDisposedError(operation, state);
  }

  constructor(
    public parent?: Context<S>,
    options?: ContextOptions,
  ) {
    if (options) this._options = options;
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (target.parent) return (target.parent as any)[prop];
        return undefined;
      },
    });
  }

  // ==========================================
  // 服务注册与发现
  // ==========================================

  /**
   * 提供服务：写入独立注册表并挂载到根 Context，同时把撤销函数登记到**调用者**的子上下文。
   * 返回幂等 Disposer，可安全重复调用。
   *
   * 顺序很关键：**先登记并绑定撤销函数，再广播 + 唤醒等待队列**。
   * `_checkPendingPlugins()` 会就地激活等待中的插件，严格模式下它们抛出的异常会沿着
   * `provide() → apply() → _activatePlugin()` 冒泡回当前提供方；若撤销函数此时还没登记，
   * 提供方回滚就无从撤销刚注册的服务，导致「提供方已 failed 但 root.svc 仍存在」的服务泄漏。
   */
  provide<K extends ServiceName<S>>(
    name: K,
    value: S[K],
    options: ProvideServiceOptions = {},
  ): Disposer {
    this._assertUsable('provide');
    const root = this.root;

    // 1. 登记注册表 + 挂载根属性 + 生成幂等撤销函数
    const disposer = root._registerService(name, value, this.ownerId, options);
    // 2. 立刻绑到调用者的子上下文，使后续任何异常都能回滚掉这个服务
    this.effect(disposer);
    // 3. 再广播并唤醒等待队列
    root._broadcastServiceReady(name);

    return disposer;
  }

  /** 读取服务；未就绪时返回 undefined。用于「可选服务」 */
  getService<K extends ServiceName<S>>(name: K): S[K] | undefined {
    const entry = this.root._services.get(name);
    if (!entry || entry.state !== 'active') return undefined;
    return entry.value as S[K];
  }

  /** 读取服务；未就绪时抛错。普通入口优先用它，避免依赖动态属性 */
  requireService<K extends ServiceName<S>>(name: K): S[K] {
    const service = this.getService(name);
    if (service === undefined) {
      throw new Error(`服务未就绪: ${String(name)}`);
    }
    return service;
  }

  /** 已注册服务的只读快照 */
  listServices(): ServiceEntry[] {
    return [...this.root._services.values()].map((e) => ({ ...e }));
  }

  private _registerService<K extends ServiceName<S>>(
    name: K,
    value: S[K],
    ownerId: string,
    options: ProvideServiceOptions,
  ): Disposer {
    const existing = this._services.get(name);
    if (existing && existing.state === 'active' && existing.ownerId !== ownerId) {
      throw new DuplicateServiceError(String(name), existing.ownerId, ownerId);
    }

    const entry: ServiceEntry = {
      name: String(name),
      value,
      ownerId,
      state: 'active',
      providedAt: Date.now(),
      version: options.version,
      scope: options.scope ?? 'root',
    };
    this._services.set(name, entry);
    // 挂载根属性仅为运行时兼容（ctx.tools 这类访问），类型系统不依赖它
    this._setRootProp(name, value);

    // 幂等：只在注册表里仍是自己时才删除，避免旧插件的 Disposer 误删新插件提供的服务
    return () => {
      const current = this._services.get(name);
      if (current !== entry) return;
      if (current.state === 'disposing') return;
      current.state = 'disposing';
      this._services.delete(name);
      if (this._getRootProp(name) === value) this._deleteRootProp(name);
      this.emit(`service:${String(name)}:disposed`);
    };
  }

  /** 动态读写根属性：Proxy 的运行时兼容通道，类型系统不依赖它 */
  private _setRootProp(name: string, value: unknown) {
    (this as unknown as Record<string, unknown>)[name] = value;
  }

  private _getRootProp(name: string): unknown {
    return (this as unknown as Record<string, unknown>)[name];
  }

  private _deleteRootProp(name: string) {
    delete (this as unknown as Record<string, unknown>)[name];
  }

  private _broadcastServiceReady(name: ServiceName<S>) {
    this.emit(`service:${String(name)}`);
    this._checkPendingPlugins();
  }

  private _activeDependentsOf(serviceName: string, excludeId?: string): string[] {
    const ids = this._dependents.get(serviceName);
    if (!ids) return [];
    return [...ids].filter(
      (id) => id !== excludeId && this._pluginRecords.get(id)?.status === 'active',
    );
  }

  // ==========================================
  // 插件生命周期
  // ==========================================

  /**
   * 加载插件：声明的 inject 依赖满足则激活，否则排队等待就绪。
   *
   * `D` 由 `plugin.inject` 推导（如 `inject: ['tools']` → `D = 'tools'`），
   * 因此用 `definePlugin<LatticeCoreServiceMap>()` 定义的插件天然获得类型化的 `ctx.tools`。
   */
  plugin<D extends ServiceName<S>, C = unknown>(plugin: Plugin<S, D, C>, config?: C): this {
    const root = this.root;
    root._assertUsable('plugin');
    const erased = plugin as unknown as ErasedPlugin;
    const record = root._createRecord(erased);
    // 在写入任何状态之前先做 id 冲突检查，保证失败不留痕
    root._assertPluginIdAvailable(record.id);
    root._pluginRecords.set(record.id, record);
    root._pluginDefs.set(record.id, { plugin: erased, config });

    if (root._isInjectSatisfied(plugin.inject)) {
      // 直接加载：严格模式下异常抛回调用方
      root._activatePlugin(erased, config, record, root.strictPlugins);
    } else {
      root._pendingPlugins.push({ plugin: erased, config, record });
    }
    return this;
  }

  /**
   * 等待所有可激活插件完成初始化。
   *
   * - 同步插件在 `plugin()` 阶段即可进入 active；
   * - 异步插件会先进入 starting，直到 setup() 完成；
   * - 依赖未满足或激活失败的插件会让 start() 拒绝，避免宿主在未就绪时开放能力。
   */
  start(): Promise<void> {
    const root = this.root;
    root._assertUsable('start');
    if (root._startPromise) return root._startPromise;

    root._startPromise = (async () => {
      let iterations = 0;

      while (root._activations.size || root._pendingPlugins.length) {
        if (++iterations > 1000) {
          throw new Error('插件启动循环超过 1000 次，可能存在循环依赖');
        }

        root._checkPendingPlugins();
        const activations = [...root._activations.values()];
        if (activations.length === 0) break;
        await Promise.allSettled(activations);
      }

      root._checkPendingPlugins();

      if (root._pendingPlugins.length) {
        const missing = new Set<string>();
        for (const item of root._pendingPlugins) {
          for (const dep of item.plugin.inject ?? []) {
            if (root._services.get(dep)?.state !== 'active') missing.add(String(dep));
          }
        }
        throw new PluginDependencyError(
          root._pendingPlugins.map((item) => item.record.name),
          [...missing],
        );
      }

      const failures = [...root._pluginRecords.values()].filter(
        (record) => record.status === 'failed',
      );
      if (failures.length) throw new PluginStartError(failures);
    })().finally(() => {
      root._startPromise = undefined;
    });

    return root._startPromise;
  }

  /** start() 的语义别名，便于宿主表达“等待系统就绪”。 */
  ready(): Promise<void> {
    return this.start();
  }

  /** 插件注册表快照：可序列化，包含状态机与错误摘要 */
  listPlugins(): PluginRecord[] {
    return [...this.root._pluginRecords.values()].map((r) => ({
      ...r,
      inject: [...r.inject],
      error: r.error ? { ...r.error } : undefined,
      cleanupError: r.cleanupError ? { ...r.cleanupError } : undefined,
    }));
  }

  /**
   * 重新激活一个 `failed` / `disposed` 插件；成功后状态回到 active。
   *
   * 与 `enablePlugin()` 的区别只在状态守卫：retry 沿用历史语义（除
   * `activating` / `starting` / `disposing` 外都接受），enable 则更严格。
   */
  async retryPlugin(id: string): Promise<void> {
    const root = this.root;
    root._assertUsable('retryPlugin');
    const record = root._pluginRecords.get(id);
    if (!record) throw new PluginNotFoundError(id);
    if (
      record.status === 'activating' ||
      record.status === 'starting' ||
      record.status === 'disposing'
    ) {
      throw new InvalidPluginStateError(id, record.status, 'retryPlugin');
    }
    // 显式重试等同直接加载：严格模式下异常抛回调用方
    await root._reactivatePlugin(id, record, 'retryPlugin', root.strictPlugins);
  }

  /**
   * 激活一个已停用的插件（控制台的 enable）。
   *
   * 只接受 `disposed` / `failed`：
   * - `pending` 表示依赖未满足，属于等待队列的职责，不是「停用」；
   * - `active` / `activating` / `starting` / `disposing` 都不允许重复激活。
   *
   * 依赖未满足或激活失败都会抛错，且**不改变插件状态**（失败的插件仍停在 failed）。
   */
  async enablePlugin(id: string): Promise<void> {
    const root = this.root;
    root._assertUsable('enablePlugin');
    const record = root._pluginRecords.get(id);
    if (!record) throw new PluginNotFoundError(id);
    if (record.status !== 'disposed' && record.status !== 'failed') {
      throw new InvalidPluginStateError(id, record.status, 'enablePlugin');
    }
    const missing = record.inject.filter(
      (dep) => root._services.get(dep)?.state !== 'active',
    );
    if (missing.length) throw new PluginDependencyError([record.name], missing);
    // 显式启用必须把失败暴露给调用方（控制台需要如实回包）
    await root._reactivatePlugin(id, record, 'enablePlugin', true);
  }

  /**
   * 重新激活的公共路径（retryPlugin / enablePlugin 共用）：
   * 等后台回滚 → 清理残留子上下文 → 重新走事务化激活。
   */
  private async _reactivatePlugin(
    id: string,
    record: PluginRecord,
    operation: string,
    throwOnError: boolean,
  ): Promise<void> {
    const root = this.root;
    const def = root._pluginDefs.get(id);
    if (!def) throw new PluginNotFoundError(id);

    // 上一次失败若产生的是异步 Disposer，回滚可能仍在后台执行。
    // 必须等它彻底结束再开新生命周期，否则新旧实例的清理会互相干扰。
    await root._pendingCleanups.get(id);
    root._assertUsable(operation);

    // 清理上一次失败残留的子上下文
    const stale = root._instances.get(id);
    if (stale) {
      await stale.subCtx._disposeSubContext();
      root._instances.delete(id);
    }
    await root._activatePlugin(def.plugin, def.config, record, throwOnError);
  }

  /**
   * 动态卸载单个插件（内核原语）。保守策略：若其提供的服务仍被活跃插件依赖，则拒绝卸载。
   * 根容器整体 dispose() 时才允许强制级联。
   */
  async unloadPlugin(id: string): Promise<void> {
    return this._deactivatePlugin(id, 'unloadPlugin', 'unload');
  }

  /**
   * 停用一个插件（控制台的 disable）。
   *
   * 与 `unloadPlugin()` 共用同一实现，差别只在 `plugin:disposed` 的 `reason`
   * 以及状态守卫的措辞 —— 语义上就是「卸载但保留插件定义」，因此可以再 enable。
   */
  async disablePlugin(id: string): Promise<void> {
    return this._deactivatePlugin(id, 'disablePlugin', 'disable');
  }

  private async _deactivatePlugin(
    id: string,
    operation: string,
    reason: PluginDisposeReason,
  ): Promise<void> {
    const root = this.root;
    root._assertUsable(operation);
    const record = root._pluginRecords.get(id);
    if (!record) throw new PluginNotFoundError(id);
    if (record.protected) throw new ProtectedPluginError(id, operation);
    if (record.status === 'activating' || record.status === 'starting') {
      throw new InvalidPluginStateError(id, record.status, operation);
    }
    const instance = root._instances.get(id);
    if (!instance) throw new InvalidPluginStateError(id, record.status, operation);

    for (const [name, entry] of root._services) {
      if (entry.ownerId !== id) continue;
      const dependents = root._activeDependentsOf(name, id);
      if (dependents.length) throw new ServiceInUseError(name, dependents);
    }

    this._setPluginStatus(record, 'disposing', reason);
    const errors = await instance.subCtx._disposeSubContext();
    record.disposedAt = Date.now();
    if (errors.length) record.cleanupError = toPluginError(errors[0]);
    root._instances.delete(id);
    root._removeDependents(record);
    this._setPluginStatus(record, 'disposed', reason);
    this._emitPluginEvent('plugin:disposed', record, { reason });
  }

  /**
   * 生成插件记录。
   *
   * **稳定 id**：显式 `id` 优先 → `name` → 匿名时 `anonymous-plugin#N`。
   * 只有匿名插件才带序号，具名插件的 id 因此在多次启动之间保持稳定，
   * 控制台才能用 id 作为寻址主键（见 `_assertPluginIdAvailable`）。
   */
  private _createRecord(plugin: ErasedPlugin): PluginRecord {
    const name = plugin.name ?? 'anonymous-plugin';
    const id = plugin.id ?? plugin.name ?? `anonymous-plugin#${++this._seq}`;
    return {
      id,
      name,
      version: plugin.version,
      protected: plugin.protected === true,
      inject: plugin.inject ? plugin.inject.map(String) : [],
      layer: plugin.layer ?? 'business',
      status: 'pending',
      attempt: 0,
    };
  }

  /** id 是控制台寻址主键，冲突时直接拒绝而不是静默去重 */
  private _assertPluginIdAvailable(id: string) {
    if (this._pluginRecords.has(id)) throw new DuplicatePluginError(id);
  }

  private _isInjectSatisfied(inject?: readonly ServiceName<S>[]): boolean {
    if (!inject || inject.length === 0) return true;
    return inject.every((dep) => this.root._services.get(dep)?.state === 'active');
  }

  /**
   * 扫描等待队列，激活依赖已就绪的插件。
   *
   * 语义要点：**队列中的插件是独立生命周期**。
   * - 逐个处理，每个插件的激活失败就地捕获，绝不让异常冒泡出去牵连调用方
   *   （否则会沿着 `provide() → apply() → _activatePlugin()` 把服务提供方一起拖垮）；
   * - 失败插件记为 `failed` 且不回队列；依赖仍不满足的继续留队，不会被中断丢失；
   * - 已成功激活的插件保持 `active`，不受同批次其他插件失败影响。
   *
   * 因此 `strictPlugins` 只作用于**直接调用 `plugin()`** 的场景；后台队列的失败
   * 通过插件状态与 `plugin:failed` 事件上报。
   */
  private _checkPendingPlugins() {
    let progress = true;
    while (progress) {
      progress = false;
      // 先接管当前队列再激活：插件激活过程中可能再次 provide 并重入本方法
      const queue = this._pendingPlugins;
      this._pendingPlugins = [];
      for (const item of queue) {
        if (!this._isInjectSatisfied(item.plugin.inject)) {
          this._pendingPlugins.push(item);
          continue;
        }
        try {
          this._activatePlugin(item.plugin, item.config, item.record);
          progress = true;
        } catch (err) {
          // 兜底：_activatePlugin 正常路径不会抛（失败已就地处理），
          // 这里保证任何意外异常也不会中断队列扫描、不会冒泡给服务提供方。
          const error = err instanceof Error ? err : new Error(String(err));
          item.record.error = toPluginError(error);
          this._setPluginStatus(item.record, 'failed');
          console.error(`[Context] 等待队列中的插件 "${item.record.id}" 激活失败:`, error);
          this._emitPluginEvent('plugin:failed', item.record, { error: item.record.error });
        }
      }
    }
  }

  /**
   * 事务化激活：pending → activating → apply() → active。
   * apply() 抛错时回滚该子上下文已产生的全部副作用，并把状态置为 failed（不留在等待队列，避免错误重试）。
   *
   * @param throwOnError 失败时是否向上抛出。**只有直接调用 `plugin()` / `retryPlugin()` 时才为 true**
   *   （且仅在严格模式下）；等待队列扫描一律传 false，让失败就地收敛成状态 + 事件。
   */
  private _activatePlugin(
    plugin: ErasedPlugin,
    config: any,
    record: PluginRecord,
    throwOnError = false,
  ): void | Promise<void> {
    this._setPluginStatus(record, 'activating');
    record.attempt += 1;

    // 为插件创建子上下文，实现生命周期与副作用的可逆隔离
    const subCtx = new Context<S>(this);
    subCtx._ownerId = record.id;

    let result: void | Disposer | Promise<void | Disposer>;
    try {
      // 插件在注册时被擦除为 ErasedPlugin；这里恢复为当前应用服务表的插件类型，
      // 子上下文中的动态服务属性由 Proxy 在运行时提供。
      const typedPlugin = plugin as unknown as Plugin<S, never, any>;
      result = typedPlugin.setup
        ? typedPlugin.setup(subCtx, config)
        : typedPlugin.apply!(subCtx, config);
    } catch (err) {
      this._failActivationSync(record, subCtx, err);
      if (throwOnError) throw err;
      return;
    }

    if (result instanceof Promise) {
      this._setPluginStatus(record, 'starting');
      const task = this._completeAsyncActivation(plugin, config, record, subCtx, result, throwOnError);
      this.root._activations.set(record.id, task);
      return task;
    }

    if (typeof result === 'function') subCtx.effect(result);
    this._completeActivation(plugin, config, record, subCtx);
  }

  private _completeActivation(
    plugin: ErasedPlugin,
    config: any,
    record: PluginRecord,
    subCtx: Context<S>,
  ) {
    record.activatedAt = Date.now();
    delete record.error;
    this._registerDependents(record);
    this._instances.set(record.id, { plugin, config, record, subCtx });
    this._setPluginStatus(record, 'active');
    this._emitPluginEvent('plugin:activated', record);
  }

  private async _completeAsyncActivation(
    plugin: ErasedPlugin,
    config: any,
    record: PluginRecord,
    subCtx: Context<S>,
    setup: Promise<void | Disposer>,
    throwOnError: boolean,
  ): Promise<void> {
    try {
      const cleanup = await setup;
      if (typeof cleanup === 'function') subCtx.effect(cleanup);
      this._completeActivation(plugin, config, record, subCtx);
    } catch (err) {
      const errors = await subCtx._disposeSubContext();
      record.error = toPluginError(err);
      this._setPluginStatus(record, 'failed');
      if (errors.length) record.cleanupError = toPluginError(errors[0]);
      this._removeDependents(record);

      this._emitPluginEvent('plugin:failed', record, { error: record.error });

      if (throwOnError) throw err;
      console.error(`[Context] 插件 "${record.id}" 异步初始化失败，已回滚并记为 failed:`, err);
    } finally {
      this.root._activations.delete(record.id);
    }
  }

  private _failActivationSync(record: PluginRecord, subCtx: Context<S>, err: unknown) {
    // 同步回滚：撤销已登记的服务、工具、事件与 Waterfall，保证 failed 状态可即时观测。
    const { settled } = subCtx._drainDisposersSync();
    record.error = toPluginError(err);
    this._setPluginStatus(record, 'failed');
    this._removeDependents(record);

    // 若撤销函数里有异步清理，它会在后台继续执行。登记这个任务：
    // retryPlugin() / dispose() 都会先 await 它，避免新旧生命周期重叠。
    this._pendingCleanups.set(
      record.id,
      settled.then((cleanupErrors) => {
        if (cleanupErrors.length) record.cleanupError = toPluginError(cleanupErrors[0]);
        this._pendingCleanups.delete(record.id);
      }),
    );

    // 失败统一通过「状态 + 事件」上报
    this._emitPluginEvent('plugin:failed', record, { error: record.error });

    console.error(`[Context] 插件 "${record.id}" 激活失败，已回滚并记为 failed:`, err);
  }

  private _registerDependents(record: PluginRecord) {
    for (const dep of record.inject) {
      if (!this._dependents.has(dep)) this._dependents.set(dep, new Set());
      this._dependents.get(dep)!.add(record.id);
    }
  }

  private _removeDependents(record: PluginRecord) {
    for (const dep of record.inject) this._dependents.get(dep)?.delete(record.id);
  }

  // ==========================================
  // 插件生命周期事件
  //
  // 控制台（ConsoleApiPlugin）靠这四个事件驱动实时状态流：
  //   plugin:activated / plugin:failed / plugin:disposed / plugin:state-changed
  // 一律 `void this.emit(...)` —— 事件是通知，不阻塞生命周期，也不影响事务语义。
  // ==========================================

  /** 状态迁移的唯一入口：改状态并广播 plugin:state-changed */
  private _setPluginStatus(record: PluginRecord, status: PluginStatus, reason?: PluginDisposeReason) {
    const from = record.status;
    if (from === status) return;
    record.status = status;
    this._emitPluginEvent('plugin:state-changed', record, { from, reason });
  }

  private _emitPluginEvent(
    event: string,
    record: PluginRecord,
    extra: Partial<Pick<PluginEventPayload, 'from' | 'reason' | 'error'>> = {},
  ) {
    const payload: PluginEventPayload = {
      id: record.id,
      name: record.name,
      layer: record.layer,
      status: record.status,
      at: Date.now(),
      ...extra,
    };
    void this.emit(event, payload);
  }

  private get strictPlugins(): boolean {
    return this.root._options?.strictPlugins ?? false;
  }

  // ==========================================
  // 副作用与销毁
  // ==========================================

  /** 注册副作用：在 dispose 销毁时按逆序自动清理 */
  effect(disposer: Disposer): Disposer {
    this._disposers.push(disposer);
    return disposer;
  }

  /** 订阅当前上下文的事件。根上下文监听根事件，子上下文监听自身事件。 */
  on(event: string, handler: Function): Disposer {
    return this._on(event, handler);
  }

  /**
   * 订阅根上下文事件。
   *
   * 控制面插件通常在子 Context 中运行，但 `plugin:*` / `service:*` 由根容器发出，
   * 因此它们应使用 onRoot() 而不是 on()。
   */
  onRoot(event: string, handler: Function): Disposer {
    return this.root._on(event, handler);
  }

  private _on(event: string, handler: Function): Disposer {
    if (!this._events.has(event)) this._events.set(event, new Set());
    this._events.get(event)!.add(handler);

    const disposer = () => {
      this._events.get(event)?.delete(handler);
    };
    return this.effect(disposer);
  }

  /**
   * 派发事件。
   *
   * 监听器相互隔离：一个监听器抛错不会阻塞其他监听器，也不会让 emit() reject。
   */
  async emit(event: string, ...args: any[]) {
    const handlers = [...(this._events.get(event) ?? [])];
    const results = await Promise.allSettled(
      handlers.map(async (handler) => handler(...args)),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`[Context] 事件 "${event}" 监听器执行失败:`, result.reason);
      }
    }
  }

  /** 洋葱圈 Waterfall 中间件模式：调用 next() 委托给下游，不调用则中断拦截 */
  waterfall<T>(event: string, handler: WaterfallHandler<T>): Disposer {
    const target = this.root;
    if (!target._waterfalls.has(event)) target._waterfalls.set(event, []);
    target._waterfalls.get(event)!.push(handler);

    const disposer = () => {
      const list = target._waterfalls.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
    return this.effect(disposer);
  }

  async runWaterfall<T>(event: string, initial: T): Promise<T> {
    const handlers = this._waterfalls.get(event) || [];
    let index = 0;
    const dispatch = async (current: T): Promise<T> => {
      if (index >= handlers.length) return current;
      const fn = handlers[index++];
      return fn(current, () => dispatch(current));
    };
    return dispatch(initial);
  }

  /**
   * 销毁容器。
   *
   * - **共享**：第一次调用创建并缓存 `_disposePromise`，后续调用（含并发调用）直接返回**同一个对象**，
   *   因此所有调用者都在真正清理完成后才继续，且重复调用幂等。
   * - **状态机**：调用瞬间即切到 `disposing`，此后 `plugin()` / `provide()` / `retryPlugin()` /
   *   `unloadPlugin()` / 工具注册全部被拒绝，不会出现「销毁期间加入的插件残留成 active」。
   * - 完成后切到 `disposed`（不可恢复）。
   *
   * 注意本方法**不是 async**：async 方法每次都会包装出一个新 Promise，就破坏不了「同一对象」这个保证了。
   */
  dispose(): Promise<void> {
    const root = this.root;

    // 子上下文：只清理自身副作用，不参与容器状态机
    if (this !== root) return root._drainDisposers().then(() => undefined);

    if (root._disposePromise) return root._disposePromise;

    // 先切状态，再开始清理：销毁期间一切状态变更操作立即被拒
    root._containerState = 'disposing';

    root._disposePromise = root
      ._runDispose()
      .then((errors) => {
        if (errors.length) {
          console.error(`[Context] 销毁过程记录了 ${errors.length} 个清理异常（详见上方日志）`);
        }
      })
      .finally(() => {
        root._containerState = 'disposed';
      });

    return root._disposePromise;
  }

  /**
   * 真正执行清理，返回过程中吞掉的异常列表。顺序固定为：
   * 等异步回滚 → 拓扑序销毁插件 → root 自身 effects → 删服务根属性 → 清空注册表/队列/事件表。
   *
   * 无论中途发生什么，`finally` 都会把全局表清空并把仍处于非终态的插件强制标记，
   * 保证 `disposed` 之后不可能有残留的 `active` 插件。
   */
  private async _runDispose(): Promise<Error[]> {
    const root = this.root;
    const errors: Error[] = [];

    try {
      // 0. 先等待正在执行的异步 setup 结束，避免插件初始化与销毁交叉执行
      if (root._activations.size) {
        await Promise.allSettled([...root._activations.values()]);
      }

      // 0.1 等激活失败留下的后台异步回滚结束，避免清理与回滚交叉执行
      if (root._pendingCleanups.size) {
        await Promise.allSettled([...root._pendingCleanups.values()]);
      }

      // 1. 按「依赖方先于提供方」的顺序销毁插件，避免依赖方在服务消失后才清理
      for (const record of root._pluginDisposeOrder()) {
        errors.push(...(await root._disposePlugin(record)));
      }

      // 2. 根上下文自身的副作用
      errors.push(...(await root._drainDisposers()));
    } finally {
      // 3. 删除仍指向已注册服务的根属性。
      //    即使某个 Disposer 缺失或抛错，也不能留下 root.tools / root.svc 这类悬空引用。
      for (const [name, entry] of root._services) {
        if (root._getRootProp(name) === entry.value) root._deleteRootProp(name);
      }

      // 4. 清空全局注册表、等待队列与事件表；非终态插件强制收尾
      for (const record of root._pluginRecords.values()) {
        if (
          record.status === 'pending' ||
          record.status === 'activating' ||
          record.status === 'starting' ||
          record.status === 'active' ||
          record.status === 'disposing'
        ) {
          record.status = 'disposed';
          record.disposedAt = Date.now();
        }
      }
      root._pendingPlugins = [];
      root._services.clear();
      root._dependents.clear();
      root._waterfalls.clear();
      root._events.clear();
      root._pendingCleanups.clear();
    }

    return errors;
  }

  /**
   * 插件销毁顺序：依赖方先于其服务的提供方。
   * 激活顺序本身满足「提供方在前」，但 provide() 触发的链式激活会打乱 disposer 的入栈顺序，
   * 因此这里显式做一次拓扑排序，而不是依赖 LIFO。
   */
  private _pluginDisposeOrder(): PluginRecord[] {
    const ordered: PluginRecord[] = [];
    const done = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string) => {
      if (done.has(id) || visiting.has(id)) return; // visiting 兼作环保护
      visiting.add(id);
      const record = this._pluginRecords.get(id);
      if (record) {
        for (const dep of record.inject) {
          const provider = this._services.get(dep);
          if (provider && provider.ownerId !== id) visit(provider.ownerId);
        }
      }
      visiting.delete(id);
      done.add(id);
      if (record) ordered.push(record);
    };

    for (const record of this._pluginRecords.values()) visit(record.id);
    return ordered.reverse(); // 逆序 → 依赖方排在提供方之前
  }

  private async _disposePlugin(record: PluginRecord): Promise<Error[]> {
    const instance = this._instances.get(record.id);
    if (!instance) return [];

    this._setPluginStatus(record, 'disposing', 'container-dispose');
    const errors = await instance.subCtx._disposeSubContext();
    record.disposedAt = Date.now();
    if (errors.length) record.cleanupError = toPluginError(errors[0]);
    this._instances.delete(record.id);
    this._removeDependents(record);
    this._setPluginStatus(record, 'disposed', 'container-dispose');
    this._emitPluginEvent('plugin:disposed', record, { reason: 'container-dispose' });
    return errors;
  }

  /** 子上下文销毁：只清自身副作用，返回捕获的异常供调用方记录 cleanupError */
  private async _disposeSubContext(): Promise<Error[]> {
    return this._drainDisposers();
  }

  /** 逆序执行全部清理函数；单个清理抛错不影响其余，错误被收集返回 */
  private async _drainDisposers(): Promise<Error[]> {
    const errors: Error[] = [];
    while (this._disposers.length) {
      const disposer = this._disposers.pop();
      try {
        await disposer?.();
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
        console.error('[Context] 销毁清理出错:', err);
      }
    }
    return errors;
  }

  /**
   * 同步清理：用于插件激活失败时的回滚，使 failed 状态立即可观测。
   *
   * 同步 Disposer 立即执行；返回 Promise 的 Disposer 无法在同步流程里等待，
   * 因此收集成 `settled` 返回，由调用方决定何时（retryPlugin / dispose）等待它。
   */
  private _drainDisposersSync(): { errors: Error[]; settled: Promise<Error[]> } {
    const errors: Error[] = [];
    const pending: Promise<unknown>[] = [];

    while (this._disposers.length) {
      const disposer = this._disposers.pop();
      try {
        const result = disposer?.();
        if (result instanceof Promise) pending.push(result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
        console.error('[Context] 回滚清理出错:', error);
      }
    }

    const settled = Promise.allSettled(pending).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') {
          const error =
            result.reason instanceof Error ? result.reason : new Error(String(result.reason));
          errors.push(error);
          console.error('[Context] 异步回滚失败:', error);
        }
      }
      return errors;
    });

    return { errors, settled };
  }
}
