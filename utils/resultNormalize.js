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

function isLineIdField(key) {
    return /line/i.test(String(key || ""));
}

function unwrapSegmentList(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    const candidates = [
        value.segments,
        value.chapters,
        value.sections,
        value.items,
        value.data,
        value.result,
        value.分段,
        value.章节
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
        if (candidate && typeof candidate === "object") {
            const nested = unwrapSegmentList(candidate);
            if (nested.length) return nested;
        }
    }
    return [];
}

export function normalizeSegments(value, hooks = {}) {
    const sourceList = unwrapSegmentList(value);
    if (!Array.isArray(sourceList) || !sourceList.length) return [];
    const allowLineOnly = hooks?.allowLineOnly === true;
    const startFuzzyMatchers = [/start/, /^from$/, /begin/, /tsstart/, /timestart/, /开始/, /起始/];
    const endFuzzyMatchers = [/end/, /^to$/, /finish/, /tsend/, /timeend/, /结束/, /截止/];
    const labelPrimaryFuzzyMatchers = [/label/, /title/, /name/, /chapter/, /heading/, /topic/, /标题/, /章节/, /主题/];
    const labelFallbackFuzzyMatchers = [/summary/, /content/, /desc/, /description/, /outline/, /概述/, /内容/, /说明/];
    const dropped = [];
    const fuzzyHits = [];
    const mapped = sourceList
        .map((item, index) => {
            const startField = resolveSegmentField(item, ["start", "start_time", "time_start", "开始", "开始时间"], startFuzzyMatchers);
            const endField = resolveSegmentField(item, ["end", "end_time", "time_end", "结束", "结束时间"], endFuzzyMatchers);
            let labelField = resolveSegmentField(item, ["label", "title", "name", "标题", "章节标题"], labelPrimaryFuzzyMatchers);
            if (!hasUsableSegmentValue(labelField.value)) {
                labelField = resolveSegmentField(item, ["summary", "content", "概述", "内容"], labelFallbackFuzzyMatchers);
            }
            const start = parseTimeToSeconds(startField.value);
            const end = parseTimeToSeconds(endField.value);
            const label = String(labelField.value || "").trim();
            const rawType = String(item?.type ?? item?.类型 ?? item?.kind ?? "").toLowerCase();
            const type = rawType === "ad" || rawType.includes("广告") ? "ad" : "content";
            const startLine = Number(item?.start_line ?? item?.startLine ?? item?.line_start ?? item?.lineStart ?? item?.开始行 ?? item?.起始行);
            const endLine = Number(item?.end_line ?? item?.endLine ?? item?.line_end ?? item?.lineEnd ?? item?.结束行);
            const adStartLine = Number(item?.ad_start_line ?? item?.adStartLine ?? item?.start_line ?? item?.startLine ?? item?.广告开始行 ?? item?.开始行);
            const adEndLine = Number(item?.ad_end_line ?? item?.adEndLine ?? item?.end_line ?? item?.endLine ?? item?.广告结束行 ?? item?.结束行);
            const primaryStartLine = type === "ad" && Number.isInteger(adStartLine) ? adStartLine : startLine;
            const primaryEndLine = type === "ad" && Number.isInteger(adEndLine) ? adEndLine : endLine;
            const hasLineRange = Number.isInteger(primaryStartLine) && primaryStartLine >= 0
                && Number.isInteger(primaryEndLine) && primaryEndLine >= primaryStartLine;
            const validTime = !isLineIdField(startField.key) && !isLineIdField(endField.key)
                && Number.isFinite(start) && Number.isFinite(end) && start < end;
            const validLineOnly = allowLineOnly && hasLineRange;
            const valid = (validTime || validLineOnly) && !!label;
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
                    hasLineRange,
                    allowLineOnly,
                    startKey: startField.key,
                    endKey: endField.key,
                    labelKey: labelField.key,
                    keys: Object.keys(item || {})
                });
                return null;
            }
            const result = {
                start: validTime ? start : primaryStartLine,
                end: validTime ? end : primaryEndLine + 1,
                label,
                type
            };
            if (!validTime && validLineOnly) {
                result.no_timestamp = true;
                result.virtual_time = true;
            }
            if (item && typeof item === "object") {
                if (Number.isInteger(startLine) && startLine >= 0) result.start_line = startLine;
                if (Number.isInteger(endLine) && endLine >= 0) result.end_line = endLine;
                if (type === "ad") {
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
        hooks.onFuzzyHit(fuzzyHits, sourceList.length);
    }
    if (dropped.length && typeof hooks.onDrop === "function") {
        hooks.onDrop(dropped, sourceList.length);
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

export function isValidRumorsResult(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (!Object.prototype.hasOwnProperty.call(value, "overall_score")
        || !Object.prototype.hasOwnProperty.call(value, "overview")
        || !Object.prototype.hasOwnProperty.call(value, "claims")) return false;
    const score = Number(value.overall_score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return false;
    if (typeof value.overview !== "string" || !value.overview.trim()) return false;
    if (!Array.isArray(value.claims)) return false;
    return value.claims.every((claim) => {
        if (!claim || typeof claim !== "object" || Array.isArray(claim)) return false;
        const claimText = String(claim.claim || claim.text || "").trim();
        const verdict = claim.verdict;
        const confidence = Number(claim.confidence);
        const timestamp = Number(claim.timestamp_sec ?? claim.timestamp);
        return !!claimText
            && (typeof verdict === "boolean" || (typeof verdict === "string" && !!verdict.trim()))
            && Number.isFinite(confidence) && confidence >= 0 && confidence <= 100
            && typeof claim.analysis === "string"
            && Number.isFinite(timestamp) && timestamp >= 0;
    });
}
