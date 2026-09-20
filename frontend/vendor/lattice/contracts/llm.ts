// Lattice contracts: LLM
//
// 模型通信契约：由 llm 插件实现并 provide 为 ctx.llm。

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: { id: string; name: string; args: any }[];
}

/**
 * LLM 能力契约，兼容 OpenAI / DeepSeek Tool Calling 规范。
 */
export interface LLMService {
  chat(messages: ChatMessage[], tools: any[]): Promise<ChatMessage>;
}
