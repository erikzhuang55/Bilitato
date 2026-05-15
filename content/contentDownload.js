(function () {
    const utils = globalThis.BilitatoContentUtils || {};

    function normalizeIncomingPlayInfo(info) {
        if (!info || typeof info !== "object") return null;
        const next = {
            ...info,
            video: Array.isArray(info.video) ? info.video : [],
            audio: Array.isArray(info.audio) ? info.audio : []
        };

        if (!next.audio.length) {
            const dashAudio = Array.isArray(info?.dash?.audio) ? info.dash.audio : [];
            next.audio = dashAudio
                .map((item) => ({
                    id: item?.id || 0,
                    desc: item?.id ? `Audio ${item.id}` : "Audio",
                    url: item?.url || item?.baseUrl || item?.base_url || "",
                    urls: Array.isArray(item?.urls) ? item.urls : [item?.url || item?.baseUrl || item?.base_url || ""].filter(Boolean),
                    bandwidth: Number(item?.bandwidth || 0)
                }))
                .filter((item) => item.url);
        }

        return next;
    }

    function hasUsablePlayInfoForBvid(info, bvid) {
        const normalizeBvidCase = utils.normalizeBvidCase || ((value) => String(value || "").trim().toLowerCase());
        const expectedBvid = normalizeBvidCase(bvid || "");
        const normalized = normalizeIncomingPlayInfo(info);
        if (!normalized || !expectedBvid) return false;
        if (normalizeBvidCase(normalized._bvid || "") !== expectedBvid) return false;
        return (
            (Array.isArray(normalized.audio) && normalized.audio.length > 0) ||
            (Array.isArray(normalized.video) && normalized.video.length > 0)
        );
    }

    function sanitizeDownloadFileName(value) {
        return String(value || "download").trim().replace(/[\\/:*?"<>|]/g, "_") || "download";
    }

    function downloadTextFile(fileName, content, mimeType) {
        const blob = new Blob([content], { type: mimeType || "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    globalThis.BilitatoContentDownload = {
        downloadTextFile,
        hasUsablePlayInfoForBvid,
        normalizeIncomingPlayInfo,
        sanitizeDownloadFileName
    };
})();
