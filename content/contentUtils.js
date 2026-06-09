(function () {
    function formatUtc8DateTime(value) {
        if (value == null || value === "") return "";
        const raw = typeof value === "number" ? value : String(value || "").trim();
        if (raw === "") return "";
        const date = typeof raw === "number" ? new Date(raw) : new Date(raw);
        if (!Number.isFinite(date.getTime())) return "";
        const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);
        const yyyy = utc8.getUTCFullYear();
        const mm = String(utc8.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(utc8.getUTCDate()).padStart(2, "0");
        const hh = String(utc8.getUTCHours()).padStart(2, "0");
        const min = String(utc8.getUTCMinutes()).padStart(2, "0");
        const sec = String(utc8.getUTCSeconds()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec} UTC+8`;
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function escapeHtmlAttr(value) {
        return escapeHtml(String(value || "")).replace(/"/g, "&quot;");
    }

    function toNumberOrNaN(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : NaN;
    }

    function resolveDefaultOpenPage(value) {
        const next = String(value || "").trim();
        if (next === "summary" || next === "chat" || next === "real") return next;
        return "CC";
    }

    function shouldIsolateChatInputKey(value) {
        return value === "ArrowLeft" || value === "ArrowRight";
    }

    function getBvidFromUrl(url) {
        const match = String(url).match(/\/video\/(BV[0-9A-Za-z]+)/i);
        return match ? match[1] : "";
    }

    function normalizeBvidCase(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";
        const matched = raw.match(/BV[0-9A-Za-z]+/i);
        return matched ? matched[0].toLowerCase() : "";
    }

    function getTidFromUrl(url) {
        const parsed = new URL(url);
        return parsed.searchParams.get("p") || parsed.searchParams.get("t") || "";
    }

    function formatTime(sec) {
        const n = Math.max(0, Math.floor(Number(sec) || 0));
        const h = Math.floor(n / 3600);
        const m = Math.floor((n % 3600) / 60);
        const s = n % 60;
        if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function escapeRegExp(text) {
        return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function formatTimelineTime(ts) {
        const d = new Date(Number(ts || 0));
        if (Number.isNaN(d.getTime())) return "--:--:--";
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
    }

    function serializeTimelineDetail(detail) {
        if (!detail || typeof detail !== "object") return "";
        const keys = Object.keys(detail);
        if (!keys.length) return "";
        return keys.map((key) => `${key}=${String(detail[key] ?? "")}`).join(" ");
    }

    function toSrtTime(secondValue) {
        const sec = Math.max(0, Number(secondValue) || 0);
        const totalMs = Math.round(sec * 1000);
        const ms = totalMs % 1000;
        const totalSec = Math.floor(totalMs / 1000);
        const s = totalSec % 60;
        const totalMin = Math.floor(totalSec / 60);
        const m = totalMin % 60;
        const h = Math.floor(totalMin / 60);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
    }

    globalThis.BilitatoContentUtils = {
        escapeHtml,
        escapeHtmlAttr,
        escapeRegExp,
        formatTime,
        formatTimelineTime,
        formatUtc8DateTime,
        getBvidFromUrl,
        getTidFromUrl,
        normalizeBvidCase,
        resolveDefaultOpenPage,
        serializeTimelineDetail,
        shouldIsolateChatInputKey,
        sleep,
        toNumberOrNaN,
        toSrtTime
    };
})();
