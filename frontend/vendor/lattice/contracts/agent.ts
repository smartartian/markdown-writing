// Lattice contracts: Agent
//
// Agent 能力契约：由 agent-loop 插件实现并 provide 为 ctx.agent。
// 调用方（CLI / Web）只依赖该接口，主循环实现可整体替换。

/** Agent 单步记录：对应 Reasoning → Acting 中的一次决策或一次工具调用 */
export interface AgentStep {
  idx: number;
  kind: 'llm' | 'tool' | 'final';
  input?: unknown;
  output?: unknown;
  ts: number;
}

export interface AgentRunOptions {
  /** 最大循环步数，默认 5 */
  maxSteps?: number;
}

export interface AgentRunResult {
  traceId: string;
  answer: string;
  steps: AgentStep[];
}

export interface AgentService {
  run(goal: string, opts?: AgentRunOptions): Promise<AgentRunResult>;
}
