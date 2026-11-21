update public.extension_remote_config
set payload = jsonb_set(
  payload,
  '{providers}',
  (payload -> 'providers') || jsonb_build_object(
    'zhipu', (payload #> '{providers,zhipu}') || jsonb_build_object('models', '["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5-turbo", "glm-5.1", "glm-5", "glm-4.7", "glm-4.6", "glm-4.5"]'::jsonb),
    'gemini', (payload #> '{providers,gemini}') || jsonb_build_object('models', '["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-flash-lite"]'::jsonb),
    'openai', (payload #> '{providers,openai}') || jsonb_build_object('models', '["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra", "gpt-6-luna", "gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.2"]'::jsonb),
    'openrouter', (payload #> '{providers,openrouter}') || jsonb_build_object('models', '["openrouter/auto", "openrouter/free", "~openai/gpt-latest", "~openai/gpt-mini-latest", "openai/gpt-6.2-sol", "openai/gpt-6.1-sol", "openai/gpt-6-astra", "openai/gpt-6-luna", "openai/gpt-5.5", "openai/gpt-chat-latest", "~anthropic/claude-sonnet-latest", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-opus-4.7", "~google/gemini-pro-latest", "~google/gemini-flash-latest", "google/gemini-4-neon", "google/gemini-3.8-flash", "qwen/qwen3.7-max", "deepseek/deepseek-v4-pro", "deepseek/deepseek-v3.2", "moonshotai/kimi-k3", "moonshotai/kimi-k3.1-pro", "z-ai/glm-5.2", "z-ai/glm-5.1", "x-ai/grok-4.3", "x-ai/grok-build-0.1"]'::jsonb),
    'kimi', (payload #> '{providers,kimi}') || jsonb_build_object('models', '["kimi-k3"]'::jsonb),
    'claude', (payload #> '{providers,claude}') || jsonb_build_object('models', '["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-2", "claude-sonnet-4-6", "claude-opus-4-5", "claude-haiku-4-5"]'::jsonb)
  ),
  true
)
where config_key = 'production';
