# Lattice - 本地优先的插件化应用内核

**Lattice** 借鉴 **Cordis 微内核（Microkernel）** 思想，实现了一个精炼的、**万物皆插件（Everything-as-a-plugin）**的 AI Agent 执行环境。

---

## 目录与模块划分

```text
lattice/
├── context.ts           # 【内核层】Context<S> / 类型化服务系统 / 生命周期 / 事件 / Waterfall —— 零 import
├── contracts/           # 【契约层】能力接口、数据类型与应用服务表（只依赖内核的类型）
│   ├── index.ts         #   契约统一出口
│   ├── tools.ts         #   ToolDefinition / ToolService / 工具名约束 / 两个工具错误
│   ├── llm.ts           #   ChatMessage / LLMService
│   ├── agent.ts         #   AgentStep / AgentRunOptions / AgentRunResult / AgentService
│   ├── verify.ts        #   VerifyReport / VerifyService 等自检契约
│   ├── telemetry.ts     #   VisualEvent / SseClient / TelemetryService
│   ├── web-server.ts    #   WebRoute / WebServerService（HTTP 载体契约）
│   ├── plugin-inventory.ts #  PluginView / PluginInventoryService（只读插件清单）
│   ├── plugin-manager.ts   #  PluginManagerService / PluginActionResponse（运行时启停）
│   └── service-map.ts   #   LatticeCoreServiceMap / LatticeWebServiceMap：核心与 Web 服务表
├── plugins/             # 【实现层】业务插件归类目录（每个插件一个独立文件夹）
│   ├── index.ts         #   插件统一出口
│   ├── tools/           #   ToolsPlugin + ToolsService（ToolService 的默认实现）
│   ├── mock-llm/        #   MockLLMPlugin：提供 llm 服务
│   ├── calculator-tool/ #   CalculatorToolPlugin：注册计算器工具
│   ├── audit/           #   AuditPlugin：洋葱圈拦截
│   ├── agent-loop/      #   AgentLoopPlugin：提供 agent 服务（Agent 主循环）
│   ├── plugin-manager/  #   PluginManagerPlugin：提供 pluginInventory + pluginManager
│   └── verify/          #   VerifyPlugin：提供 verify 服务（35 场景 / 202 断言的自检）
│                        #     末尾带 argv 守卫，可直接作为 CLI 入口执行
├── main.ts              # 【运行入口】组装容器、乱序挂载插件、触发会话与销毁示例
├── web-server.ts        # 【运行入口】TelemetryPlugin + WebServerPlugin + HTTP/SSE + 静态托管
├── index.ts             # 【公共入口】统一导出 Kernel + Contracts + Plugins
├── package.json         # 【包配置】name=lattice, version=0.0.1, private
├── type-tests.ts        # 【编译期校验】类型断言，不被任何入口 import
├── tsconfig.json        # 【编译期校验】tsc --noEmit 的配置
├── web/index.html       # 【前端】可视化面板
└── README.md            # 【架构文档】当前说明文档
```

**分层规则**：箭头只能自上而下。`context.ts` **零 import**；`contracts/*` 只导入内核的类型；`plugins/*` 导入内核与契约；入口导入三者但只依赖契约。**内核完全不知道 Tools / LLM / Agent / Verify / Telemetry 的存在** —— 它只管理「服务」这个抽象，只知道一张泛型服务表 `S`。

---

## 1. 各模块作用与核心职责

### 1.1 `context.ts`（内核层）

`context.ts` 是整个插件平台的基石。它**零 import**，不包含任何具体的 AI/Agent 业务逻辑，纯粹负责依赖注入、插件生命周期管理与事件分发。**它不知道 Tools / LLM / Agent / Verify 的存在** —— 只管理「服务」这个抽象，靠一个泛型参数 `S`（服务表）把「服务名 → 服务类型」的约束带进来。

