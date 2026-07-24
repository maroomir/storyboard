import type { AiProviderId } from './ai';

export interface ProviderModelOption {
  readonly id: string;
  readonly displayName: string;
}

export const storyboardModelCatalog = {
  openai: [
    { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 mini' },
    { id: 'gpt-5-mini', displayName: 'GPT-5 mini' },
    { id: 'gpt-5-nano', displayName: 'GPT-5 nano' },
  ],
  claude: [
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
    { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
  ],
  google: [
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite' },
  ],
  ollama: [
    { id: 'llama3.3', displayName: 'Llama 3.3' },
    { id: 'llama3.2', displayName: 'Llama 3.2' },
    { id: 'qwen2.5', displayName: 'Qwen 2.5' },
  ],
  'claude-code': [
    { id: 'sonnet', displayName: 'Claude Code · Sonnet' },
    { id: 'opus', displayName: 'Claude Code · Opus' },
    { id: 'haiku', displayName: 'Claude Code · Haiku' },
  ],
  codex: [
    { id: 'gpt-5.6-sol', displayName: 'Codex · GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', displayName: 'Codex · GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', displayName: 'Codex · GPT-5.6 Luna' },
    { id: 'gpt-5.5', displayName: 'Codex · GPT-5.5' },
    { id: 'gpt-5.4', displayName: 'Codex · GPT-5.4' },
    { id: 'gpt-5.4-mini', displayName: 'Codex · GPT-5.4 mini' },
  ],
  mock: [{ id: 'mock-default', displayName: 'Mock (offline)' }],
} as const satisfies Record<AiProviderId, readonly ProviderModelOption[]>;
