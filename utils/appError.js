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
  if (/(?:invalid|incorrect|wrong|bad|expired|missing)\s+(?:api\s*)?key|api\s*key\s+(?:is\s+)?(?:invalid|incorrect|wrong|expired|missing)|invalid_api_key|unauthorized api key|authentication.*(?:failed|invalid)|鉴权失败|认证失败|密钥.*(?:无效|错误|过期)|API\s*Key.*(?:无效|错误|过期|不正确)|令牌.*(?:无效|错误|过期)/i.test(message)) return "HTTP_401";
  if (/User location is not supported for the API use|location is not supported|unsupported.*location|地区.*不支持|所在地.*不支持/i.test(message)) return "API_LOCATION_UNSUPPORTED";
  const httpMatch = message.match(/\bHTTP\s+([0-9]{3})\b|API Error\s+([0-9]{3})/i);
  if (httpMatch) return normalizeHttpErrorCode(Number(httpMatch[1] || httpMatch[2]));
  if (/timeout|超时/i.test(message)) return "TIMEOUT";
  if (/network|failed to fetch|网络/i.test(message)) return "NETWORK_ERROR";
  if (/模型没有返回总结内容|总结生成为空|summary_empty|SUMMARY_EMPTY/i.test(message)) return "SUMMARY_EMPTY_RESPONSE";
  if (/字幕内容过长|context length|maximum context|max context|too many tokens|prompt too long|input too long|context_length_exceeded/i.test(message)) return "SEGMENTS_CONTEXT_TOO_LONG";
  if (/模型没有返回分段内容|返回为空|response_chars.?0|has_text.?false/i.test(message)) return "SEGMENTS_EMPTY_RESPONSE";
  if (/分段输出被截断|输出被截断|truncated|max_tokens|finish_reason.?length/i.test(message)) return "SEGMENTS_OUTPUT_TRUNCATED";
  if (/模型漏掉了分段部分|分段输出缺失|分段.*缺失|missing.*segments/i.test(message)) return "SEGMENTS_MISSING_PROTOCOL";
  if (/分段字段不完整|invalid schema|schema/i.test(message)) return "SEGMENTS_INVALID_SCHEMA";
  if (/模型没有生成有效分段|空分段|empty list/i.test(message)) return "SEGMENTS_EMPTY_LIST";
  if (/分段.*(?:格式|JSON|解析)|segments.*(?:json|parse)|模型返回分段格式/i.test(message)) return "SEGMENTS_JSON_PARSE_FAILED";
  if (/JSON\s*解析失败|json_parse|JSON Parse/i.test(message)) return "JSON_PARSE_ERROR";
  if (/文件大小超出限制|音频过大|too large/i.test(message)) return "ASR_FILE_TOO_LARGE";
  return "";
}