- **`Context<S>` 上下文容器**：
  - **类型化服务系统**：`S` 由应用在 [contracts/service-map.ts](contracts/service-map.ts) 里声明。核心插件使用 `LatticeCoreServiceMap`，Web 组合使用 `LatticeWebServiceMap`；内核**不导入**任何业务契约。`provide<K extends ServiceName<S>>(name: K, value: S[K])` 因此在编译期校验服务名与服务类型；`inject: ['tools']` 让插件 `apply(ctx)` 里的 `ctx.tools` 自动推导为 `ToolService`，**不需要任何 `as ToolService` 断言**。类上**没有** `[key: string]: any` 索引签名。
  - **服务注册表与发现**：`provide()` 写入独立注册表（记录 `ownerId` / `state` / `providedAt` / `version` / `scope`），并顺带把实例挂到根 Context 上作为**运行时兼容通道**（于是 `ctx.tools` 这种动态访问在运行时仍可用，但类型系统不依赖它）。读取服务用 `getService(name)`（未就绪返回 `undefined`）或 `requireService(name)`（未就绪抛错）。同一时刻**不允许两个活跃插件提供同名服务**，冲突会抛 `DuplicateServiceError`。返回的 `Disposer` 是幂等的，且只在「注册表里仍是自己」时才删除，因此不会误删别人接管的同名服务。
  - **`provide()` 的顺序**：登记注册表 → **立刻把撤销函数绑到调用者子上下文** → 再广播并唤醒等待队列。服务一经可见就应可撤销。
  - **依赖等待队列（`inject`）**：插件可以声明自己依赖的服务（如 `inject: ['tools', 'llm']`）。如果插件加载时依赖尚未就绪，会被自动放入 `_pendingPlugins` 挂起；一旦依赖的服务被 `provide()`，自动触发激活，因此**插件支持任意乱序注册**。
  - **队列中的插件是独立生命周期**：服务就绪时会逐个激活等待插件，**每个插件的失败就地收敛**（记为 `failed` + 广播 `plugin:failed`），既不冒泡给调用方、也不牵连服务提供方，更不会中断扫描导致后续条目丢失。`strictPlugins` 只控制**直接调用 `plugin()` / `retryPlugin()`** 时的异常行为。
  - **同步与异步生命周期**：同步插件使用 `apply()`；异步插件使用 `setup()`，并返回 `Promise`。异步初始化期间插件状态为 `starting`，宿主通过 `await ctx.start()` 或 `await ctx.ready()` 等待所有插件完成。依赖缺失或初始化失败会让 `start()` 抛错，避免未就绪时开放能力。
  - **子上下文隔离（Sub-Context）**：每个插件激活时都会获得一个独立的子 Context 实例，并打上 `_ownerId`；插件产生的所有副作用（注册的服务、工具、事件监听、中间件）都绑定在当前子上下文上。
  - **根容器是状态机**：`active → disposing → disposed`。转入 `disposing` 的**那一刻**起，`plugin()` / `provide()` / `retryPlugin()` / `unloadPlugin()` / `tools.register()` 全部抛 `ContainerDisposedError`，杜绝「销毁期间加入的插件残留成 active」。只读操作（`listPlugins` / `listServices` / `state`）始终可用。
  - **`dispose()` 可共享等待**：它不是 async 方法，而是返回同一个 `_disposePromise` —— 并发或重复调用会拿到**同一个 Promise 对象**，等的是同一次清理。
- **插件是一个完整事务（状态机 + 失败回滚）**：
  - 状态机：`pending → activating → starting → active → disposing → disposed`，激活失败进入 `failed`。
  - `apply()` 或 `setup()` 抛错时会回滚该子上下文已产生的全部副作用，并把状态置为 `failed`（附可序列化的 `error`），不会留下半成品。默认是**宽松模式**（记录 failed 并继续启动其他插件）；`new Context(undefined, { strictPlugins: true })` 可切换为严格模式。
  - 若回滚涉及**异步清理**（Disposer 返回 Promise），它会被登记为后台任务；`retryPlugin(id)` 会先等它结束再开新生命周期，`dispose()` 也会等全部回滚完成，避免新旧生命周期重叠。
  - `retryPlugin(id)` 可重新激活失败的插件，`unloadPlugin(id)` 可动态卸载——若其服务仍被活跃插件依赖，会抛 `ServiceInUseError` 拒绝卸载。
- **可逆副作用与生命周期（`effect` / `disposer`）**：
  - 核心思想是“谁注册、谁清理”。所有的注册方法都会返回一个 `Disposer`。当插件被卸载或容器调用 `await ctx.dispose()` 时自动调用清理函数，做到零脏状态残留。
  - `Disposer` 允许返回 `Promise`，因此数据库连接、HTTP 客户端这类异步资源也能可靠释放；单个清理函数抛错不会中断其他清理，但会被记录到该插件的 `cleanupError`。
  - 销毁顺序是**拓扑序而不是简单的 LIFO**：`provide()` 会触发链式激活，使得 disposer 入栈顺序与依赖顺序不一致，因此 `dispose()` 会显式按 `inject` 关系排序，保证**依赖方先于其服务的提供方**被清理。
  - 销毁的 `finally` 会**删除仍指向服务实例的根属性**，并把仍处于非终态的插件强制收尾成 `disposed`（`failed` 保留），即使某个 Disposer 缺失或抛错也不会留下悬空引用。
