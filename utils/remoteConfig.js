const DEFAULT_FEATURE_FLAGS = Object.freeze({
  summary_empty_retry: true,
  segments_local_json_repair: true,
  segments_ai_json_repair: true,
  segments_primary_retry: true,
  segments_compact_retry: true,
  segments_expanded_tokens_retry: true,
  modelscope_model_fallback: true,
});

const DEFAULT_MODELSCOPE_FALLBACK = Object.freeze({
  enabled: true,
  maxAttempts: 4,
  tasks: Object.freeze({
    default: Object.freeze(["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro"]),
    summary: Object.freeze(["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro"]),
    segments: Object.freeze(["Qwen/Qwen3.5-27B", "Qwen/Qwen3.8-Flash-Next", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro"]),
    rumors: Object.freeze(["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro"]),
    chat: Object.freeze(["Qwen/Qwen3.8-Flash-Next", "Qwen/Qwen3.5-27B", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Pro"]),
  }),
});

const REQUEST_POLICY_TASKS = new Set(["summary", "segments", "summary_segments_merged", "rumors", "chat"]);
const REQUEST_POLICY_MODES = new Set(["provider_default", "disabled", "none", "low", "medium", "high"]);
const REQUEST_POLICY_TRANSPORTS = new Set([
  "provider_default",
  "reasoning_effort",
  "openrouter_reasoning",
  "gemini_thinking",
  "claude_effort",
  "enable_thinking",
  "thinking_type",
  "chat_template_enable_thinking",
]);

const DEFAULT_REQUEST_POLICIES = Object.freeze({
  schemaVersion: 1,
  enabled: true,
  rules: Object.freeze([]),
});

export const DEFAULT_REMOTE_CONFIG = Object.freeze({
  configKey: "production",
  revision: 0,
  updatedAt: "",
  featureFlags: DEFAULT_FEATURE_FLAGS,
  providers: {},
  asr: {},
  modelFallback: DEFAULT_MODELSCOPE_FALLBACK,
  requestPolicies: DEFAULT_REQUEST_POLICIES,
});

export const REMOTE_CONFIG_CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export function isRemoteConfigCacheFresh(
  fetchedAt,
  now = Date.now(),
  maxAgeMs = REMOTE_CONFIG_CACHE_MAX_AGE_MS,
) {
  const fetched = Number(fetchedAt || 0);
  const current = Number(now || 0);
  const maxAge = Number(maxAgeMs || 0);
  return fetched > 0
    && current >= fetched
    && maxAge > 0
    && current - fetched < maxAge;
}

function cleanText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanHttpsUrl(value) {
  const input = cleanText(value, 500);
  if (!input) return "";
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function cleanModels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 200)).filter(Boolean))].slice(0, 120);
}

function normalizeProvider(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const protocol = cleanText(value.protocol || value.type, 20).toLowerCase();
  const headerKey = cleanText(value.header_key || value.headerKey, 40);
  return {
    enabled: value.enabled !== false,
    name: cleanText(value.name, 80),
    baseUrl: cleanHttpsUrl(value.base_url || value.baseUrl),
    model: cleanText(value.default_model || value.model, 200),
    models: cleanModels(value.models),
    regUrl: cleanHttpsUrl(value.reg_url || value.regUrl),
    type: ["openai", "claude", "google"].includes(protocol) ? protocol : "",
    headerKey: ["Authorization", "api-key"].includes(headerKey) ? headerKey : "",
    tokenPrefix: cleanText(value.token_prefix || value.tokenPrefix, 20),
  };
}

function normalizeProviderMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, provider]) => {
    const normalizedKey = cleanText(key, 50).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    return [normalizedKey, normalizeProvider(provider)];
  }).filter(([key, provider]) => key && provider));
}

function normalizeFeatureFlags(value) {
  const incoming = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_FEATURE_FLAGS).map(([key, fallback]) => [
    key,
    Object.prototype.hasOwnProperty.call(incoming, key) ? incoming[key] !== false : fallback,
  ]));
}

function normalizeModelFallback(value = {}) {
  const incoming = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const incomingTasks = incoming.tasks && typeof incoming.tasks === "object" && !Array.isArray(incoming.tasks)
    ? incoming.tasks
    : {};
  const tasks = Object.fromEntries(Object.entries(DEFAULT_MODELSCOPE_FALLBACK.tasks).map(([task, fallback]) => {
    const models = cleanModels(incomingTasks[task]);
    return [task, models.length ? models : [...fallback]];
  }));
  return {
    enabled: incoming.enabled !== false,
    maxAttempts: Math.min(6, Math.max(1, Math.floor(Number(
      incoming.max_attempts ?? incoming.maxAttempts ?? DEFAULT_MODELSCOPE_FALLBACK.maxAttempts,
    )) || DEFAULT_MODELSCOPE_FALLBACK.maxAttempts)),
    tasks,
  };
}

