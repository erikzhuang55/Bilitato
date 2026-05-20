(function () {
    const utils = globalThis.BilitatoContentUtils || {};
    const toSrtTime = utils.toSrtTime || ((value) => String(value || "0"));

    function getRawSubtitleRows(cache) {
        if (Array.isArray(cache?.rawSubtitle) && cache.rawSubtitle.length) return cache.rawSubtitle;
        if (Array.isArray(cache?.processedSubtitle) && cache.processedSubtitle.length) return cache.processedSubtitle;
        if (Array.isArray(cache?.rows) && cache.rows.length) return cache.rows;
        return [];
    }

    function getSubtitleRowText(row) {
        return String(row?.text ?? row?.content ?? "").trim();
    }

    function getRawSubtitlePlainText(cache) {
        const rows = getRawSubtitleRows(cache);
        return rows.map((row) => getSubtitleRowText(row)).filter(Boolean).join("\n");
    }

    function buildTimestampedSubtitleText(cache) {
        const rows = getRawSubtitleRows(cache);
        return rows
            .map((row) => `[${toSrtTime(row?.start ?? row?.from ?? 0).replace(",", ".")}] ${getSubtitleRowText(row)}`)
            .filter((line) => !!line.trim())
            .join("\n");
    }

    function buildSrtContent(cache) {
        const rows = getRawSubtitleRows(cache);
        return rows.map((row, index) => {
            const start = Number(row?.start ?? row?.from ?? 0);
            const end = row?.end ?? row?.to ?? (Number(start || 0) + 3);
            const text = getSubtitleRowText(row);
            return `${index + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${text}\n`;
        }).join("\n");
    }

    globalThis.BilitatoContentSubtitle = {
        buildSrtContent,
        buildTimestampedSubtitleText,
        getRawSubtitlePlainText,
        getRawSubtitleRows,
        getSubtitleRowText
    };
})();