- **洋葱圈流式中间件（`waterfall`）**：
  - 区别于普通事件的广播，`waterfall` 允许插件通过 `next()` 拦截、修改传入参数或截断执行，用于工具执行的前置校验与后置脱敏。

---

### 1.2 `contracts/`（契约层）

**能力接口与数据类型**。这一层只依赖内核的类型（`Disposer`），不含任何实现 —— 实现全在 `plugins/`。按领域拆成九个文件，由 `contracts/index.ts` 统一出口：

| 文件 | 导出 |
| :--- | :--- |
| [contracts/tools.ts](contracts/tools.ts) | `ToolDefinition` / `TOOL_NAME_PATTERN` / `RegisterToolOptions` / **`ToolService`（接口）** / `ToolRegistration` / `DuplicateToolError` / `InvalidToolDefinitionError` |
| [contracts/llm.ts](contracts/llm.ts) | `ChatMessage` / `LLMService` |
| [contracts/agent.ts](contracts/agent.ts) | `AgentStep` / `AgentRunOptions` / `AgentRunResult` / `AgentService` |
| [contracts/verify.ts](contracts/verify.ts) | `VerifyFailure` / `VerifyScenarioResult` / `VerifyReport` / `VerifyRunOptions` / `VerifyService` |
| [contracts/telemetry.ts](contracts/telemetry.ts) | `VisualEvent` / `SseClient` / `TelemetryService`（web-server 的 `TelemetryPlugin` 实现它） |
| [contracts/web-server.ts](contracts/web-server.ts) | `WebRoute` / `WebRequest` / `WebResponse` / `WebServerService`（HTTP 载体，插件用 `register()` 挂路由） |
| [contracts/plugin-inventory.ts](contracts/plugin-inventory.ts) | `PluginView` / `PluginInventorySnapshot` / `PluginInventoryService`（只读插件清单） |
| [contracts/plugin-manager.ts](contracts/plugin-manager.ts) | `PluginManagerService` / `PluginActionResponse` / `PluginActionError` / `PluginActionErrorCode`（运行时启停） |
| [contracts/service-map.ts](contracts/service-map.ts) | `LatticeCoreServiceMap`（核心 6 服务）、`LatticeWebServiceMap`（Core + WebServer + Telemetry）及对应 ServiceName |

各能力的约定一致：**契约层只有接口，具体实现由插件 `provide` 出来**。

> 服务表 **必须用 `type` 而不是 `interface`**：`interface` 不会获得隐式索引签名，因而无法满足内核的服务表约束 `S extends ServiceMap`（`ServiceMap = object`）。

- **`ToolService`**：`register(tool, options?)` / `getSchemas()` / `list()` / `execute(name, args)`。默认实现是 [plugins/tools/](plugins/tools/index.ts) 里的 `ToolsService`。
  - `register` 的规则：**先校验后提交**（名称需匹配 `/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/`，`description` / `parameters` / `execute` 都要合规）→ **默认拒绝重名**（抛 `DuplicateToolError`，只有 `{ replace: true }` 才允许覆盖）→ 每个条目带唯一 `generation`，**旧句柄重复调用是安全空操作**。
  - `getSchemas()` 只取 `active` 条目并剥离 `execute`；`list()` 额外带上 `ownerId`，供控制台按插件归属展示工具。
  - `execute()` 先取定义快照（注销不影响进行中的调用），再走 `tools/pre-execute` → 真实执行 → `tools/post-execute` 的拦截管线。
- **`LLMService`**：`chat(messages, tools)` 与 `ChatMessage`（兼容 OpenAI / DeepSeek Tool Calling 规范）。
- **`AgentService`**：`run(goal, opts?)`，返回 `{ traceId, answer, steps }`；`steps` 逐步记录 `llm` / `tool` / `final` 轨迹。调用方（`main.ts` / `web-server.ts`）只依赖该接口，主循环实现可被其他插件整体替换。
- **`VerifyService`**：`run(opts?)` / `listScenarios()`，由 verify 插件实现。

