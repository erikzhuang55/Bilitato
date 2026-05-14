(function () {
    const IGNORED_ERROR_PATTERNS = [
        /api\s*key/i,
        /请先配置/i,
        /未配置/i,
        /配置.*(缺失|不完整|失败)/i,
        /当前视频暂无字幕/i,
        /暂无\s*raw\s*字幕/i,
        /用户取消/i,
        /user\s*cancel/i,
        /未授权访问该自定义\s*api\s*域名/i,
        /缺少自定义\s*api\s*地址/i,
        /自定义\s*provider\s*需要填写\s*base\s*url/i,
        /sentry\s*dsn/i
    ];

    function normalizeError(errorInput) {
        if (errorInput instanceof Error) {
            return {
                name: errorInput.name || "Error",
                message: errorInput.message || "Unknown error",
                code: String(errorInput.code || ""),
                status: Number(errorInput.status || 0) || undefined,
                retryAfterSec: Number(errorInput.retryAfterSec || 0) || undefined,
                stack: errorInput.stack || ""
            };
        }
        if (errorInput && typeof errorInput === "object") {
            return {
                name: String(errorInput.name || "Error"),
                message: String(errorInput.message || errorInput.error || "Unknown error"),
                code: String(errorInput.code || ""),
                status: Number(errorInput.status || 0) || undefined,
                retryAfterSec: Number(errorInput.retryAfterSec || 0) || undefined,
                stack: String(errorInput.stack || "")
            };
        }
        return {
            name: "Error",
            message: String(errorInput || "Unknown error"),
            stack: ""
        };
    }

    function shouldReportContentError(errorInput, context = {}) {
        const normalized = normalizeError(errorInput);
        const code = String(errorInput?.code || context?.code || "").trim().toUpperCase();
        if (["USER_CANCELLED", "CONFIG_REQUIRED", "VALIDATION_ERROR", "MISSING_API_KEY", "MISSING_SUBTITLE"].includes(code)) return false;
        return !IGNORED_ERROR_PATTERNS.some((pattern) => pattern.test(normalized.message));
    }

    function buildPageContext(extra = {}) {
        const state = globalThis.BilitatoAppState || {};
        const cache = state.cache || {};
        const path = String(globalThis.location?.pathname || "");
        return {
            source: "content",
            pageType: path.includes("/list/") ? "list" : "video",
            bvid: state.injectBvid || state.tabState?.activeBvid || "",
            provider: state.settings?.provider || "",
            hasSubtitle: Array.isArray(cache.rawSubtitle) && cache.rawSubtitle.length > 0,
            subtitleCount: Array.isArray(cache.rawSubtitle) ? cache.rawSubtitle.length : 0,
            asrEnabled: !!String(state.settings?.groqApiKey || "").trim(),
            ...extra
        };
    }

    function reportContentError(errorInput, context = {}) {
        try {
            if (!shouldReportContentError(errorInput, context)) {
                return Promise.resolve({ ok: false, ignored: true });
            }
            const runtime = globalThis.chrome?.runtime;
            if (!runtime?.sendMessage) return Promise.resolve({ ok: false });
            return runtime.sendMessage({
                action: "REPORT_ERROR",
                error: normalizeError(errorInput),
                context: buildPageContext(context)
            }).catch(() => ({ ok: false }));
        } catch (_) {
            return Promise.resolve({ ok: false });
        }
    }

    if (globalThis.window?.addEventListener) {
        window.addEventListener("error", (event) => {
            reportContentError(event.error || event.message, {
                task: "global_error",
                source: "content_window_error"
            });
        });

        window.addEventListener("unhandledrejection", (event) => {
            reportContentError(event.reason || "Unhandled rejection", {
                task: "global_rejection",
                source: "content_unhandled_rejection"
            });
        });
    }

    globalThis.BilitatoContentErrorReporter = {
        buildPageContext,
        normalizeError,
        reportContentError,
        shouldReportContentError
    };
})();
