(function () {
    const ERROR_VIEW_MAP = {
        HTTP_401: {
            title: "API Key 无效",
            message: "服务商返回未授权，请检查 API Key 是否正确，或是否选错了 Provider。",
            actionText: "去设置",
            action: "goto-setup-guide",
            presentation: "modal"
        },
        ALIYUN_REALNAME_REQUIRED: {
            title: "阿里云账号未实名",
            message: "当前 Provider 要求关联的阿里云账号先完成实名认证。完成实名后再重试，或切换到其他 Provider。",
            actionText: "去设置",
            action: "goto-setup-guide",
            presentation: "panel"
        },
        HTTP_403: {
            title: "没有调用权限",
            message: "当前账号可能没有模型权限、额度不足，或服务商拒绝了本次请求。",
            actionText: "去设置",
            action: "goto-setup-guide",
            presentation: "modal"
        },
        MODEL_ACCESS_DENIED: {
            title: "模型没有访问权限",
            message: "当前账号没有权限使用这个模型，或该模型是私有模型。请切换模型、检查账号权限，或更换 Provider。",
            actionText: "去设置",
            action: "goto-setup-guide",
            presentation: "panel"
        },
        ASR_FORBIDDEN: {
            title: "当前转录服务不可用",
            message: "转录服务拒绝了本次请求，常见原因是账号权限不足、接口受限，或当前服务不支持这个请求。请稍后重试，或切换转录 Provider。",
            actionText: "去设置",
            action: "goto-setup-guide",
            presentation: "panel"
        },
        API_LOCATION_UNSUPPORTED: {
            title: "当前地区暂不支持",
            message: "服务商提示当前用户所在地不支持使用该 API。请切换支持当前地区的 Provider，或检查服务商账号地区限制。",
            actionText: "去设置",
            action: "goto-setup-guide",
            secondaryActionText: "重试",
            secondaryAction: "retry",
            presentation: "panel"
        },
        HTTP_400: {
            title: "请求参数有误",
            message: "服务商返回参数错误，常见原因是模型 ID 填写不正确、模型已下线，或当前接口不支持该模型。",
            actionText: "去设置",
            action: "goto-setup-guide",
            presentation: "panel"
        },
        INVALID_MODEL_ID: {
            title: "模型 ID 不可用",
            message: "当前填写的模型 ID 不存在、已下线，或当前接口不支持这个模型。请修改模型后再试。",
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
        AI_RESPONSE_TIMEOUT: {
            title: "模型请求超时",
            message: "模型在限定时间内没有完成响应。请稍后重试，或切换到更稳定的模型。",
            actionText: "重试",
            action: "retry",
            secondaryActionText: "去设置",
            secondaryAction: "goto-setup-guide",
            presentation: "panel"
        },
        AI_STREAM_TIMEOUT: {
            title: "模型迟迟没有开始返回内容",
            message: "已发出流式请求，但模型长时间没有开始输出。请重试，或切换到非流式更稳定的模型。",
            actionText: "重试",
            action: "retry",
            secondaryActionText: "去设置",
            secondaryAction: "goto-setup-guide",
            presentation: "panel"
        },
        NETWORK_REQUEST_TIMEOUT: {
            title: "网络请求超时",
            message: "请求已经发出，但网络层超时了。请检查网络，或稍后重试。",
            actionText: "重试",
            action: "retry",
            presentation: "panel"
        },
        ASR_REQUEST_TIMEOUT: {
            title: "转录请求超时",
            message: "音频已经开始上传或转录，但服务长时间没有完成。请稍后重试，或切换转录 Provider。",
            actionText: "重试",
            action: "retry",
            secondaryActionText: "去设置",
            secondaryAction: "goto-setup-guide",
            presentation: "panel"
        },
        NETWORK_ERROR: {
            title: "网络连接失败",
            message: "请检查网络连接，或稍后重试。",
            actionText: "重试",
            action: "retry",
            presentation: "panel"
        },
        PROVIDER_NETWORK_ERROR: {
            title: "模型服务连接失败",
            message: "请求已经发到模型服务链路，但服务端连接失败或没有返回。请稍后重试，或切换 Provider。",
            actionText: "重试",
            action: "retry",
            presentation: "panel"
        },
        FEEDBACK_SERVICE_UNAVAILABLE: {
            title: "反馈服务暂时不可用",
            message: "反馈中心当前无法连接到服务端，不影响总结、分段和转录功能。请稍后刷新再试。",
            actionText: "刷新",
            action: "refresh-page",
            presentation: "panel"
        },
        JSON_PARSE_ERROR: {
            title: "模型返回格式异常",
            message: "模型没有按预期格式返回结果，请重试，或切换到高速模式/其他模型。",
            actionText: "重试",
            action: "retry",
            presentation: "panel"
        },
        RUMORS_JSON_PARSE_FAILED: {
            title: "验真结果解析失败",
            message: "模型返回了验真内容，但格式不符合预期。请重试，或切换到更稳定的模型。",
            actionText: "重试验真",
            action: "retry",
            secondaryActionText: "切换模型",
            secondaryAction: "goto-setup-guide",
            presentation: "panel"
        },
        SUMMARY_EMPTY_RESPONSE: {
            title: "模型没有返回总结内容",
            message: "服务商返回成功，但没有返回可用总结。免费路由或推理模型可能把输出额度用于思考内容，请重试或切换模型。",
            actionText: "重试总结",
            action: "retry",
            secondaryActionText: "切换模型",
            secondaryAction: "goto-setup-guide",
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
            message: "Groq 转录额度或频率已超限，请等待提示时间后再试，或切换到硅基流动继续生成。",
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
        const message = String(errorInput?.message || errorInput || "");
        const genericCodes = new Set([
            "HTTP_400",
            "HTTP_401",
            "HTTP_403",
            "TIMEOUT",
            "NETWORK_ERROR",
            "JSON_PARSE_ERROR",
            "UNKNOWN"
        ]);
        if (code && !genericCodes.has(code)) return code;
        if (/(?:invalid|incorrect|wrong|bad|expired|missing)\s+(?:api\s*)?key|api\s*key\s+(?:is\s+)?(?:invalid|incorrect|wrong|expired|missing)|invalid_api_key|unauthorized api key|authentication.*(?:failed|invalid)|鉴权失败|认证失败|密钥.*(?:无效|错误|过期)|API\s*Key.*(?:无效|错误|过期|不正确)|令牌.*(?:无效|错误|过期)/i.test(message)) return "HTTP_401";
        if (/User location is not supported for the API use|location is not supported|unsupported.*location|地区.*不支持|所在地.*不支持/i.test(message)) return "API_LOCATION_UNSUPPORTED";
        if (/real-name verified|实名认证|实名.*验证|Please make sure your associated Aliyun account is real-name verified/i.test(message)) return "ALIYUN_REALNAME_REQUIRED";
        if (/Invalid model id|模型 ID.*(?:无效|不存在|不支持)|模型名称.*(?:无效|不存在|不支持)/i.test(message)) return "INVALID_MODEL_ID";
        if (/Model is private|private model|没有权限使用这个模型|无权访问该模型|model.*forbidden|model.*denied/i.test(message)) return "MODEL_ACCESS_DENIED";
        if (/(?:Groq|硅基流动|transcription|转录).*(?:403|forbidden|Illegal operation)|(?:403|forbidden|Illegal operation).*(?:Groq|硅基流动|transcription|转录)/i.test(message)) return "ASR_FORBIDDEN";
        const httpMatch = message.match(/\bHTTP\s+([0-9]{3})\b|API Error\s+([0-9]{3})/i);
        if (httpMatch) {
            const status = Number(httpMatch[1] || httpMatch[2] || 0);
            if (status >= 500) return "HTTP_5XX";
            return `HTTP_${status}`;
        }
        if (/模型长时间没有开始返回内容|stream timeout|first token timeout/i.test(message)) return "AI_STREAM_TIMEOUT";
        if (/模型请求超时|ai request timeout|provider timeout/i.test(message)) return "AI_RESPONSE_TIMEOUT";
        if (/转录请求超时|asr timeout|transcription timeout/i.test(message)) return "ASR_REQUEST_TIMEOUT";
        if (/网络请求超时|request timeout/i.test(message)) return "NETWORK_REQUEST_TIMEOUT";
        if (/timeout|超时/i.test(message)) return "TIMEOUT";
        if (/feedback.*(?:failed to fetch|network|timeout|unavailable)|反馈服务暂时不可用|feedback_(?:select|mark_seen)_unavailable/i.test(message)) return "FEEDBACK_SERVICE_UNAVAILABLE";
        if (/模型服务连接失败|provider network error/i.test(message)) return "PROVIDER_NETWORK_ERROR";
        if (/(?:provider|模型服务|上游|inference|chat_stream|summary|segments).*(?:failed to fetch|network error|网络请求失败)|(?:failed to fetch|network error).*(?:provider|模型服务|上游|inference|chat_stream|summary|segments)/i.test(message)) return "PROVIDER_NETWORK_ERROR";
        if (/network|failed to fetch|网络/i.test(message)) return "NETWORK_ERROR";
        if (/模型没有返回总结内容|总结生成为空|summary_empty|SUMMARY_EMPTY/i.test(message)) return "SUMMARY_EMPTY_RESPONSE";
        if (/字幕内容过长|context length|maximum context|max context|too many tokens|prompt too long|input too long|context_length_exceeded/i.test(message)) return "SEGMENTS_CONTEXT_TOO_LONG";
        if (/模型没有返回分段内容|返回为空|response_chars.?0|has_text.?false/i.test(message)) return "SEGMENTS_EMPTY_RESPONSE";
        if (/分段输出被截断|输出被截断|truncated|max_tokens|finish_reason.?length/i.test(message)) return "SEGMENTS_OUTPUT_TRUNCATED";
        if (/模型漏掉了分段部分|分段输出缺失|分段.*缺失|missing.*segments/i.test(message)) return "SEGMENTS_MISSING_PROTOCOL";
        if (/分段字段不完整|invalid schema|schema/i.test(message)) return "SEGMENTS_INVALID_SCHEMA";
        if (/模型没有生成有效分段|空分段|empty list/i.test(message)) return "SEGMENTS_EMPTY_LIST";
        if (/分段.*(?:格式|JSON|解析)|segments.*(?:json|parse)|模型返回分段格式/i.test(message)) return "SEGMENTS_JSON_PARSE_FAILED";
        if (/验真 JSON 解析失败|rumors.*(?:json|parse)|验真.*(?:格式|JSON|解析)/i.test(message)) return "RUMORS_JSON_PARSE_FAILED";
        if (/JSON\s*解析失败|json_parse|JSON Parse|模型返回格式/i.test(message)) return "JSON_PARSE_ERROR";
        if (/限流|rate limit|429/i.test(message) && /groq|转录/i.test(message)) return "ASR_RATE_LIMIT";
        if (/文件大小超出限制|音频过大|too large/i.test(message)) return "ASR_FILE_TOO_LARGE";
        if (/未获取到视频字幕|无字幕可供分析|当前视频暂无字幕|未检测到字幕/i.test(message)) return "SUBTITLE_MISSING";
        return code || "UNKNOWN";
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
        if (code === "ALIYUN_REALNAME_REQUIRED") {
            view.extraMessage = "如果你正在使用 ModelScope 或阿里云链路，请先完成阿里云实名认证后再试。";
            view.helper = {
                type: "modelscope-bind",
                url: "https://modelscope.cn/my/settings/account"
            };
            view.actionText = "查看实名引导";
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
        const resolvedRetryAction = retryAction || "refresh-page";
        const action = view.action === "retry" ? resolvedRetryAction : view.action;
        const primaryButton = action && view.actionText
            ? `<button class="action-btn" data-action="${safe(action)}">${safe(view.actionText)}</button>`
            : "";
        const secondaryAction = view.secondaryAction === "retry" ? resolvedRetryAction : view.secondaryAction;
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