> **`ToolsService` 为什么是类而不是匿名对象**：工具注册表、重名校验、代次管理这些逻辑是**通用**的，不随插件变化，所以给了一个可复用的默认实现（`plugins/tools/index.ts`）。它是 `ToolsService<S extends ServiceMap>` —— 泛型化是为了让「任意服务表的容器」都能构造它（`Context` 的类型参数是不变的）。LLM / Agent / Verify / Telemetry 则只定义接口，由各自插件提供匿名实现。

---

### 1.3 `plugins/`（插件实现层）

Lattice 沿用 Cordis 的无特权内核思想：**所有功能都以插件形式挂载**。每个插件独立为一个文件夹，由 `plugins/index.ts` 统一导出：

| 插件名称 | 依赖服务 (`inject`) | 层级 | 作用与交互逻辑 |
| :--- | :--- | :--- | :--- |
| **`ToolsPlugin`** | 无 | business | 调用 `ctx.provide('tools', new ToolsService(ctx))`，向上下文提供工具管理服务。契约 `ToolService` 在 [contracts/tools.ts](contracts/tools.ts)，实现 `ToolsService<S>` 与本插件同文件。 |
| **`MockLLMPlugin`** | 无 | business | 调用 `ctx.provide('llm', ...)`，提供模拟/真实的大模型调用服务。 |
| **`CalculatorToolPlugin`** | `['tools']` | business | 声明依赖 `tools`。当工具服务就绪后，调用 `ctx.tools.register(..., { ownerId: ctx.ownerId })` 注册计算器工具（`ctx.tools` 由 `inject` 推导，无需断言），并用 **`ctx.effect(...)` 显式绑定**注销回调——这样即使注册之后插件的初始化又失败，工具也会随回滚一起撤销。 |
| **`AuditPlugin`** | 无 | business | 监听 `tools/pre-execute` 与 `tools/post-execute`，在不修改任何工具实现的情况下，对输入输出进行安全审查和日志追踪。 |
| **`AgentLoopPlugin`** | `['tools', 'llm']` | business | 声明依赖工具与模型服务。就绪后调用 `ctx.provide('agent', ...)` 提供 `AgentService`，协调用户输入、模型推理、工具分发调用与多轮交互循环，并返回带 `traceId` 的执行轨迹。 |
| **`PluginManagerPlugin`** | 无 | system | `protected: true`；提供 `pluginInventory` 与 `pluginManager`，支持 enable / disable / restart / retry。 |
| **`VerifyPlugin`** | 无 | system | 调用 `ctx.provide('verify', ...)` 提供 `VerifyService`（35 场景 / 202 断言的自检）。**挂载后不自动执行**，通过 `ctx.requireService('verify').run()` 按需触发；每个场景跑在自己的 `new Context<场景服务表>()` 上，不污染宿主容器。 |

> 核心插件统一用 `definePlugin<LatticeCoreServiceMap>()({ ... })` 定义；Web 系统插件使用 `definePlugin<LatticeWebServiceMap>()`。它让 `inject` 里的服务名参与类型推导：`inject: ['tools']` 之后，`apply(ctx)` 里的 `ctx.tools` 就是 `ToolService`。

`web-server.ts` 里还有两个 `layer: 'system'` 的插件：`TelemetryPlugin`（实现 `TelemetryService` 并 `provide('telemetry', ...)`，同时在工具 waterfall 上包一层做穿透追踪）与 `WebServerPlugin`（HTTP 服务 + 路由 + 静态托管）。

---

### 1.4 `main.ts`（组装与入口）

模拟 Lattice Profile / App 的启动过程：

1. 创建根 `Context<LatticeCoreServiceMap>` 实例。
2. **乱序注册插件**：先注册消费方（`AgentLoopPlugin`、`CalculatorToolPlugin`），再注册提供方（`ToolsPlugin`、`MockLLMPlugin`），用于检验依赖调度能力。
3. 调用 `await rootCtx.start()`，等待所有同步和异步插件就绪。
4. 触发会话任务：执行 `rootCtx.requireService('agent').run(...)`，输出多轮交互全过程与执行轨迹步数。
5. 调用 `await rootCtx.dispose()`，验证服务、工具、事件、中间件与插件状态全部回收。

> 更完整的说明（架构、运行时时序、调用关系、变更记录）见同级目录 [lattice-doc/](../lattice-doc/README.md)。

---

### 1.5 `plugins/verify/`（自检插件 + CLI 入口）

自检能力是一个**自包含的插件**：既提供 `verify` 服务供任何容器按需触发，又通过文件末尾的 argv 守卫自己承担 CLI 入口职责。

