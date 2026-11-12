export function createProviderRequestTiming({
  controller,
  timeoutMs,
  stopTimeoutOnFirstResponse = false,
  now = () => globalThis.performance?.now?.() ?? Date.now()
} = {}) {
  const enqueuedAt = now();
  let requestStartedAt = null;
  let responseHeadersAt = null;
  let firstStreamEventAt = null;
  let firstResponseAt = null;
  let timeoutId = null;

  function clearRequestTimeout() {
    if (timeoutId === null) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  }

  function startRequest() {
    if (requestStartedAt !== null) return snapshot();
    requestStartedAt = now();
    timeoutId = setTimeout(() => {
      controller?.abort?.("timeout");
    }, Math.max(0, Number(timeoutMs || 0)));
    return snapshot();
  }

  function markFirstResponse() {
    if (firstResponseAt === null) firstResponseAt = now();
    if (stopTimeoutOnFirstResponse) clearRequestTimeout();
    return snapshot();
  }

  function markResponseHeaders() {
    if (responseHeadersAt === null) responseHeadersAt = now();
    return snapshot();
  }

  function markFirstStreamEvent() {
    if (firstStreamEventAt === null) firstStreamEventAt = now();
    return snapshot();
  }

  function extendTimeout(nextTimeoutMs) {
    if (requestStartedAt === null || controller?.signal?.aborted) return snapshot();
    const totalTimeoutMs = Math.max(0, Number(nextTimeoutMs || 0));
    const elapsedMs = Math.max(0, now() - requestStartedAt);
    clearRequestTimeout();
    timeoutId = setTimeout(() => {
      controller?.abort?.("timeout");
    }, Math.max(0, totalTimeoutMs - elapsedMs));
    return snapshot();
  }

  function snapshot() {
    const current = now();
    return {
      queueWaitMs: requestStartedAt === null
        ? undefined
        : Math.max(0, Math.round(requestStartedAt - enqueuedAt)),
      providerRequestMs: requestStartedAt === null
        ? undefined
        : Math.max(0, Math.round(current - requestStartedAt)),
      responseHeadersMs: requestStartedAt === null || responseHeadersAt === null
        ? undefined
        : Math.max(0, Math.round(responseHeadersAt - requestStartedAt)),
      firstStreamEventMs: requestStartedAt === null || firstStreamEventAt === null
        ? undefined
        : Math.max(0, Math.round(firstStreamEventAt - requestStartedAt)),
      firstResponseMs: requestStartedAt === null || firstResponseAt === null
        ? undefined
        : Math.max(0, Math.round(firstResponseAt - requestStartedAt)),
      firstVisibleTextMs: requestStartedAt === null || firstResponseAt === null
        ? undefined
        : Math.max(0, Math.round(firstResponseAt - requestStartedAt))
    };
  }

  return {
    startRequest,
    markResponseHeaders,
    markFirstStreamEvent,
    markFirstResponse,
    extendTimeout,
    snapshot,
    finish: clearRequestTimeout
  };
}
