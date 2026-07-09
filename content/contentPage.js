(function () {
    const utils = globalThis.BilitatoContentUtils || {};
    const getBvidFromUrl = utils.getBvidFromUrl || (() => "");

    function resolveCurrentBvidFromState(state, href) {
        const routeBvid = getBvidFromUrl(href || "");
        if (routeBvid) return routeBvid;
        const injectBvid = String(state?.injectBvid || "").trim();
        if (injectBvid) return injectBvid;
        const activeBvid = String(state?.tabState?.activeBvid || "").trim();
        if (activeBvid) return activeBvid;
        return "";
    }

    function resolveCidFromState(state) {
        const candidates = [
            state?.injectCid,
            state?.cache?.cid,
            state?.tabState?.activeCid
        ];
        for (const value of candidates) {
            const cid = Number(value || 0);
            if (Number.isFinite(cid) && cid > 0) return cid;
        }
        return 0;
    }

    function pickSubtitle(subtitles) {
        const list = normalizeSubtitleOptions(subtitles);
        const zh = list.find((item) => /zh|cn|中文/i.test(`${item.id} ${item.label}`));
        return zh || list[0] || null;
    }

    function normalizeSubtitleOptions(subtitles) {
        const list = Array.isArray(subtitles) ? subtitles : [];
        return list.map((item, index) => {
            const rawUrl = String(item?.subtitle_url || item?.url || "").trim();
            const url = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
            const lan = String(item?.lan || item?.id || "").trim();
            const lanDoc = String(item?.lan_doc || item?.label || "").trim();
            const id = lan || lanDoc || `subtitle-${index + 1}`;
            const label = lanDoc || lan || `字幕 ${index + 1}`;
            return { id, label, url, lan, lanDoc };
        }).filter((item) => item.url);
    }

    function cleanBilibiliTitle(title) {
        return String(title || "").replace(/_哔哩哔哩_bilibili$/, "").trim();
    }

    function isStorageChangeStateDirty(changes, options = {}) {
        const afterBvid = String(options.afterBvid || "");
        const key = afterBvid ? `cache_${afterBvid}` : "";
        if (options.switched || options.routeMismatch) return true;
        if (changes?.settings?.newValue || changes?.providers?.newValue) return true;
        if (key && changes?.[key]?.newValue) return true;
        const tabKey = String(options.tabKey || "");
        if (tabKey && changes?.[tabKey]?.newValue) return true;
        return false;
    }

    globalThis.BilitatoContentPage = {
        cleanBilibiliTitle,
        isStorageChangeStateDirty,
        normalizeSubtitleOptions,
        pickSubtitle,
        resolveCidFromState,
        resolveCurrentBvidFromState
    };
})();