| 角色 | 说明 |
| :--- | :--- |
| **插件本体** | [plugins/verify/index.ts](plugins/verify/index.ts) 导出 `VerifyPlugin` / `SCENARIO_TITLES`，`apply()` 里只 `provide('verify', ...)`，**挂载不跑任何场景** |
| **CLI 入口** | 同文件末尾的 argv 守卫：以本文件为入口时装配容器 → `start()` → `run()` → 报告转退出码，与 [web-server.ts](web-server.ts) 同一模式 |
| **测试本体** | `runAllScenarios()`：35 个场景、202 项断言 |

```sh
npx -y tsx plugins/verify/index.ts                 # 全部通过退出码 0，否则 1
npx -y -p typescript@5 tsc --noEmit -p tsconfig.json   # 编译期类型校验，无输出即通过
```

> 之所以不再单独保留根目录的 `verify.ts`：那 38 行只是「装配 + 退出码适配」，与插件本体同属一个关注点；合并后文件数少一个，命令与退出码契约不变。**插件本身不该决定进程退出码**，所以那段逻辑被严格限制在 `ENTRY` 守卫内 —— 被 `main.ts` / `web-server.ts` 经 `plugins/index.ts` 间接引入时不会触发。

**为什么做成插件而不是纯脚本**：

1. **按需触发**。挂载 `VerifyPlugin` 本身零成本（不跑任何场景），测试只在调用 `ctx.requireService('verify').run()` 时才发生 —— 所以它可以被安全地挂到任意容器上（也能被未来的 HTTP 路由触发），而不拖慢正常启动。
2. **宿主隔离**。每个场景内部 `new Context<场景服务表>()`，跑在自己的容器里；架构里的「故意让插件失败 / 故意 dispose 容器」这些破坏性操作完全不会影响宿主容器。
3. **可复用**。`run()` 返回可序列化的 `VerifyReport`（`passed` / `failed` / `failures` / `scenarios`），既能给 CLI 算退出码，也能给接口或面板消费。

```ts
import { Context } from './context.js';
import { VerifyPlugin } from './plugins/index.js';
import { LatticeCoreServiceMap } from './contracts/index.js';

const ctx = new Context<LatticeCoreServiceMap>();
ctx.plugin(VerifyPlugin);
await ctx.start();
const report = await ctx.requireService('verify').run({ log: false });
// → { passed: 202, failed: 0, failures: [], scenarios: [...35 项] }
```

约束：`verify` 服务**同一时刻只允许一次 `run()`**，并发调用会抛错（场景共享 `activeRun` 作用域）。

