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

    function splitPlaybackSubtitleText(text, maxChars = 24) {
        const normalized = String(text || "").replace(/\s+/g, " ").trim();
        if (!normalized) return [];
        const limit = Math.max(8, Number(maxChars) || 24);
        const sentences = normalized.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [normalized];
        const chunks = [];
        sentences.forEach((sentence) => {
            let rest = sentence.trim();
            while (rest.length > limit) {
                const windowText = rest.slice(0, limit + 1);
                let splitAt = Math.max(windowText.lastIndexOf("，"), windowText.lastIndexOf(","), windowText.lastIndexOf(" "));
                if (splitAt < Math.floor(limit * 0.5)) splitAt = limit;
                else splitAt += 1;
                chunks.push(rest.slice(0, splitAt).trim());
                rest = rest.slice(splitAt).trim();
            }
            if (rest) chunks.push(rest);
        });
        return chunks.filter(Boolean);
    }

    function buildPlaybackSubtitleCues(rows, options = {}) {
        const list = Array.isArray(rows) ? rows : [];
        const starts = list.map((row) => Number(row?.start ?? row?.from ?? NaN));
        const hasProgressingTimeline = starts.some((start, index) => index > 0
            && Number.isFinite(start)
            && Number.isFinite(starts[index - 1])
            && start > starts[index - 1]);
        if (list.length > 1 && !hasProgressingTimeline) return [];

        const cues = [];
        list.forEach((row, index) => {
            const text = getSubtitleRowText(row);
            const start = starts[index];
            const explicitEnd = Number(row?.end ?? row?.to ?? NaN);
            const nextStart = starts[index + 1];
            const end = Number.isFinite(explicitEnd) && explicitEnd > start
                ? explicitEnd
                : (Number.isFinite(nextStart) && nextStart > start ? nextStart : start + 6);
            if (!text || !Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start) return;
            // A single very long 0-10 row is Groq's no-segment fallback, not a usable timeline.
            if (list.length === 1 && text.length > 80) return;
            const parts = splitPlaybackSubtitleText(text, options.maxChars);
            const totalWeight = parts.reduce((sum, part) => sum + Math.max(1, part.length), 0);
            let cursor = start;
            parts.forEach((part, partIndex) => {
                const isLast = partIndex === parts.length - 1;
                const duration = (end - start) * (Math.max(1, part.length) / totalWeight);
                const cueEnd = isLast ? end : Math.min(end, cursor + duration);
                if (cueEnd > cursor) cues.push({ start: cursor, end: cueEnd, text: part });
                cursor = cueEnd;
            });
        });
        return cues;
    }

    globalThis.BilitatoContentSubtitle = {
        buildPlaybackSubtitleCues,
        buildSrtContent,
        buildTimestampedSubtitleText,
        getActiveSubtitleIndex,
        getRawSubtitlePlainText,
        getRawSubtitleRows,
        getSubtitleRowText,
        splitPlaybackSubtitleText
    };
})();
