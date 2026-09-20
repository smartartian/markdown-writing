// Lattice CLI demo

import { Context } from './context.js';
import { LatticeCoreServiceMap } from './contracts/index.js';
import {
  AgentLoopPlugin,
  CalculatorToolPlugin,
  AuditPlugin,
  PluginManagerPlugin,
  ToolsPlugin,
  MockLLMPlugin,
} from './plugins/index.js';

async function main() {
  console.log('--- 1. 初始化 Context 容器与注册插件 ---');
  const rootCtx = new Context<LatticeCoreServiceMap>();

  // 乱序注册插件：演示依赖等待 (inject) 自动按需激活
  rootCtx
    .plugin(PluginManagerPlugin)  // system：插件清单与运行时管理
    .plugin(AgentLoopPlugin)      // 依赖 tools, llm (先挂起)
    .plugin(CalculatorToolPlugin) // 依赖 tools (先挂起)
    .plugin(AuditPlugin)          // 无依赖，立即激活
    .plugin(ToolsPlugin)          // 提供 tools 服务，此时 CalculatorTool 激活
    .plugin(MockLLMPlugin);       // 提供 llm 服务，此时 AgentLoop 激活

  await rootCtx.start();

  console.log('\n--- 2. 启动 Agent 任务执行 ---');
  const agent = rootCtx.requireService('agent');
  const result = await agent.run('请帮我算一下 25 * 4 + 10 是多少');
  console.log(`\n[${result.traceId}] 执行轨迹共 ${result.steps.length} 步`);

  console.log('--- 3. 演示可逆卸载 (Dispose) ---');
  await rootCtx.dispose();
  console.log('容器全部资源与插件已干净释放。');
}

main().catch(console.error);
