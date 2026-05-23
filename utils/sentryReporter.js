const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|token|secret|password|cookie|prompt|subtitle|content|message|messages|base[_-]?url|download[_-]?url|dsn|url)/i;
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 5;
const IGNORED_ERROR_PATTERNS = [
  /api\s*key/i,
  /请先配置/i,
  /未配置/i,
  /配置.*(缺失|不完整|失败)/i,
  /当前视频暂无字幕/i,
  /无字幕可供分析/i,
  /暂无\s*raw\s*字幕/i,
  /用户取消/i,
  /user\s*cancel/i,
  /未授权访问该自定义\s*api\s*域名/i,
  /缺少自定义\s*api\s*地址/i,
  /自定义\s*provider\s*需要填写\s*base\s*url/i,
  /sentry\s*dsn/i
];

export function shouldReportToSentry(errorInput, context = {}) {
  const message = getErrorMessage(errorInput);
  const code = String(errorInput?.code || context?.code || "").trim().toUpperCase();
  if (["USER_CANCELLED", "CONFIG_REQUIRED", "VALIDATION_ERROR", "MISSING_API_KEY", "MISSING_SUBTITLE"].includes(code)) return false;
  return !IGNORED_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function parseSentryDsn(dsn) {
  const raw = String(dsn || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const projectId = url.pathname.split("/").filter(Boolean).pop();
    const publicKey = url.username;
    if (!url.protocol.startsWith("http") || !url.host || !projectId || !publicKey) return null;
    return {
      dsn: raw,
      endpoint: `${url.origin}/api/${encodeURIComponent(projectId)}/envelope/?sentry_key=${encodeURIComponent(publicKey)}&sentry_version=7`,
      projectId,
      publicKey
    };
  } catch (_) {
    return null;
  }
}

export function sanitizeForSentry(value, depth = 0, key = "") {
  if (SENSITIVE_KEY_PATTERN.test(String(key || ""))) return "[Filtered]";
  if (value == null) return value;
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForSentry(item, depth + 1, key));
  }
  if (typeof value === "object") {
    const result = {};
    Object.entries(value).slice(0, 50).forEach(([childKey, childValue]) => {
      result[childKey] = sanitizeForSentry(childValue, depth + 1, childKey);
    });
    return result;
  }
  return String(value);
}

export function createSentryEvent(errorInput, context = {}, runtime = {}) {
  const error = normalizeError(errorInput);
  const safeContext = sanitizeForSentry(context);
  const errorMeta = resolveErrorMeta(errorInput, safeContext);
  const extensionVersion = String(runtime.extensionVersion || safeContext.extensionVersion || "").trim();
  const provider = String(safeContext.provider || "").trim();
  const task = String(safeContext.task || "").trim();
  const bvid = String(safeContext.bvid || "").trim();
  const pageType = String(safeContext.pageType || "").trim();

  return {
    event_id: createEventId(),
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: "error",
    release: extensionVersion ? `bilitato@${extensionVersion}` : undefined,
    environment: String(runtime.environment || "production"),
    tags: removeEmpty({
      extension_version: extensionVersion,
      provider,
      task,
      bvid,
      code: errorMeta.code,
      status: errorMeta.status,
      page_type: pageType,
      source: safeContext.source,
      manifest_version: runtime.manifestVersion
    }),
    user: {
      id: "anonymous"
    },
    contexts: {
      runtime: removeEmpty({
        extensionVersion,
        manifestVersion: runtime.manifestVersion,
        language: runtime.language,
        userAgent: runtime.userAgent
      }),
      platform: removeEmpty(runtime.platform || {})
    },
    extra: {
      ...safeContext,
      code: errorMeta.code || safeContext.code,
      status: errorMeta.status || safeContext.status,
      retryAfterSec: errorMeta.retryAfterSec || safeContext.retryAfterSec
    },
    exception: {
      values: [{
        type: error.name || "Error",
        value: error.message || "Unknown error",
        stacktrace: error.stack ? { frames: parseStackFrames(error.stack) } : undefined
      }]
    }
  };
}

