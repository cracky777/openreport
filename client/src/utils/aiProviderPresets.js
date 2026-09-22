// Picking a provider fills the URL the way that provider expects it; every
// field stays editable, which is what makes any compatible server pluggable.
// Shared by the instance's settings (Admin › AI) and a user's own provider.
//
// modelExample is only a placeholder: model names age faster than this file,
// so nothing is ever pre-filled or validated against it.
export const PRESETS = [
  { key: 'anthropic', label: 'Anthropic (Claude)', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', modelExample: 'claude-sonnet-5' },
  { key: 'openai', label: 'OpenAI', provider: 'openai-compat', baseUrl: 'https://api.openai.com/v1', modelExample: 'gpt-4.1' },
  { key: 'mistral', label: 'Mistral', provider: 'openai-compat', baseUrl: 'https://api.mistral.ai/v1', modelExample: 'mistral-large-latest' },
  { key: 'ollama', label: 'Ollama (local)', provider: 'openai-compat', baseUrl: 'http://localhost:11434/v1', modelExample: 'qwen2.5:14b' },
  { key: 'custom', label: 'Other OpenAI-compatible server', provider: 'openai-compat', baseUrl: '', modelExample: 'model-id' },
];

export const presetKeyFor = (cfg) => (
  PRESETS.find((p) => p.provider === cfg.provider && p.baseUrl === cfg.baseUrl) || PRESETS[PRESETS.length - 1]
).key;
