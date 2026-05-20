export function parseTimeToSeconds(value) {
    if (value == null) return NaN;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const str = String(value).trim();
    const parts = str.split(":").map(Number);
    if (parts.some((p) => !Number.isFinite(p))) return NaN;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return NaN;
}

function normalizeSegmentKeyName(key) {
    return String(key || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function hasUsableSegmentValue(value) {
    if (value == null) return false;
    if (typeof value === "string" && !value.trim()) return false;
    return true;
}

function resolveSegmentField(item, aliases, fuzzyMatchers) {
    const source = item && typeof item === "object" ? item : {};
    const keys = Object.keys(source);
    if (!keys.length) return { value: undefined, key: "" };
    const normalizedMap = new Map(keys.map((key) => [normalizeSegmentKeyName(key), key]));
    for (const alias of aliases) {
        const normalizedAlias = normalizeSegmentKeyName(alias);
        const key = normalizedMap.get(normalizedAlias);
        if (!key) continue;
        const value = source[key];
        if (!hasUsableSegmentValue(value)) continue;
        return { value, key };
    }
    for (const key of keys) {
        const normalized = normalizeSegmentKeyName(key);
        const matched = fuzzyMatchers.some((matcher) => matcher.test(normalized));
        if (!matched) continue;
        const value = source[key];
        if (!hasUsableSegmentValue(value)) continue;
        return { value, key };
    }
    return { value: undefined, key: "" };
}

export function normalizeSegments(value, hooks = {}) {
    if (!Array.isArray(value)) return [];
    const startFuzzyMatchers = [/start/, /^from$/, /begin/, /tsstart/, /timestart/];
    const endFuzzyMatchers = [/end/, /^to$/, /finish/, /tsend/, /timeend/];
    const labelPrimaryFuzzyMatchers = [/label/, /title/, /name/, /chapter/, /heading/, /topic/];
    const labelFallbackFuzzyMatchers = [/summary/, /content/, /desc/, /description/, /outline/];
    const dropped = [];
    const fuzzyHits = [];
    const mapped = value
        .map((item, index) => {
            const startField = resolveSegmentField(item, ["start", "start_time", "time_start"], startFuzzyMatchers);
            const endField = resolveSegmentField(item, ["end", "end_time", "time_end"], endFuzzyMatchers);
            let labelField = resolveSegmentField(item, ["label", "title", "name"], labelPrimaryFuzzyMatchers);
            if (!hasUsableSegmentValue(labelField.value)) {
                labelField = resolveSegmentField(item, ["summary", "content"], labelFallbackFuzzyMatchers);
            }
            const start = parseTimeToSeconds(startField.value);
            const end = parseTimeToSeconds(endField.value);
            const label = String(labelField.value || "").trim();
            const type = item?.type === "ad" ? "ad" : "content";
            const valid = Number.isFinite(start) && Number.isFinite(end) && start < end && !!label;
            const exactStart = ["start", "start_time", "time_start"].includes(String(startField.key || ""));
            const exactEnd = ["end", "end_time", "time_end"].includes(String(endField.key || ""));
            const exactLabel = ["label", "title", "name", "summary", "content"].includes(String(labelField.key || ""));
            if (startField.key && endField.key && labelField.key && (!exactStart || !exactEnd || !exactLabel)) {
                fuzzyHits.push({
                    index,
                    start_key: startField.key,
                    end_key: endField.key,
                    label_key: labelField.key
                });
            }
            if (!valid) {
                dropped.push({
                    index,
                    start,
                    end,
                    labelLength: label.length,
                    startKey: startField.key,
                    endKey: endField.key,
                    labelKey: labelField.key,
                    keys: Object.keys(item || {})
                });
                return null;
            }
            const result = { start, end, label, type };
            if (item && typeof item === "object") {
                const startLine = Number(item.start_line ?? item.startLine ?? item.line_start ?? item.lineStart);
                const endLine = Number(item.end_line ?? item.endLine ?? item.line_end ?? item.lineEnd);
                if (Number.isInteger(startLine) && startLine >= 0) result.start_line = startLine;
                if (Number.isInteger(endLine) && endLine >= 0) result.end_line = endLine;
                if (type === "ad") {
                    const adStartLine = Number(item.ad_start_line ?? item.adStartLine ?? item.start_line ?? item.startLine);
                    const adEndLine = Number(item.ad_end_line ?? item.adEndLine ?? item.end_line ?? item.endLine);
                    if (Number.isInteger(adStartLine) && adStartLine >= 0) result.ad_start_line = adStartLine;
                    if (Number.isInteger(adEndLine) && adEndLine >= 0) result.ad_end_line = adEndLine;
                    if (!Number.isInteger(startLine) && Number.isInteger(adStartLine) && adStartLine >= 0) result.start_line = adStartLine;
                    if (!Number.isInteger(endLine) && Number.isInteger(adEndLine) && adEndLine >= 0) result.end_line = adEndLine;
                }
            }
            return result;
        })
        .filter(Boolean);
    if (fuzzyHits.length && typeof hooks.onFuzzyHit === "function") {
        hooks.onFuzzyHit(fuzzyHits, value.length);
    }
    if (dropped.length && typeof hooks.onDrop === "function") {
        hooks.onDrop(dropped, value.length);
    }
    mapped.sort((a, b) => a.start - b.start);
    return mapped;
}

export function normalizeRumors(value) {
    let source = value;
    if (typeof source === "string") {
        try {
            source = JSON.parse(source);
        } catch (_) {
            return null;
        }
    }
    if (!source || typeof source !== "object") return null;
    const claims = Array.isArray(source.claims) ? source.claims : [];
    return {
        overall_score: Number.isFinite(Number(source.overall_score)) ? Number(source.overall_score) : 0,
        overview: String(source.overview || ""),
        claims: claims.map((claim) => ({
            claim: String(claim.claim || claim.text || ""),
            verdict: String(claim.verdict || "unknown"),
            confidence: Number.isFinite(Number(claim.confidence)) ? Number(claim.confidence) : 0,
            analysis: String(claim.analysis || ""),
            timestamp_sec: Number.isFinite(Number(claim.timestamp_sec ?? claim.timestamp)) ? Number(claim.timestamp_sec ?? claim.timestamp) : 0
        }))
    };
}
