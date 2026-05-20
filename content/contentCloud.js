(function () {
    const normalizeBvidCase = globalThis.BilitatoContentUtils?.normalizeBvidCase || ((value) => String(value || "").trim());

    function hasSubtitle(cache) {
        return (Array.isArray(cache?.rawSubtitle) && cache.rawSubtitle.length > 0)
            || (Array.isArray(cache?.processedSubtitle) && cache.processedSubtitle.length > 0);
    }

    function hasSummary(cache) {
        return !!String(cache?.summary || "").trim();
    }

    function hasSegments(cache) {
        return Array.isArray(cache?.segments) && cache.segments.length > 0;
    }

    function hasRumors(cache) {
        return !!String(cache?.rumors?.overview || "").trim()
            || (Array.isArray(cache?.rumors?.claims) && cache.rumors.claims.length > 0);
    }

    function isCloudReadLoadingForVideo(cloudReadState, bvid) {
        const target = normalizeBvidCase(bvid || "");
        return !!target
            && normalizeBvidCase(cloudReadState?.bvid || "") === target
            && cloudReadState?.status === "loading";
    }

    function shouldAttemptCloudReadForVideo(cache, cloudReadState, bvid) {
        const target = normalizeBvidCase(bvid || "");
        if (!target) return false;
        if (normalizeBvidCase(cloudReadState?.bvid || "") === target && ["loading", "success", "failed"].includes(String(cloudReadState?.status || ""))) {
            return false;
        }
        return !(hasSubtitle(cache) && (hasSummary(cache) || hasSegments(cache)) && hasRumors(cache));
    }

    function shouldAttemptCloudReadForPage(cache, cloudReadState, bvid, page) {
        const target = normalizeBvidCase(bvid || "");
        const activePage = String(page || "");
        if (!target) return false;
        if (!["CC", "summary", "real", "chat"].includes(activePage)) return false;
        if (!shouldAttemptCloudReadForVideo(cache, cloudReadState, target)) return false;
        if (activePage === "CC") return !hasSubtitle(cache);
        if (activePage === "summary") return !hasSubtitle(cache) || !(hasSummary(cache) || hasSegments(cache));
        if (activePage === "chat") return !hasSubtitle(cache);
        return !hasSubtitle(cache) || !hasRumors(cache);
    }

    function createCloudReadState(bvid, status, requestId, startedAt = Date.now()) {
        return {
            bvid: normalizeBvidCase(bvid || ""),
            status: String(status || "idle"),
            requestId: Number(requestId || 0),
            startedAt
        };
    }

    globalThis.BilitatoContentCloud = {
        createCloudReadState,
        hasRumors,
        hasSegments,
        hasSubtitle,
        hasSummary,
        isCloudReadLoadingForVideo,
        shouldAttemptCloudReadForPage,
        shouldAttemptCloudReadForVideo
    };
})();
