(function initLogger(global) {
    const ALLOWED_MODULES = new Set(["inject", "content", "background", "cache", "ai", "ui"]);
    const LEVELS = new Set(["info", "warn", "error", "debug"]);
    const PREFIX = "[AI-PLUGIN]";

    function safeDetail(detail) {
        if (detail && typeof detail === "object") return detail;
        if (detail === undefined) return {};
        return { value: detail };
    }

    function normalizeModule(moduleName) {
        const value = String(moduleName || "").trim().toLowerCase();
        return ALLOWED_MODULES.has(value) ? value : "ui";
    }

    function normalizeEvent(eventName) {
        const raw = String(eventName || "").trim();
        if (!raw) return "unknown_event";
        return raw
            .replace(/\s+/g, "_")
            .replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
            .replace(/[^a-zA-Z0-9_]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_+|_+$/g, "")
            .toLowerCase() || "unknown_event";
    }

    function shouldPrint(level, debugMode) {
        if (debugMode) return true;
        return level === "warn" || level === "error";
    }

    function toConsole(entry) {
        const text = `${PREFIX}[${entry.module}][${entry.event}]`;
        if (entry.level === "error") {
            console.error(text, entry.detail);
            return;
        }
        if (entry.level === "warn") {
            console.warn(text, entry.detail);
            return;
        }
        if (entry.level === "debug") {
            console.debug(text, entry.detail);
            return;
        }
        console.log(text, entry.detail);
    }

    function postToBackground(entry) {
        if (!global.chrome?.runtime?.sendMessage) return;
        try {
            const result = global.chrome.runtime.sendMessage({ action: "LOG_ENTRY", entry });
            if (result && typeof result.catch === "function") result.catch(() => {});
        } catch (_) {}
    }

    function create(moduleName, options = {}) {
        const fixedModule = normalizeModule(moduleName);
        const getDebugMode = typeof options.getDebugMode === "function" ? options.getDebugMode : () => true;
        const onEntry = typeof options.onEntry === "function" ? options.onEntry : postToBackground;
        const printConsole = options.printConsole !== false;

        function write(levelName, eventName, detail) {
            const level = LEVELS.has(levelName) ? levelName : "info";
            const entry = {
                time: new Date().toISOString(),
                level,
                module: fixedModule,
                event: normalizeEvent(eventName),
                detail: safeDetail(detail)
            };
            try {
                onEntry(entry);
            } catch (_) {}
            const debugMode = !!getDebugMode();
            if (printConsole && shouldPrint(level, debugMode)) {
                toConsole(entry);
            }
            return entry;
        }

        return {
            info(eventName, detail) {
                return write("info", eventName, detail);
            },
            warn(eventName, detail) {
                return write("warn", eventName, detail);
            },
            error(eventName, detail) {
                return write("error", eventName, detail);
            },
            debug(eventName, detail) {
                return write("debug", eventName, detail);
            }
        };
    }

    global.AIPluginLogger = {
        create,
        normalizeEvent
    };
})(globalThis);
