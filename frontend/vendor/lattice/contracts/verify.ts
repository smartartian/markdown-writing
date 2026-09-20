// Lattice contracts: verify
//
// 自检能力契约：由 verify 插件实现并 provide 为 ctx.verify。
// 场景各自跑在独立容器上，不污染宿主。

/** 单条断言失败的明细 */
export interface VerifyFailure {
  scenario: string;
  assertion: string;
  detail?: string;
}

/** 单个场景的断言统计 */
export interface VerifyScenarioResult {
  title: string;
  passed: number;
  failed: number;
}

/** 一次自检的完整报告，可序列化 */
export interface VerifyReport {
  passed: number;
  failed: number;
  failures: VerifyFailure[];
  scenarios: VerifyScenarioResult[];
}

export interface VerifyRunOptions {
  /** 是否逐条打印断言结果，默认 true */
  log?: boolean;
}

export interface VerifyService {
  run(opts?: VerifyRunOptions): Promise<VerifyReport>;
  listScenarios(): string[];
}
