(function () {
    if (window.__BILI_AI_INJECT_READY__) {
        window.postMessage({ type: "BILI_INJECT_READY" }, "*");
        return;
    }
    window.__BILI_AI_INJECT_READY__ = true;
    let isSubtitleCaptured = false;
    let autoTriggerTimer = null;
    let autoTriggerStarted = false;
    let maskNode = null;
    let capturedBvid = "";
    let capturedRouteKey = "";
    let latestPlayinfo = null; // 存储 XHR 拦截到的最新 dash 数据
    let latestAudioProbe = null;
    let routeMonitorTimer = null;
    let silentDeadlineTs = Date.now() + 2000;
    let subtitleStringCache = [];
    let routeMetaReadyAt = 0;
    let autoTriggerAttempts = 0;
    const stealthStyleId = "bili-stealth-css";
    const originalFetch = window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    window.postMessage({ type: "BILI_INJECT_READY" }, "*");
    bindManualCCIntervention();
    startRouteMonitor();
    scheduleAutoTriggerFlow("inject_bootstrap");
    emitPlayInfo(); // Initial emission

    window.addEventListener("message", (event) => {
        if (event.data?.type === "GET_PLAY_INFO") {
            window.postMessage({
                type: "SEND_PLAY_INFO",
                data: latestPlayinfo
            }, "*");
            return;
        }
        if (event.data?.type === "BILI_ALLOW_SUBTITLE_RECAPTURE") {
            isSubtitleCaptured = false;
            subtitleStringCache = [];
            removeStealthMask();
            emitLog("subtitle_recapture_enabled", { source: "content" });
            return;
        }
        if (event.data && (event.data.type === "RE_EMIT_PLAYINFO" || event.data.type === "REFRESH_PLAYINFO" || event.data.type === "PLAYER_WAKE_UP")) {
            emitPlayInfo();
        }
    });

    window.fetch = async function (...args) {
        const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
        const response = await originalFetch.apply(this, args);
        if (isSubtitleRequest(url)) {
            emitLog("subtitle_detected", { source: "fetch", url });
            scheduleAutoTriggerFlow("fetch_detected");
            response.clone().text().then((text) => {
                emitSubtitlePayload(text, url);
            }).catch(() => {});
        }
        return response;
    };

    XMLHttpRequest.prototype.open = function (method, url) {
        const rawUrl = String(url || "");
        if (rawUrl.includes(".m4s") || rawUrl.includes("upos")) {
            latestAudioProbe = rawUrl;
        }
        this.__biliUrl = url;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
        const url = this.__biliUrl || "";

        if (isSubtitleRequest(url)) {
            emitLog("subtitle_detected", { source: "xhr", url });
            scheduleAutoTriggerFlow("xhr_detected");
            this.addEventListener("load", () => {
                emitSubtitlePayload(this.responseText, url);
            });
        }

        if (isPlayurlRequest(url)) {
            this.addEventListener("load", () => {
                try {
                    const dashData = JSON.parse(this.responseText);
                    const playData = dashData?.data || dashData?.result || dashData;
                    const dash = playData?.dash;
                    if (dash) {
                        const currentBvid = window.location.href.match(/BV[a-zA-Z0-9]{10}/)?.[0] || "";
                        latestPlayinfo = {
                            ...playData,
                            _bvid: currentBvid,
                            _ts: Date.now()
                        };
                        emitLog("playinfo_updated", { source: "xhr_playurl", url_host: getUrlHost(url), bvid: currentBvid });
                    }
                } catch (_) {}
            });
        }
        return originalSend.apply(this, arguments);
    };

    function emitSubtitlePayload(rawText, url) {
        syncCaptureStateWithRoute();
        if (isSubtitleCaptured) return;
        subtitleStringCache.push(String(rawText || ""));
        if (subtitleStringCache.length > 6) subtitleStringCache = subtitleStringCache.slice(-6);
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (_) {
            emitLog("json_parse_error", { source: "inject_subtitle", url_host: getUrlHost(url) });
            return;
        }
        const body = data?.body || data?.data?.body || data?.content || data?.result?.body || (Array.isArray(data) ? data : null);
        if (!Array.isArray(body) || !body.length) return;
        const routeBvid = String(getBvidFromUrl(location.href) || "").trim();
        isSubtitleCaptured = true;
        capturedBvid = routeBvid || capturedBvid;
        stopAutoTriggerFlow();
        hackSubtitleOff();
        const delay = Math.max(0, Number(routeMetaReadyAt || 0) - Date.now());
        setTimeout(() => {
            postSubtitleData(body);
        }, delay);
    }

    function isSubtitleRequest(rawUrl) {
        if (!rawUrl) return false;
        let parsed;
        try {
            parsed = new URL(rawUrl, location.href);
        } catch (_) {
            return false;
        }
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname.toLowerCase();
        if (host === "data.bilibili.com") return false;
        if (path.includes("/log/web")) return false;
        if (/\/bfs\/(ai_)?subtitle\//i.test(path)) return true;
        if (/\/aisubtitle\//i.test(path)) return true;
        if (path.endsWith(".json") && path.includes("subtitle")) return true;
        return false;
    }

    function isPlayurlRequest(url) {
        if (!url) return false;
        return /\/x\/player\/(wbi\/)?playurl|\/pgc\/player\/web\/playurl/.test(url);
    }

    function emitLog(event, detail) {
        window.postMessage({ type: "BILI_INJECT_LOG", event, detail }, "*");
    }

    function getUrlHost(url) {
        try {
            return new URL(String(url || "")).host;
        } catch (_) {
            return "";
        }
    }

    function scheduleAutoTriggerFlow(reason) {
        syncCaptureStateWithRoute();
        if (isSubtitleCaptured || autoTriggerStarted) return;
        if (autoTriggerTimer) clearTimeout(autoTriggerTimer);
        const waitMs = Math.max(0, Number(silentDeadlineTs || 0) - Date.now());
        autoTriggerAttempts = 0;
        autoTriggerTimer = setTimeout(() => autoTriggerLoop(reason), waitMs);
    }

    function autoTriggerLoop(reason) {
        if (isSubtitleCaptured) return;
        const toggle = document.querySelector(".bpx-player-ctrl-subtitle, .bilibili-player-video-btn-subtitle");
        if (!toggle) {
            autoTriggerAttempts += 1;
            if (autoTriggerAttempts >= 10) return;
            autoTriggerTimer = setTimeout(() => autoTriggerLoop(reason), 1000);
            return;
        }
        autoTriggerStarted = true;
        performSilentAutoTrigger();
        emitLog("subtitle_autotrigger", { reason, attempts: autoTriggerAttempts });
    }

    function stopAutoTriggerFlow() {
        if (autoTriggerTimer) {
            clearTimeout(autoTriggerTimer);
            autoTriggerTimer = null;
        }
        removeStealthMask();
    }

    function applyStealthMask() {
        if (document.getElementById(stealthStyleId)) return;
        maskNode = document.createElement("style");
        maskNode.id = stealthStyleId;
        maskNode.innerHTML = [
            ".bpx-player-video-subtitle { visibility: hidden !important; }",
            ".bili-subtitle-x-subtitle-panel-position { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }",
            ".bpx-player-ctrl-subtitle-menu.bui.bui-panel.bui-dark { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }",
            ".bpx-common-toast, .bpx-player-toast-wrap, .bpx-player-toast-row, .bpx-player-toast-auto { display: none !important; opacity: 0 !important; visibility: hidden !important; }"
        ].join(" ");
        document.head.appendChild(maskNode);
        emitLog("subtitle_stealth_applied", { source: "inject" });
    }

    function removeStealthMask() {
        const hadMask = !!document.getElementById(stealthStyleId) || !!maskNode?.isConnected;
        const style = document.getElementById(stealthStyleId);
        if (style) style.remove();
        if (maskNode?.isConnected) maskNode.remove();
        maskNode = null;
        const containers = document.querySelectorAll(".bpx-player-video-subtitle");
        containers.forEach((container) => {
            container.style.removeProperty("display");
            container.style.removeProperty("opacity");
            container.style.removeProperty("visibility");
            container.style.removeProperty("height");
            container.style.removeProperty("pointer-events");
            container.style.pointerEvents = "auto";
        });
        if (hadMask) emitLog("subtitle_stealth_released", { source: "manual_interaction" });
    }

    function hackSubtitleOff() {
        applyStealthMask();
    }

    function performSilentAutoTrigger() {
        return blindSilentOpen();
    }

    function blindSilentOpen() {
        if (isSubtitleCaptured) return;
        applyStealthMask();
        const allTextDivs = Array.from(document.querySelectorAll(".bpx-player-ctrl-subtitle-language-item-text"));
        const chineseTrack = allTextDivs.find((el) => String(el?.innerText || "").trim().includes("中文"));
        if (chineseTrack) {
            chineseTrack.click();
            return true;
        }
        const ccBtn = document.querySelector(".bpx-player-ctrl-subtitle");
        let clicked = false;
        if (ccBtn) {
            try {
                const evt = new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window });
                ccBtn.dispatchEvent(evt);
            } catch (_) {}
            ccBtn.click();
            clicked = true;
        }
        setTimeout(() => {
            if (isSubtitleCaptured) return;
            const retryTrack = Array.from(document.querySelectorAll(".bpx-player-ctrl-subtitle-language-item-text"))
                .find((el) => String(el?.innerText || "").trim().includes("中文"));
            if (retryTrack) retryTrack.click();
        }, 100);
        return clicked;
    }

    function syncCaptureStateWithRoute() {
        const current = String(getBvidFromUrl(location.href) || "").trim();
        const currentKey = getRouteVideoKey();
        if (!capturedBvid) {
            if (current) capturedBvid = current;
            if (currentKey) capturedRouteKey = currentKey;
            return;
        }
        if (current && currentKey && currentKey !== capturedRouteKey) {
            hardResetForRoute(current, "route_switch_reset");
        }
    }

    function hardResetForRoute(nextBvid, reason) {
        isSubtitleCaptured = false;
        autoTriggerStarted = false;
        capturedBvid = String(nextBvid || "").trim();
        capturedRouteKey = getRouteVideoKey();
        subtitleStringCache = [];
        latestPlayinfo = null; // 切换视频时清空，防止旧视频数据残留
        latestAudioProbe = null;
        silentDeadlineTs = Date.now() + 2000;
        stopAutoTriggerFlow();
        emitLog("subtitle_route_reset", { bvid: capturedBvid, reason });
        performSilentAutoTrigger();
        scheduleAutoTriggerFlow(reason || "route_switch_reset");
    }

    function startRouteMonitor() {
        if (routeMonitorTimer) return;
        routeMonitorTimer = setInterval(() => {
            const current = String(getBvidFromUrl(location.href) || "").trim();
            const currentKey = getRouteVideoKey();
            if (!current) return;
            if (!capturedBvid) {
                capturedBvid = current;
                capturedRouteKey = currentKey;
                emitPlayInfo(); // Emit when first BVID captured
                return;
            }
            if (currentKey && currentKey === capturedRouteKey) return;
            
            // Immediately dispatch postMessage on detection without delay
            const meta = resolvePageMeta();
            window.postMessage({ type: "BILI_ROUTE_SWITCH", bvid: current, cid: meta.cid || 0, tid: getRouteTid() }, "*");
            
            routeMetaReadyAt = Date.now() + 800;
            hardResetForRoute(current, "route_monitor");
            setTimeout(emitPlayInfo, 1000); // Emit after route change with a delay to ensure __playinfo__ might be updated or we might need to re-read
        }, 300);
    }

    function postSubtitleData(body) {
        const meta = resolvePageMeta();
        const routeBvid = String(getBvidFromUrl(location.href) || "").trim();
        const bvid = String(meta.bvid || routeBvid || "").trim();
        if (!bvid) {
            emitLog("subtitle_detected", { source: "inject_drop_missing_bvid" });
            return;
        }
        const cid = meta.cid || 0;
        emitLog("subtitle_parsed", { count: body.length, bvid, cid });
        window.postMessage({ type: "BILI_SUBTITLE_HANDSHAKE", bvid, cid }, "*");
        setTimeout(() => {
            window.postMessage({ type: "BILI_SUBTITLE_DATA", data: body, bvid, cid }, "*");
        }, 0);
    }

    function bindManualCCIntervention() {
        const release = (eventName, event) => {
            const target = event.target?.closest?.(".bpx-player-ctrl-subtitle, .bilibili-player-video-btn-subtitle");
            if (!target) return;
            emitLog("subtitle_manual_intervention", { event: eventName });
            removeStealthMask();
        };
        document.addEventListener("mouseover", (event) => {
            release("mouseover", event);
        }, true);
        document.addEventListener("mousedown", (event) => {
            release("mousedown", event);
        }, true);
        document.addEventListener("click", (event) => {
            release("click", event);
        }, true);
    }

    function resolvePageMeta() {
        const state = window.__INITIAL_STATE__ || {};
        const playInfo = window.__playinfo__ || {};
        const bvidFromPath = getBvidFromUrl(location.href);
        const pageCid = getCidFromPages(state?.videoData?.pages);
        const bvid = String(
            state?.bvid ||
            state?.videoData?.bvid ||
            state?.videoData?.aidBvid ||
            playInfo?.data?.bvid ||
            bvidFromPath ||
            ""
        ).trim();
        const cid = Number(
            pageCid ||
            state?.cid ||
            state?.epInfo?.cid ||
            playInfo?.data?.cid ||
            state?.videoData?.cid ||
            0
        );
        return { bvid, cid: Number.isFinite(cid) ? cid : 0 };
    }

    function getCidFromPages(pages) {
        const list = Array.isArray(pages) ? pages : [];
        if (!list.length) return 0;
        const page = Number(new URL(location.href).searchParams.get("p") || 1);
        const matched = list.find((item) => Number(item?.page || 0) === page);
        return Number(matched?.cid || list[0]?.cid || 0);
    }

    function getBvidFromUrl(url) {
        const match = String(url || "").match(/\/video\/(BV[0-9A-Za-z]+)/i);
        return match ? match[1] : "";
    }

    function getRouteTid() {
        const parsed = new URL(location.href);
        return parsed.searchParams.get("p") || "";
    }

    function getRouteVideoKey() {
        const bvid = String(getBvidFromUrl(location.href) || "").trim();
        return bvid ? `${bvid}|${getRouteTid()}` : "";
    }

    function emitPlayInfo() {
        const info = resolvePlayInfo();
        if (info) {
            window.postMessage({ type: "BILI_PLAYINFO_DATA", info }, "*");
        } else {
            emitLog("playinfo_missing", { source: "resolve_playinfo" });
        }
    }

    // Auto-detect URL changes to re-emit playinfo
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            setTimeout(emitPlayInfo, 1000); // Wait for page to update internal state
        }
    }).observe(document, {subtree: true, childList: true});

    // 路由守卫：防止 SPA 切换时旧数据残留
    let lastLocation = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastLocation) {
            lastLocation = window.location.href;
            latestPlayinfo = null;
            latestAudioProbe = null;
            emitLog("route_memory_reset", { bvid: getBvidFromUrl(window.location.href) });
        }
    }, 300);

    function resolvePlayInfo() {
        try {
            const data = latestPlayinfo || window.__playinfo__?.data || null;
            if (!data) return null;
            
            // Collect all candidates
            let candidates = [];

            // 1. DASH
            if (data.dash && data.dash.video) {
                data.dash.video.forEach(v => {
                    const primaryUrl = v.baseUrl || v.base_url || "";
                    const backupUrls = Array.isArray(v.backupUrl) ? v.backupUrl : (Array.isArray(v.backup_url) ? v.backup_url : []);
                    candidates.push({
                        quality: v.id,
                        codecid: v.codecid,
                        desc: getQualityDesc(v.id, data.accept_quality, data.accept_description),
                        url: primaryUrl,
                        urls: [primaryUrl, ...backupUrls].filter(Boolean),
                        codecs: v.codecs,
                        type: 'DASH'
                    });
                });
            }
            
            // 2. DURL (Legacy/MP4)
            if (data.durl) {
                 data.durl.forEach(v => {
                    const primaryUrl = v.url || "";
                    const backupUrls = Array.isArray(v.backupUrl) ? v.backupUrl : (Array.isArray(v.backup_url) ? v.backup_url : []);
                    candidates.push({
                        quality: data.quality || 0, // durl usually has top-level quality
                        codecid: 0, // unknown
                        desc: getQualityDesc(data.quality, data.accept_quality, data.accept_description),
                        url: primaryUrl,
                        urls: [primaryUrl, ...backupUrls].filter(Boolean),
                        type: 'MP4'
                    });
                });
            }

            // Deduplication and Grouping
            const uniqueMap = new Map();
            const groupedMap = new Map();
            
            candidates.forEach(item => {
                const key = `${item.quality}_${item.codecid}`;
                
                // De-duplication: skip if exact quality+codecid exists
                if (uniqueMap.has(key)) return;
                uniqueMap.set(key, true);

                // Group by quality
                if (!groupedMap.has(item.quality)) {
                    groupedMap.set(item.quality, {
                        desc: item.desc,
                        streams: []
                    });
                }
                
                // Map friendly codec name
                item.codecName = mapCodecName(item.codecs, item.codecid);
                groupedMap.get(item.quality).streams.push(item);
            });

            // Convert map to array and sort by quality desc
            const resultVideo = Array.from(groupedMap.entries())
                .sort((a, b) => b[0] - a[0])
                .map(([q, val]) => ({
                    quality: q,
                    desc: val.desc,
                    streams: val.streams.sort((a, b) => {
                        // Sort streams within quality: AVC first (compatibility), then HEVC, then AV1
                        const score = (c) => {
                            if (c === "AVC") return 3;
                            if (c === "HEVC") return 2;
                            if (c === "AV1") return 1;
                            return 0;
                        };
                        return score(b.codecName) - score(a.codecName);
                    })
                }));
            
            if (candidates.length > resultVideo.length) {
            }
            
            // Audio streams
            const audio = [];
            if (data.dash && data.dash.audio) {
                data.dash.audio.forEach(a => {
                    const bandwidthNum = a.bandwidth || 0;
                    const bandwidthStr = bandwidthNum ? `${Math.round(bandwidthNum / 1000)}kbps` : "";
                    const idDesc = a.id === 30280 ? "高品质" : a.id === 30232 ? "中品质" : a.id === 30216 ? "低品质" : "";
                    
                    let finalDesc = "";
                    if (idDesc && bandwidthStr) {
                        finalDesc = `${idDesc} · ${bandwidthStr}`;
                    } else if (idDesc) {
                        finalDesc = idDesc;
                    } else if (bandwidthStr) {
                        finalDesc = bandwidthStr;
                    } else {
                        finalDesc = `Audio ${a.id}`;
                    }
                    
                    const primaryUrl = a.baseUrl || a.base_url || "";
                    const backupUrls = Array.isArray(a.backupUrl) ? a.backupUrl : (Array.isArray(a.backup_url) ? a.backup_url : []);
                    audio.push({
                        id: a.id,
                        desc: finalDesc, 
                        url: primaryUrl,
                        urls: [primaryUrl, ...backupUrls].filter(Boolean),
                        bandwidth: bandwidthNum
                    });
                });
                
                // Sort audio by bandwidth descending
                audio.sort((a, b) => b.bandwidth - a.bandwidth);
            }
            
            return {
                video: resultVideo,
                audio,
                _bvid: String(data._bvid || getBvidFromUrl(location.href) || "").trim(),
                _ts: Number(data._ts || 0)
            };
        } catch (e) {
            emitLog("playinfo_error", {
                code: "PLAYINFO_PARSE_FAILED",
                error_message: e.message || "playinfo parse failed",
                stack_preview: String(e.stack || "").split("\n").slice(0, 3).join("\n")
            });
            return null;
        }
    }

    function mapCodecName(codecs, codecid) {
        const c = String(codecs || "").toLowerCase();
        // 7 = AVC, 12 = HEVC, 13 = AV1 (approximate bilibili mapping)
        if (c.includes("avc") || codecid === 7) return "AVC";
        if (c.includes("hev") || c.includes("hvc") || codecid === 12) return "HEVC";
        if (c.includes("av01") || codecid === 13) return "AV1";
        return "MP4"; // Fallback
    }

    function getQualityDesc(quality, accept_quality, accept_description) {
        if (!Array.isArray(accept_quality) || !Array.isArray(accept_description)) return String(quality);
        const index = accept_quality.indexOf(quality);
        if (index > -1 && accept_description[index]) {
            return accept_description[index];
        }
        return String(quality);
    }
})();
