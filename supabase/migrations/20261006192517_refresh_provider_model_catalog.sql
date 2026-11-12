update public.extension_remote_config
set payload = jsonb_set(
  jsonb_set(
    payload,
    '{providers}',
    $providers$
    {
      "modelscope": {
        "enabled": true,
        "name": "ModelScope (魔搭)",
        "base_url": "https://api-inference.modelscope.cn/v1/",
        "default_model": "Qwen/Qwen3.8-Flash-Next",
        "models": ["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.8-27B", "Qwen/Qwen3.5-397B-A17B", "Qwen/Qwen3.5-122B-A10B", "Qwen/Qwen3.5-35B-A3B", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro", "deepseek-ai/DeepSeek-V4-Pro-0813", "deepseek-ai/DeepSeek-V4-Flash-0731"]
      },
      "zhipu": {
        "enabled": true,
        "name": "智谱 AI",
        "base_url": "https://open.bigmodel.cn/api/paas/v4/",
        "default_model": "glm-5-turbo",
        "models": ["glm-5.2", "glm-5-turbo", "glm-5.1", "glm-5", "glm-4.7", "glm-4.6", "glm-4.5"]
      },
      "gemini": {
        "enabled": true,
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/",
        "default_model": "gemini-3.8-flash",
        "protocol": "google",
        "models": ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
      },
      "openai": {
        "enabled": true,
        "name": "OpenAI / 兼容",
        "base_url": "https://api.openai.com/v1/",
        "default_model": "gpt-6.1-sol",
        "models": ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna", "gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.2", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"]
      },
      "openrouter": {
        "enabled": true,
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1/",
        "default_model": "openrouter/auto",
        "models": ["openrouter/auto", "openrouter/free", "~openai/gpt-latest", "~openai/gpt-mini-latest", "openai/gpt-6.1-sol", "openai/gpt-6-astra", "openai/gpt-6-luna", "openai/gpt-5.5", "openai/gpt-chat-latest", "~anthropic/claude-sonnet-latest", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-opus-4.7", "~google/gemini-pro-latest", "~google/gemini-flash-latest", "google/gemini-3.8-flash", "google/gemini-3.5-flash", "qwen/qwen3.7-max", "deepseek/deepseek-v4-pro", "deepseek/deepseek-v3.2", "moonshotai/kimi-k3", "moonshotai/kimi-k2.6", "z-ai/glm-5.2", "z-ai/glm-5.1", "x-ai/grok-4.3", "x-ai/grok-build-0.1"]
      },
      "deepseek": {
        "enabled": true,
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/",
        "default_model": "deepseek-flash",
        "models": ["deepseek-flash", "deepseek-v4-pro"]
      },
      "kimi": {
        "enabled": true,
        "name": "Moonshot (Kimi)",
        "base_url": "https://api.moonshot.cn/v1/",
        "default_model": "kimi-k3",
        "models": ["kimi-k3", "kimi-k2.6", "kimi-k2.5", "kimi-k2-turbo-preview", "kimi-k2-thinking", "kimi-k2-thinking-turbo", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"]
      },
      "mimo": {
        "enabled": true,
        "name": "小米 MiMo",
        "base_url": "https://api.xiaomimimo.com/v1/",
        "default_model": "mimo-v2.6-flash",
        "header_key": "api-key",
        "models": ["mimo-v2.6-flash", "mimo-v2.6-pro"]
      },
      "claude": {
        "enabled": true,
        "name": "Claude",
        "base_url": "https://api.anthropic.com",
        "default_model": "claude-sonnet-5-5",
        "protocol": "claude",
        "models": ["claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-4-6", "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"]
      }
    }
    $providers$::jsonb,
    true
  ),
  '{model_fallback}',
  $fallback$
  {
    "enabled": true,
    "max_attempts": 4,
    "tasks": {
      "default": ["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro"],
      "summary": ["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro"],
      "segments": ["Qwen/Qwen3.5-27B", "Qwen/Qwen3.8-Flash-Next", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro"],
      "rumors": ["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro"],
      "chat": ["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro"]
    }
  }
  $fallback$::jsonb,
  true
)
where config_key = 'production';