function normalizeRequestPolicies(value = {}) {
  const incoming = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const schemaVersion = Math.max(0, Math.floor(Number(incoming.schema_version ?? incoming.schemaVersion ?? 1)) || 1);
  if (schemaVersion !== 1) return { schemaVersion, enabled: false, rules: [] };
  const rules = (Array.isArray(incoming.rules) ? incoming.rules : []).slice(0, 100).map((rule) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
    const id = cleanText(rule.id, 80);
    const provider = cleanText(rule.provider, 50).toLowerCase().replace(/[^a-z0-9_*-]/g, "");
    const modelPattern = cleanText(rule.model_pattern || rule.modelPattern, 200);
    const tasks = [...new Set((Array.isArray(rule.tasks) ? rule.tasks : [])
      .map((task) => cleanText(task, 40).toLowerCase())
      .filter((task) => REQUEST_POLICY_TASKS.has(task)))];
    const reasoning = rule.reasoning && typeof rule.reasoning === "object" && !Array.isArray(rule.reasoning)
      ? rule.reasoning
      : rule;
    const mode = cleanText(reasoning.mode, 30).toLowerCase();
    const transport = cleanText(reasoning.transport, 50).toLowerCase();
    const validModeTransport = (
      (mode === "provider_default" && transport === "provider_default")
      || (mode === "disabled" && ["reasoning_effort", "enable_thinking", "thinking_type", "chat_template_enable_thinking"].includes(transport))
      || (["none", "low", "medium", "high"].includes(mode)
        && ["reasoning_effort", "openrouter_reasoning", "gemini_thinking", "claude_effort"].includes(transport))
    );
    try {
      if (!id || !provider || !modelPattern || !tasks.length || !REQUEST_POLICY_MODES.has(mode)
        || !REQUEST_POLICY_TRANSPORTS.has(transport) || !validModeTransport) return null;
      new RegExp(modelPattern, "i");
    } catch {
      return null;
    }
    return { id, provider, modelPattern, tasks, mode, transport };
  }).filter(Boolean);
  return {
    schemaVersion,
    enabled: incoming.enabled !== false,
    rules,
  };
}

export function normalizeRemoteConfigRow(row = {}) {
  const payload = row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : row && typeof row === "object" && !Array.isArray(row) ? row : {};
  return {
    configKey: cleanText(row.config_key || row.configKey || "production", 80) || "production",
    revision: Math.max(0, Math.floor(Number(row.revision || 0)) || 0),
    updatedAt: cleanText(row.updated_at || row.updatedAt, 80),
    featureFlags: normalizeFeatureFlags(payload.feature_flags || payload.featureFlags),
    providers: normalizeProviderMap(payload.providers),
    asr: normalizeProviderMap(payload.asr),
    modelFallback: normalizeModelFallback(payload.model_fallback || payload.modelFallback),
    requestPolicies: normalizeRequestPolicies(payload.request_policies || payload.requestPolicies),
  };
}

export function buildEffectiveProviderCatalog(staticProviders = {}, remoteConfig = {}, currentProvider = "") {
  const remoteProviders = remoteConfig?.providers && typeof remoteConfig.providers === "object"
    ? remoteConfig.providers
    : {};
  const keys = new Set([...Object.keys(staticProviders || {}), ...Object.keys(remoteProviders)]);
  const currentKey = cleanText(currentProvider, 50).toLowerCase();
  const result = {};
  keys.forEach((key) => {
    const baked = staticProviders?.[key] && typeof staticProviders[key] === "object" ? staticProviders[key] : {};
    const remote = remoteProviders?.[key] && typeof remoteProviders[key] === "object" ? remoteProviders[key] : null;
    if (remote?.enabled === false && key !== currentKey) return;
    const merged = {
      ...baked,
      ...(remote?.name ? { name: remote.name } : {}),
      ...(remote?.baseUrl ? { baseUrl: remote.baseUrl } : {}),
      ...(remote?.model ? { model: remote.model } : {}),
      ...(remote?.models?.length ? { models: [...remote.models] } : {}),
      ...(remote?.regUrl ? { regUrl: remote.regUrl } : {}),
      ...(remote?.type ? { type: remote.type === "openai" ? undefined : remote.type } : {}),
      ...(remote?.headerKey ? { headerKey: remote.headerKey } : {}),
      ...(remote?.tokenPrefix ? { tokenPrefix: remote.tokenPrefix } : {}),
      ...(remote?.enabled === false ? { disabled: true } : {}),
    };
    if (!merged.name) merged.name = key;
    if (merged.baseUrl || key === "custom" || baked.baseUrl !== undefined) result[key] = merged;
  });
  if (!result.custom && staticProviders?.custom) result.custom = { ...staticProviders.custom };
  return result;
}

export function isRemoteFeatureEnabled(remoteConfig, key, fallback = true) {
  const flags = remoteConfig?.featureFlags;
  if (!flags || !Object.prototype.hasOwnProperty.call(flags, key)) return fallback;
  return flags[key] !== false;
}
