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

    function getActiveSubtitleIndex(rows, currentTime) {
        const list = Array.isArray(rows) ? rows : [];
        const time = Number(currentTime);
        if (!Number.isFinite(time)) return -1;
        const starts = list.map((row) => Number(row?.start ?? row?.from ?? NaN));
        const hasProgressingTimeline = starts.some((start, index) => index > 0
            && Number.isFinite(start)
            && Number.isFinite(starts[index - 1])
            && start > starts[index - 1]);
        if (list.length > 1 && !hasProgressingTimeline) return -1;
        for (let index = 0; index < list.length; index += 1) {
            const start = starts[index];
            if (!Number.isFinite(start)) continue;
            const explicitEnd = Number(list[index]?.end ?? list[index]?.to ?? NaN);
            const nextStart = index < list.length - 1 ? starts[index + 1] : NaN;
            const end = Number.isFinite(explicitEnd) && explicitEnd > start
                ? explicitEnd
                : (Number.isFinite(nextStart) && nextStart > start ? nextStart : start + 6);
            if (start <= time && time < end) return index;
        }
        return -1;
    }

    globalThis.BilitatoContentSubtitle = {
        buildSrtContent,
        buildTimestampedSubtitleText,
        getActiveSubtitleIndex,
        getRawSubtitlePlainText,
        getRawSubtitleRows,
        getSubtitleRowText
    };
})();
