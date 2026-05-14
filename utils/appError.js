export function normalizeHttpErrorCode(status) {
  const value = Number(status || 0);
  if (value >= 500) return "HTTP_5XX";
  if ([400, 401, 403, 404, 408, 429].includes(value)) return `HTTP_${value}`;
  if (value > 0) return `HTTP_${value}`;
  return "UNKNOWN";
}

export function createAppError(code, message, extra = {}) {
  const error = new Error(message || code || "UNKNOWN");
  error.code = String(code || "UNKNOWN");
  Object.assign(error, extra || {});
  return error;
}

export function createHttpError(status, message, extra = {}) {
  const code = normalizeHttpErrorCode(status);
  return createAppError(code, message || `HTTP ${status}`, {
    status: Number(status || 0),
    ...extra
  });
}

export function serializeAppError(error) {
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || "未知错误"),
    code: String(error?.code || inferErrorCode(error) || ""),
    status: Number(error?.status || 0) || undefined,
    retryAfterSec: Number(error?.retryAfterSec || 0) || undefined,
    stack: String(error?.stack || "")
  };
}

export function inferErrorCode(error) {
  const code = String(error?.code || "").trim();
  if (code) return code;
  const message = String(error?.message || error || "");
  const httpMatch = message.match(/\bHTTP\s+([0-9]{3})\b|API Error\s+([0-9]{3})/i);
  if (httpMatch) return normalizeHttpErrorCode(Number(httpMatch[1] || httpMatch[2]));
  if (/timeout|超时/i.test(message)) return "TIMEOUT";
  if (/network|failed to fetch|网络/i.test(message)) return "NETWORK_ERROR";
  if (/JSON\s*解析失败|json_parse|JSON Parse/i.test(message)) return "JSON_PARSE_ERROR";
  if (/文件大小超出限制|音频过大|too large/i.test(message)) return "ASR_FILE_TOO_LARGE";
  return "";
}
