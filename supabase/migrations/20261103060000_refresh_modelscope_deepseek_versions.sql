update public.extension_remote_config
set payload = jsonb_set(
  jsonb_set(
    payload,
    '{providers,modelscope,models}',
    $models$
    [
      "Qwen/Qwen3.8-Flash-Next",
      "Qwen/Qwen3.8-27B",
      "Qwen/Qwen3.5-397B-A17B",
      "Qwen/Qwen3.5-122B-A10B",
      "Qwen/Qwen3.5-35B-A3B",
      "Qwen/Qwen3.5-27B",
      "deepseek-ai/DeepSeek-V4.1-Flash-1017",
      "deepseek-ai/DeepSeek-V4-Pro-0813"
    ]
    $models$::jsonb,
    true
  ),
  '{model_fallback}',
  $fallback$
  {
    "enabled": true,
    "max_attempts": 4,
    "tasks": {
      "default": ["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash-1017", "deepseek-ai/DeepSeek-V4-Pro-0813"],
      "summary": ["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash-1017", "deepseek-ai/DeepSeek-V4-Pro-0813"],
      "segments": ["Qwen/Qwen3.5-27B", "Qwen/Qwen3.8-Flash-Next", "deepseek-ai/DeepSeek-V4.1-Flash-1017", "deepseek-ai/DeepSeek-V4-Pro-0813"],
      "rumors": ["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash-1017", "deepseek-ai/DeepSeek-V4-Pro-0813"],
      "chat": ["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash-1017", "deepseek-ai/DeepSeek-V4-Pro-0813"]
    }
  }
  $fallback$::jsonb,
  true
)
where config_key = 'production';
