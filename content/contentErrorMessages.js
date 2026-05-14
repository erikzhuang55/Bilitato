(function () {
    const ERROR_VIEW_MAP = {
        HTTP_401: {
            title: "API Key 无效",
            message: "服务商返回未授权，请检查 API Key 是否正确，或是否选错了 Provider。",
            actionText: "去设置",
            action: "goto-setup-guide",
            presentation: "modal"
        },
        HTTP_403: {
            title: "没有调用权限",
            message: "当前账号可能没有模型权限、额度不足，或服务商拒绝了本次请求。",
            actionText: "去设置",
            action: "goto-setup-guide",
            presentation: "modal"
        },
        HTTP_404: {
            title: "接口或模型不存在",
            message: "请检查模型名称和自定义 API 地址，或确认该模型是否还可用。",
            actionText: "去设置",
            action: "goto-setup-guide",
            presentation: "modal"
        },
        HTTP_429: {
            title: "请求太频繁",
            message: "服务商返回限流或额度上限，请稍等一会儿再试。",
            presentation: "toast"
        },
        HTTP_5XX: {
            title: "模型服务暂时不可用",
            message: "服务商服务器异常，可以稍后重试，或切换 Provider。",
            presentation: "toast"
        },
        TIMEOUT: {
            title: "请求超时",
            message: "当前服务响应较慢，请稍后重试。",
            actionText: "重试",
            action: "retry",
            presentation: "panel"
        },
        NETWORK_ERROR: {
            title: "网络连接失败",
            message: "请检查网络连接，或稍后重试。",
            actionText: "重试",
            action: "retry",
            presentation: "panel"
        },
        JSON_PARSE_ERROR: {
            title: "模型返回格式异常",
            message: "模型没有按预期格式返回结果，请重试，或切换到质量模式/其他模型。",
            actionText: "重试",
            action: "retry",
            presentation: "panel"
        },
        ASR_RATE_LIMIT: {
            title: "转录请求太频繁",
            message: "Groq 返回限流，请等待提示时间后再试。",
            presentation: "toast"
        },
        ASR_FILE_TOO_LARGE: {
            title: "音频过大",
            message: "当前视频音频超过转录服务限制，暂时无法转录。",
            presentation: "panel"
        },
        CLOUD_FAILED: {
            title: "云端缓存暂时不可用",
            message: "云端缓存读取失败，不影响本地继续使用。",
            presentation: "toast"
        },
        DOWNLOAD_FAILED: {
            title: "下载失败",
            message: "下载链接可能已过期，请刷新页面后重试。",
            presentation: "toast"
        }
    };

    function inferErrorCode(errorInput) {
        const code = String(errorInput?.code || "").trim();
        if (code) return code;
        const message = String(errorInput?.message || errorInput || "");
        const httpMatch = message.match(/\bHTTP\s+([0-9]{3})\b|API Error\s+([0-9]{3})/i);
        if (httpMatch) {
            const status = Number(httpMatch[1] || httpMatch[2] || 0);
            if (status >= 500) return "HTTP_5XX";
            return `HTTP_${status}`;
        }
        if (/timeout|超时/i.test(message)) return "TIMEOUT";
        if (/network|failed to fetch|网络/i.test(message)) return "NETWORK_ERROR";
        if (/JSON\s*解析失败|json_parse|JSON Parse|模型返回格式/i.test(message)) return "JSON_PARSE_ERROR";
        if (/限流|rate limit|429/i.test(message) && /groq|转录/i.test(message)) return "ASR_RATE_LIMIT";
        if (/文件大小超出限制|音频过大|too large/i.test(message)) return "ASR_FILE_TOO_LARGE";
        return "UNKNOWN";
    }

    function mapErrorToView(errorInput, fallbackMessage = "请求失败") {
        const code = inferErrorCode(errorInput);
        const base = ERROR_VIEW_MAP[code] || {
            title: "请求失败",
            message: String(errorInput?.message || errorInput || fallbackMessage),
            presentation: "toast"
        };
        return {
            code,
            ...base,
            rawMessage: String(errorInput?.message || errorInput || "")
        };
    }

    function renderErrorPanel(view, retryAction = "") {
        const safe = globalThis.BilitatoContentUtils?.escapeHtml || ((value) => String(value || ""));
        const action = view.action === "retry" && retryAction ? retryAction : view.action;
        const button = action && view.actionText
            ? `<button class="action-btn" data-action="${safe(action)}">${safe(view.actionText)}</button>`
            : "";
        return `
            <div class="page-body subtitle-empty-container">
                <div class="action-container">
                    <p class="action-tip"><strong>${safe(view.title)}</strong><br>${safe(view.message)}</p>
                    ${button}
                </div>
            </div>
        `;
    }

    globalThis.BilitatoContentErrorMessages = {
        ERROR_VIEW_MAP,
        inferErrorCode,
        mapErrorToView,
        renderErrorPanel
    };
})();
