(function () {
    const utils = globalThis.BilitatoContentUtils || {};
    const richText = globalThis.BilitatoContentRichText || {};
    const escapeHtml = utils.escapeHtml || ((value) => String(value || ""));
    const renderRichContent = richText.renderRichContent || ((value) => `<div class="rich-text-block">${escapeHtml(value || "")}</div>`);

    function renderChatHistoryItem(item, options = {}) {
        if (item?.role === "assistant") {
            return renderAssistantBubble(item.content, item.metrics || null, options);
        }
        return `<div class="chat-item user">${escapeHtml(item?.content || "")}</div>`;
    }

    function renderAssistantBubble(text, metrics, options = {}) {
        if (!String(text || "").trim() && !metrics) {
            return `<div class="chat-item assistant"><span style="color:#999;font-style:italic;">(无内容)</span></div>`;
        }

        let safeText = "";
        try {
            safeText = renderRichContent(text || "");
            if (!safeText && String(text || "").trim()) {
                safeText = `<div class="rich-text-block">${escapeHtml(text)}</div>`;
            }
        } catch (e) {
            if (typeof options.onRenderError === "function") options.onRenderError(e);
            safeText = `<div class="rich-text-block">${escapeHtml(text || "")}</div>`;
        }

        const metricsText = options.hideMetrics ? "" : formatMetricText(metrics);
        const metricsLine = metricsText ? `<div class="chat-item-meta">${escapeHtml(metricsText)}</div>` : "";
        return `<div class="chat-item assistant">${safeText}</div><button class="chat-copy-mini-btn" data-action="chat-copy" data-text="${escapeHtml(text || "")}">复制</button>${metricsLine}`;
    }

    function formatMetricText(metrics) {
        if (!metrics || typeof metrics !== "object") return "";
        const latency = Number.isFinite(Number(metrics.latencyMs)) ? `${(Number(metrics.latencyMs) / 1000).toFixed(1)}s` : "-";
        const total = Number.isFinite(Number(metrics.tokens)) ? Number(metrics.tokens) : 0;
        const input = Number.isFinite(Number(metrics.inputTokens)) ? Number(metrics.inputTokens) : 0;
        const output = Number.isFinite(Number(metrics.outputTokens)) ? Number(metrics.outputTokens) : 0;
        const tokenStr = input || output ? `${total} (In ${input} / Out ${output})` : `${total}`;
        const parts = [`用时 ${latency}`, `Tokens ${tokenStr}`];
        if (String(metrics.provider || "").toLowerCase() === "modelscope") {
            const modelRemaining = formatQuotaValue(metrics.modelScopeRemaining, metrics.modelScopeModelLimit);
            const userRemaining = formatQuotaValue(metrics.modelScopeUserRemaining, metrics.modelScopeUserLimit);
            parts.push(`模型剩余 ${modelRemaining}`, `账号剩余 ${userRemaining}`);
        }
        return parts.join(" · ");
    }

    function formatQuotaValue(remaining, limit) {
        const hasRemaining = remaining !== null && remaining !== undefined && remaining !== "";
        const hasLimit = limit !== null && limit !== undefined && limit !== "";
        if (!hasRemaining) return "未返回";
        return hasLimit ? `${remaining}/${limit}` : String(remaining);
    }

    globalThis.BilitatoContentChat = {
        formatMetricText,
        renderAssistantBubble,
        renderChatHistoryItem
    };
})();
