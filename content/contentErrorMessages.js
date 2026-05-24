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
        HTTP_400: {
            title: "请求参数有误",
            message: "服务商返回参数错误，常见原因是模型 ID 填写不正确、模型已下线，或当前接口不支持该模型。",
            actionText: "去设置",
            action: "goto-setup-guide",
            presentation: "panel"
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
            actionText: "重试",
            action: "retry",
            presentation: "toast"
        },
        HTTP_5XX: {
            title: "模型服务暂时不可用",
            message: "服务商服务器异常，可以稍后重试，或切换 Provider。",
            actionText: "重试",
            action: "retry",
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
            message: "模型没有按预期格式返回结果，请重试，或切换到高速模式/其他模型。",
            actionText: "重试",
            action: "retry",
            presentation: "panel"
        },
        SEGMENTS_EMPTY_RESPONSE: {
            title: "模型没有返回分段内容",
            message: "服务商返回成功，但没有返回可用正文。免费路由或推理模型可能把输出额度用于思考内容，请重试或切换非 Thinking 模型。",
            actionText: "重试分段",
            action: "retry",
            secondaryActionText: "切换模型",
            secondaryAction: "goto-setup-guide",
            presentation: "panel"
        },
        SEGMENTS_JSON_PARSE_FAILED: {
            title: "分段格式解析失败",
            message: "模型返回了内容，但不是可解析的分段 JSON。请重试，或切换到更稳定的模型。",
            actionText: "重试分段",
            action: "retry",
            secondaryActionText: "切换模型",
            secondaryAction: "goto-setup-guide",
            presentation: "panel"
        },
        SEGMENTS_EMPTY_LIST: {
            title: "模型没有生成有效分段",
            message: "模型返回了空分段列表。请重试；如果使用省流模式，可以切换到高速模式分开生成。",
            actionText: "重试分段",
            action: "retry",
            secondaryActionText: "切换模式",
            secondaryAction: "goto-setup-guide",
            presentation: "panel"
        },
        SEGMENTS_INVALID_SCHEMA: {
            title: "分段字段不完整",
            message: "模型返回了 JSON，但缺少 start/end、start_line/end_line 或标题等必要字段。请重试或切换模型。",
            actionText: "重试分段",
            action: "retry",
            secondaryActionText: "切换模型",
            secondaryAction: "goto-setup-guide",
            presentation: "panel"
        },
        SEGMENTS_CONTEXT_TOO_LONG: {
            title: "字幕内容过长",
            message: "当前字幕或提示词超过模型上下文限制。请切换长上下文模型，或换用省流/高速策略后重试。",
            actionText: "去设置",
            action: "goto-setup-guide",
            secondaryActionText: "重试",
            secondaryAction: "retry",
            presentation: "panel"
        },
        SEGMENTS_OUTPUT_TRUNCATED: {
            title: "分段输出被截断",
            message: "模型输出到长度上限前没有完成分段 JSON。请切换更长输出模型，或重试。",
            actionText: "去设置",
            action: "goto-setup-guide",
            secondaryActionText: "重试",
            secondaryAction: "retry",
            presentation: "panel"
        },
        SEGMENTS_MISSING_PROTOCOL: {
            title: "模型漏掉了分段部分",
            message: "省流模式要求同时返回总结和分段，但模型没有返回分段区块。请重试，或切换到高速模式。",
            actionText: "重试分段",
            action: "retry",
            secondaryActionText: "切换模式",
            secondaryAction: "goto-setup-guide",
            presentation: "panel"
        },
        SEGMENTS_LINE_MAPPING_FAILED: {
            title: "分段时间轴映射失败",
            message: "模型返回的行号无法对应字幕时间轴。请重试；如果字幕本身异常，可以重新生成字幕。",
            actionText: "重试分段",
            action: "retry",
            secondaryActionText: "去生成字幕",
            secondaryAction: "goto-cc-tab",
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
        SUBTITLE_MISSING: {
            title: "请求失败",
            message: "未获取到视频字幕，请刷新页面后重试。",
            actionText: "刷新",
            action: "refresh-page",
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
        if (/字幕内容过长|context length|maximum context|max context|too many tokens|prompt too long|input too long|context_length_exceeded/i.test(message)) return "SEGMENTS_CONTEXT_TOO_LONG";
        if (/模型没有返回分段内容|返回为空|response_chars.?0|has_text.?false/i.test(message)) return "SEGMENTS_EMPTY_RESPONSE";
        if (/分段输出被截断|输出被截断|truncated|max_tokens|finish_reason.?length/i.test(message)) return "SEGMENTS_OUTPUT_TRUNCATED";
        if (/模型漏掉了分段部分|分段输出缺失|分段.*缺失|missing.*segments/i.test(message)) return "SEGMENTS_MISSING_PROTOCOL";
        if (/分段字段不完整|invalid schema|schema/i.test(message)) return "SEGMENTS_INVALID_SCHEMA";
        if (/模型没有生成有效分段|空分段|empty list/i.test(message)) return "SEGMENTS_EMPTY_LIST";
        if (/分段.*(?:格式|JSON|解析)|segments.*(?:json|parse)|模型返回分段格式/i.test(message)) return "SEGMENTS_JSON_PARSE_FAILED";
        if (/JSON\s*解析失败|json_parse|JSON Parse|模型返回格式/i.test(message)) return "JSON_PARSE_ERROR";
        if (/限流|rate limit|429/i.test(message) && /groq|转录/i.test(message)) return "ASR_RATE_LIMIT";
        if (/文件大小超出限制|音频过大|too large/i.test(message)) return "ASR_FILE_TOO_LARGE";
        if (/未获取到视频字幕|无字幕可供分析|当前视频暂无字幕|未检测到字幕/i.test(message)) return "SUBTITLE_MISSING";
        return "UNKNOWN";
    }

    function mapErrorToView(errorInput, fallbackMessage = "请求失败", context = {}) {
        const code = inferErrorCode(errorInput);
        const base = ERROR_VIEW_MAP[code] || {
            title: "请求失败",
            message: String(errorInput?.message || errorInput || fallbackMessage),
            presentation: "toast"
        };
        const view = {
            code,
            ...base,
            rawMessage: String(errorInput?.message || errorInput || "")
        };
        if (code === "UNKNOWN" && context?.surface === "panel") {
            view.presentation = "panel";
        }
        const provider = String(context?.provider || errorInput?.provider || "").toLowerCase();
        if (code === "HTTP_401" && provider === "modelscope") {
            view.extraMessage = "请务必确保您的 ModelScope 账号已绑定阿里云！";
            view.helper = {
                type: "modelscope-bind",
                url: "https://modelscope.cn/my/settings/account"
            };
            view.actionText = "修改 API";
            view.secondaryActionText = "重试";
            view.secondaryAction = "retry";
        }
        if (view.presentation !== "toast" && view.action !== "retry" && view.secondaryAction !== "retry") {
            view.secondaryActionText = "重试";
            view.secondaryAction = "retry";
        }
        return view;
    }

    function renderErrorPanel(view, retryAction = "") {
        const safe = globalThis.BilitatoContentUtils?.escapeHtml || ((value) => String(value || ""));
        const action = view.action === "retry" && retryAction ? retryAction : view.action;
        const primaryButton = action && view.actionText
            ? `<button class="action-btn" data-action="${safe(action)}">${safe(view.actionText)}</button>`
            : "";
        const secondaryAction = view.secondaryAction === "retry" && retryAction ? retryAction : view.secondaryAction;
        const secondaryButton = secondaryAction && view.secondaryActionText
            ? `<button class="action-btn ghost" data-action="${safe(secondaryAction)}">${safe(view.secondaryActionText)}</button>`
            : "";
        const extraMessage = view.extraMessage
            ? `<div class="error-extra-message">${safe(view.extraMessage)}</div>`
            : "";
        const aliyunImageUrl = globalThis.chrome?.runtime?.getURL
            ? globalThis.chrome.runtime.getURL("assets/ui/aliyun.png")
            : "assets/ui/aliyun.png";
        const helper = view.helper?.type === "modelscope-bind"
            ? `<div class="modelscope-bind-hint">
                    <img class="modelscope-bind-image" src="${safe(aliyunImageUrl)}" alt="ModelScope 绑定阿里云账号示意">
                    <button class="modelscope-bind-open" type="button" data-action="open-external-url" data-url="${safe(view.helper.url || "")}">打开 ModelScope 账号设置</button>
                </div>`
            : "";
        const buttons = primaryButton || secondaryButton
            ? `<div class="error-actions">${primaryButton}${secondaryButton}</div>`
            : "";
        return `
            <div class="page-body subtitle-empty-container error-empty-container">
                <div class="action-container error-panel-card">
                    <div class="action-tip error-panel-copy"><strong>${safe(view.title)}</strong><span>${safe(view.message)}</span></div>
                    ${extraMessage}
                    ${helper}
                    ${buttons}
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