export async function reportToSentry(settings, errorInput, context = {}, runtime = {}, fetchImpl = globalThis.fetch) {
  const enabled = !!settings?.sentryEnabled;
  const parsed = parseSentryDsn(settings?.sentryDsn);
  if (!enabled || !parsed || typeof fetchImpl !== "function") {
    return { sent: false, reason: enabled ? "invalid_dsn" : "disabled" };
  }
  if (!shouldReportToSentry(errorInput, context)) {
    return { sent: false, reason: "ignored" };
  }
  const event = createSentryEvent(errorInput, context, runtime);
  const envelope = buildEnvelope(parsed.dsn, event);
  const res = await fetchImpl(parsed.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope" },
    body: envelope,
    keepalive: true
  });
  return { sent: !!res?.ok, status: Number(res?.status || 0), eventId: event.event_id };
}

function buildEnvelope(dsn, event) {
  return [
    JSON.stringify({ dsn, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event)
  ].join("\n");
}

function normalizeError(errorInput) {
  if (errorInput instanceof Error) {
    const error = new Error(scrubText(errorInput.message || "Unknown error"));
    error.name = errorInput.name || "Error";
    if (errorInput.stack) error.stack = scrubText(errorInput.stack);
    return error;
  }
  if (errorInput && typeof errorInput === "object") {
    const error = new Error(scrubText(errorInput.message || errorInput.error || "Unknown error"));
    error.name = String(errorInput.name || "Error");
    if (errorInput.stack) error.stack = scrubText(errorInput.stack);
    return error;
  }
  return new Error(scrubText(errorInput || "Unknown error"));
}

function resolveErrorMeta(errorInput, context = {}) {
  const status = Number(errorInput?.status || context?.status || 0) || undefined;
  const retryAfterSec = Number(errorInput?.retryAfterSec || context?.retryAfterSec || 0) || undefined;
  const explicitCode = String(errorInput?.code || context?.code || "").trim();
  const inferredCode = explicitCode || inferCodeFromMessage(getErrorMessage(errorInput));
  return {
    code: inferredCode,
    status,
    retryAfterSec
  };
}

function inferCodeFromMessage(message) {
  const text = String(message || "");
  const httpMatch = text.match(/\bHTTP\s+([0-9]{3})\b|API Error\s+([0-9]{3})/i);
  if (httpMatch) {
    const status = Number(httpMatch[1] || httpMatch[2] || 0);
    if (status >= 500) return "HTTP_5XX";
    return status > 0 ? `HTTP_${status}` : "";
  }
  if (/timeout|超时/i.test(text)) return "TIMEOUT";
  if (/network|failed to fetch|网络/i.test(text)) return "NETWORK_ERROR";
  if (/JSON\s*解析失败|json_parse|JSON Parse/i.test(text)) return "JSON_PARSE_ERROR";
  if (/限流|rate limit/i.test(text) && /groq|转录/i.test(text)) return "ASR_RATE_LIMIT";
  if (/文件大小超出限制|音频过大|too large/i.test(text)) return "ASR_FILE_TOO_LARGE";
  return "";
}

function getErrorMessage(errorInput) {
  if (errorInput instanceof Error) return String(errorInput.message || "");
  if (errorInput && typeof errorInput === "object") return String(errorInput.message || errorInput.error || "");
  return String(errorInput || "");
}

function scrubText(value) {
  return String(value || "")
    .replace(/(sk|gsk|sk-proj)-[A-Za-z0-9_-]{8,}/g, "$1-[Filtered]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [Filtered]")
    .replace(/https?:\/\/\S+/gi, "[FilteredUrl]");
}

function parseStackFrames(stack) {
  return String(stack || "")
    .split("\n")
    .slice(1, 30)
    .map((line) => ({ function: line.trim() }))
    .reverse();
}

function createEventId() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32).padEnd(32, "0");
}

function removeEmpty(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== "")
  );
}
