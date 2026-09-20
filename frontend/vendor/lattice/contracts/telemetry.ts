// Lattice contracts: telemetry
//
// 遥测契约：web-server 的 TelemetryPlugin 实现它并 provide 为 ctx.telemetry。
// 目的是让「广播可视化事件」与「注册 SSE 客户端」不再是挂在 root 上的动态属性。

/** 结构化事件，用于前端可视化看板消费 */
export interface VisualEvent {
  id: string;
  timestamp: number;
  type: 'kernel' | 'waterfall' | 'agent' | 'tool';
  stage: string;
  message: string;
  detail?: any;
}

/** SSE 客户端需要用到的最小面（避免契约层依赖 Node 的 ServerResponse 类型） */
export interface SseClient {
  write(chunk: string): unknown;
  on(event: string, handler: () => void): unknown;
}

export interface TelemetryService {
  /** 广播一条可视化事件；没有 SSE 客户端时是空操作 */
  broadcast(event: Omit<VisualEvent, 'id' | 'timestamp'>): void;
  /** 注册一个 SSE 客户端，断连时自动移除 */
  addSseClient(client: SseClient): void;
}
