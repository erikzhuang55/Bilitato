import { createAppError, createHttpError } from "./appError.js";

function createTimeoutSignal(timeoutMs) {
  const ms = Number(timeoutMs || 0);
  if (!Number.isFinite(ms) || ms <= 0) return { signal: null, cleanup: () => {} };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), ms);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId)
  };
}

async function readErrorText(response) {
  try {
    return await response.text();
  } catch (_) {
    return "";
  }
}

function resolveTimeoutCode(options = {}) {
  const requestName = String(options.requestName || "");
  if (/^supabase_/i.test(requestName) || /feedback/i.test(requestName)) return "NETWORK_REQUEST_TIMEOUT";
  return "NETWORK_REQUEST_TIMEOUT";
}

function resolveNetworkCode(options = {}) {
  const requestName = String(options.requestName || "");
  if (/^supabase_/i.test(requestName) || /feedback/i.test(requestName)) return "FEEDBACK_SERVICE_UNAVAILABLE";
  return "NETWORK_ERROR";
}

function resolveNetworkMessage(options = {}) {
  const requestName = String(options.requestName || "");
  if (/^supabase_/i.test(requestName) || /feedback/i.test(requestName)) return "反馈服务暂时不可用";
  return "网络请求失败";
}

function buildHttpError(response, text, context) {
  const message = context?.errorMessage
    || `HTTP ${response.status}${text ? `: ${text}` : ""}`;
  return createHttpError(response.status, message, {
    method: context?.method || "",
    requestName: context?.requestName || "",
    responseText: text
  });
}

async function parseResponse(response, responseType, context) {
  if (responseType === "none" || response.status === 204) return null;
  if (responseType === "text") return response.text();
  if (responseType === "blob") return response.blob();
  if (responseType === "json") {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      throw createAppError("JSON_PARSE_ERROR", "JSON 解析失败", {
        cause: error,
        method: context?.method || "",
        requestName: context?.requestName || "",
        responseText: text.slice(0, 500)
      });
    }
  }
  return response;
}

export async function httpRequest(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const responseType = options.responseType || "json";
  const timeout = createTimeoutSignal(options.timeoutMs);
  const signal = options.signal || timeout.signal || undefined;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      method,
      signal
    });
    if (!response.ok) {
      throw buildHttpError(response, await readErrorText(response), {
        method,
        requestName: options.requestName,
        errorMessage: options.errorMessage
      });
    }
    const data = await parseResponse(response, responseType, {
      method,
      requestName: options.requestName
    });
    return {
      data,
      response,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    if (error?.name === "AbortError" || error === "timeout" || signal?.aborted) {
      throw createAppError(resolveTimeoutCode(options), options.timeoutMessage || "网络请求超时，请稍后重试", {
        method,
        requestName: options.requestName
      });
    }
    if (error?.code) throw error;
    throw createAppError(resolveNetworkCode(options), error?.message || resolveNetworkMessage(options), {
      cause: error,
      method,
      requestName: options.requestName
    });
  } finally {
    timeout.cleanup();
  }
}

export function requestJson(url, options = {}) {
  return httpRequest(url, { ...options, responseType: "json" });
}

export function requestText(url, options = {}) {
  return httpRequest(url, { ...options, responseType: "text" });
}

export function requestBlob(url, options = {}) {
  return httpRequest(url, { ...options, responseType: "blob" });
}

export function requestNoContent(url, options = {}) {
  return httpRequest(url, { ...options, responseType: "none" });
}