覆盖 **35 个场景 / 202 项断言**：工具重名与替换、注册原子性、Disposer 幂等与代次、插件失败回滚、服务重名、`failed → retryPlugin → active`、服务卸载的依赖保护、销毁拓扑序、`dispose()` 全量回收、清理异常隔离、严格 vs 宽松模式、严格模式嵌套激活事务边界、异步回滚时序、容器终态保护、销毁兜底、异步 `setup()` / `start()` 生命周期，以及运行时控制台的内核能力（稳定 id / `protected` / enable–disable / 生命周期事件 / Inventory / Manager / 根事件隔离）。场景清单与断言明细见 [lattice-doc/flows.md](../lattice-doc/flows.md#附-b验证脚本)。

**验收标准**（全绿时等价于）：`root` 服务为空、服务注册表为空、插件无 `active`、无悬空根属性，且容器进入 `disposed` 终态。

---

## 2. 模块交互关系与时序图

### 2.1 依赖就绪与启动阶段

```text
 ┌────────┐      ┌───────────────────────────┐      ┌──────────────┐      ┌─────────────┐
 │ main.ts│      │        Context            │      │ ToolsPlugin  │      │ CalcPlugin  │
 └───┬────┘      └─────────────┬─────────────┘      └──────┬───────┘      └──────┬──────┘
     │                         │                           │                     │
     │ 1. plugin(CalcPlugin)   │                           │                     │
     │────────────────────────>│ (声明依赖 'tools'，未满足)  │                     │
     │                         │ 挂起放入 pendingPlugins ───┼────────────────────>│ [等待]
     │                         │                           │                     │
     │ 2. plugin(ToolsPlugin)  │                           │                     │
     │────────────────────────>│ apply(ctx) ──────────────>│                     │
     │                         │   ctx.provide('tools')    │                     │
     │                         │<──────────────────────────│                     │
     │                         │                           │                     │
     │                         │ 触发依赖满足检查           │                     │
     │                         │────────────────────────────────────────────────>│ [激活]
     │                         │                                                 │ ctx.tools.register()
```

---

### 2.2 Agent 执行与洋葱圈拦截阶段

```text
 用户请求 "25 * 4 + 10"
         │
         ▼
┌──────────────────┐
│ AgentLoopPlugin  │
└────────┬─────────┘
         │
         │ 1. ctx.llm.chat(history)
         ▼
    [LLM 模型决策] ──> 要求调用 calculate(expression)
         │
         │ 2. ctx.tools.execute('calculate', args)
         ▼
┌──────────────────┐
│   ToolsService   │
└────────┬─────────┘
         │
         ├──> [Waterfall pre-execute] ──> [AuditPlugin 🛡️ 校验参数并放行]
         │
         ├──> [CalculatorTool 实际计算求值] ──> 返回 110
         │
         └──> [Waterfall post-execute] ─> [AuditPlugin 🛡️ 记录输出日志]
         │
         ▼
[LLM 归纳输出] ──> "计算完成，结果为：110"
```

---

### 2.3 可逆卸载阶段 (`dispose`)

```text
await rootCtx.dispose()
    │
    ├── 0. 复用 _disposePromise：并发/重复调用拿到同一个 Promise，等的是同一次清理
    │        并立刻把容器置为 disposing（此后一切状态变更操作被拒绝）
    │
    ├── 1. 等 _pendingCleanups 里的后台异步回滚结束（避免与正式清理交叉）
    │
    ├── 2. 按「依赖方先于提供方」的拓扑序销毁插件（不是 LIFO）
    │         因为 provide() 会触发链式激活，disposer 入栈顺序与依赖顺序不一致
    │         ├── AgentLoopPlugin 子上下文清理 ──> 撤销 agent 服务
    │         ├── CalculatorToolPlugin 子上下文清理 ──> 注销 calculate 工具
    │         ├── MockLLMPlugin 子上下文清理 ──> 撤销 llm 服务
    │         ├── ToolsPlugin 子上下文清理 ──> 撤销 tools 服务
    │         └── AuditPlugin 子上下文清理 ──> 移除 pre/post execute 拦截监听器
    │
    ├── 3. 执行 root 自身的副作用，并收集清理异常（不中断其他清理）
    │
    ├── 4. finally：删除仍指向服务实例的根属性（兜底，防悬空引用）
    │         ├── 非终态插件强制收尾为 disposed（pending/activating/active/disposing）
    │         └── 清空 _services / _dependents / _waterfalls / _events / _pendingCleanups
    │
    └── 5. 容器进入不可恢复的 disposed 终态（ctx.state）
              此后 plugin / provide / retryPlugin / unloadPlugin / tools.register 一律抛错
```

> 改造前后最大的区别：旧实现 `provide()` 只写属性、不登记 Disposer，所以 `dispose()` 之后
> `root.tools` 仍然存在、插件状态仍是 `active`。现在服务会被真正撤销，`getService('tools')` 变为
> `undefined`（根属性同步 `delete`），`listServices()` 为空，容器进入终态。回归断言见
> [lattice-doc/flows.md](../lattice-doc/flows.md#附-b验证脚本) 的场景 8、9、13、15、20、21、22、23。

---

## 3. 编译期校验

运行时行为由 `VerifyPlugin` 覆盖，**类型系统**由下面两个文件覆盖（2026-09-17 新增）：

| 文件 | 说明 |
| :--- | :--- |
| [tsconfig.json](tsconfig.json) | `strict: true` + `noEmit: true` + `moduleResolution: Bundler`（让 `./x.js` 解析到 `x.ts`） |
| [type-tests.ts](type-tests.ts) | 6 组 `@ts-expect-error` 断言，全部放在一个**从不调用**的 `compileTimeChecks()` 里，不被任何入口 import，因此没有运行时副作用 |

```bash
npx -y -p typescript@5 tsc --noEmit -p tsconfig.json
```

`@ts-expect-error` 只在「下一行确实报错」时才算通过：一旦类型系统放松了约束（例如 `provide()` 不再校验服务类型），这条指令会变成「未使用的 @ts-expect-error」编译错误，从而反向锁住约束。覆盖内容：错误服务类型、无效服务名、`inject` 推导、未 inject 的服务不可见、服务表扩展、自定义服务表、`getService` vs `requireService`。

---

## 4. 运行指南

进入当前工作区根目录，使用 `tsx` 直接运行：

```bash
npx tsx main.ts
```
