import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const buildScript = readFileSync(new URL("../scripts/build-release.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");
const contentCss = readFileSync(new URL("../content.css", import.meta.url), "utf8");
const releaseNotice = readFileSync(new URL("../content/contentReleaseNotice.js", import.meta.url), "utf8");
const sidepanel = readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
const sidepanelHtml = readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
const sidepanelCss = readFileSync(new URL("../sidepanel.css", import.meta.url), "utf8");
const inject = readFileSync(new URL("../inject.js", import.meta.url), "utf8");
const videoCacheCidMigration = readFileSync(new URL("../supabase/migrations/20260710095455_add_cid_isolation_to_video_cache.sql", import.meta.url), "utf8");

describe("native side panel", () => {
  it("declares the Chrome side panel entry and permissions", () => {
    expect(manifest.permissions).toContain("sidePanel");
    expect(manifest.permissions).toContain("webRequest");
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.side_panel?.default_path).toBe("sidepanel.html");
    expect(manifest.host_permissions).toContain("*://*.bilibili.com/*");
    expect(manifest.host_permissions).not.toContain("https://api.bilibili.com/*");
  });

  it("includes side panel files in release packages", () => {
    expect(buildScript).toContain('"sidepanel.html"');
    expect(buildScript).toContain('"sidepanel.css"');
    expect(buildScript).toContain('"sidepanel.js"');
  });

  it("connects opening, state reads, and page actions", () => {
    expect(background).toContain('msg.action === "OPEN_SIDE_PANEL"');
    expect(background).toContain('msg.action === "CLEAR_TASK_ERRORS"');
    expect(background).toContain("setPanelBehavior({ openPanelOnActionClick: true })");
    expect(content).toContain('"SIDE_PANEL_CONTENT_ACTION"');
    expect(sidepanel).toContain('action: "GET_BOOTSTRAP"');
    expect(sidepanel).toContain('action: "RUN_TASKS"');
    expect(sidepanel).toContain('action: "RUN_CHAT_STREAM"');
    expect(sidepanel).toContain('data-streaming-answer="true"');
    expect(sidepanel).toContain("list.scrollTop = list.scrollHeight");
    expect(sidepanel).toContain('action: "SAVE_SETTINGS"');
  });

  it("hides embedded UI while the native side panel is open", () => {
    expect(content).toContain('command === "set-embedded-visible"');
    expect(content).toContain("function setEmbeddedPanelVisible");
    expect(sidepanel).toContain("hideEmbeddedForActiveTab");
    expect(sidepanel).toContain("restoreHiddenEmbedded");
    expect(sidepanel).toContain("switchingToEmbedded");
    expect(sidepanel).toContain("if (!state.switchingToEmbedded)");
    expect(sidepanel).toContain('command: "set-embedded-visible"');
    expect(sidepanel).toContain('window.addEventListener("pagehide"');
  });

  it("checks database driven update availability without frequent polling", () => {
    expect(manifest.version).toBe("1.5.0");
    expect(background).toContain('msg.action === "CHECK_LATEST_VERSION"');
    expect(background).toContain('msg.action === "OPEN_EXTENSION_MANAGEMENT"');
    expect(background).toContain("VERSION_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000");
    expect(background).toContain("SUPABASE_DEFAULT_VERSION_TABLE");
    expect(background).toContain("extension_versions");
    expect(content).toContain("version-update-badge");
    expect(content).toContain('action: "CHECK_LATEST_VERSION"');
    expect(content).toContain('action: "OPEN_EXTENSION_MANAGEMENT"');
    expect(content).toContain("showDebugVersionUpdateBadge");
    expect(content).toContain('data-action="debug-show-version-update"');
    expect(content).toContain(">有可用版本更新</button>");
    expect(content).not.toContain("有可用版本更新 v${latest}");
    expect(sidepanel).toContain("version-update-badge");
    expect(sidepanel).toContain("checkLatestVersionAvailability");
    expect(sidepanel).toContain(">有可用版本更新</button>");
    expect(sidepanel).not.toContain("有可用版本更新 v${latest}");
  });

  it("ships the 1.5 release notice page", () => {
    expect(releaseNotice).toContain('"1.5.0"');
    expect(releaseNotice).toContain("Bilitato 已更新至 v1.5");
    expect(releaseNotice).toContain("修复同一视频不同分 P 字幕串线");
    expect(releaseNotice).toContain("修复字幕语言回切失败");
    expect(releaseNotice).toContain("新增浏览器侧边栏模式");
    expect(releaseNotice).toContain('"1.4.x"');
    expect(releaseNotice).toContain("Bilitato v1.4 系列更新回顾");
    expect(releaseNotice).toContain('majorHistory.push("1.5.0", "1.4.x"');
  });

  it("applies theme settings to release notice and setup guide overlays", () => {
    expect(releaseNotice).toContain('overlay.dataset.theme = box.dataset.theme || "light"');
    expect(content).toContain('guideOverlay.dataset.theme = theme');
    expect(content).toContain('releaseOverlay.dataset.theme = theme');
    expect(content).toContain('overlay.dataset.theme = resolveThemeMode()');
    expect(contentCss).toContain('#setup-guide-overlay[data-theme="dark"] .guide-card');
    expect(contentCss).toContain('.release-notice-overlay[data-theme="dark"] .release-notice-card');
    expect(sidepanel).toContain('document.querySelector(".release-notice-overlay")?.setAttribute("data-theme", theme)');
  });

  it("keeps the embedded release notice above the header metrics control", () => {
    const metricsLayer = Number(contentCss.match(/\.logo-remaining-container\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);
    const releaseLayer = Number(contentCss.match(/\.release-notice-overlay\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);

    expect(releaseLayer).toBeGreaterThan(metricsLayer);
  });

  it("keeps the ModelScope preset list aligned with currently supported models", () => {
    const modelScopeList = content.match(/modelscope:\s*\[([\s\S]*?)\]/)?.[1] || "";
    expect(modelScopeList).toContain('"deepseek-ai/DeepSeek-V4-Flash"');
    expect(modelScopeList).toContain('"deepseek-ai/DeepSeek-V4-Pro"');
    expect(modelScopeList).toContain('"deepseek-ai/DeepSeek-V3.2"');
    expect(modelScopeList).toContain('"ZhipuAI/GLM-5.2"');
    expect(modelScopeList).not.toContain('"ZhipuAI/GLM-4.7-Flash"');
    expect(modelScopeList).toContain('"stepfun-ai/Step-3.7-Flash"');
    expect(content).toContain("DeepSeek-V4-Flash：50次/天");
    expect(content).toContain("DeepSeek-V3.2：20次/天");
    expect(content).toContain("GLM-5.2：50次/天");
    expect(content).toContain("Step-3.7-Flash：50次/天");
    expect(content).toContain("ModelScope官网近期下线了对部分模型的平台调用支持");
    expect(sidepanel).toContain("ModelScope官网近期下线了对部分模型的平台调用支持");
    expect(background).toContain('model: "deepseek-ai/DeepSeek-V4-Flash"');
    expect(background).toContain("LEGACY_MODELSCOPE_MODELS");
  });

  it("tracks ModelScope quota headers and uses compact segments first", () => {
    expect(background).toContain("modelscope-ratelimit-model-requests-limit");
    expect(background).toContain("x-modelscope-ratelimit-model-requests-limit");
    expect(background).toContain("x-ratelimit-model-requests-remaining");
    expect(background).toContain("modelscope-ratelimit-model-requests-remaining");
    expect(background).toContain("modelscope-ratelimit-requests-limit");
    expect(background).toContain("modelscope-ratelimit-requests-remaining");
    expect(background).toContain("getModelScopeDailyRequestLimit");
    expect(background).toContain('"deepseek-ai/deepseek-v4-flash": 50');
    expect(background).toContain("onHeadersReceived");
    expect(background).toContain('provider === "modelscope"');
    expect(content).toContain("模型剩余");
    expect(sidepanel).toContain("账号剩余");
  });

  it("uses one wrapped side panel tooltip for settings info icons", () => {
    expect(sidepanelCss).toContain("max-width: min(320px, calc(100vw - 16px))");
    expect(sidepanelCss).toContain("white-space: normal");
    expect(sidepanelCss).toContain(".settings-info-icon:hover::after");
    expect(sidepanelCss).toContain("display: none !important");
  });

  it("supports official subtitle language switching", () => {
    expect(existsSync(new URL("../assets/ui/default/language.png", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../assets/ui/active/language.png", import.meta.url))).toBe(true);
    expect(content).toContain('data-action="cc-language-menu"');
    expect(content).toContain('command === "get-subtitle-options"');
    expect(content).toContain('command === "switch-subtitle-language"');
    expect(content).toContain("[data-action='cc-switch-language']");
    expect(content).toContain("clearDerived: true");
    expect(content).toContain(".bpx-player-ctrl-subtitle-major-inner");
    expect(content).toContain("switchSubtitleLanguageByDom");
    expect(content).toContain("mergeSubtitleOptions(apiOptions, domOptions)");
    expect(content).toContain("resolveSubtitleRowsForOption(option, { forceRefresh: true })");
    expect(content).toContain("saveOfficialSubtitleRows(resolved.option, resolved.rows, resolved.cached)");
    expect(content).toContain("function applyOfficialSubtitleVariantToLocalCache");
    expect(content).toContain("function syncBiliSubtitleDomLanguage");
    expect(content).toContain("syncBiliSubtitleDomLanguage(targetOption)");
    expect(content).toContain("function getLocalZhSubtitleRows");
    expect(content).toContain('if (targetKey === "zh")');
    expect(content).toContain("subtitleVariants: variants");
    expect(content).toContain("rawSubtitle: rows");
    expect(content).not.toContain("if (!rows.length && option?.domLabel)");
    expect(content).toContain("await switchSubtitleLanguageByDom(targetOption)");
    expect(content).not.toContain("该语种暂不支持直接切换");
    expect(content).toContain("BILI_SWITCH_SUBTITLE_LANGUAGE");
    expect(inject).toContain('event.data?.type === "BILI_SWITCH_SUBTITLE_LANGUAGE"');
    expect(inject).toContain("switchSubtitleLanguageByLabel");
    expect(content).toContain("BILI_ALLOW_SUBTITLE_RECAPTURE");
    expect(inject).toContain('event.data?.type === "BILI_ALLOW_SUBTITLE_RECAPTURE"');
    expect(background).toContain("subtitleLanguage");
    expect(background).toContain("function getChineseSubtitleCache");
    expect(background).toContain("const aiCache = getChineseSubtitleCache(cache)");
    expect(background).toContain("clearDerived");
    expect(sidepanel).toContain('contentAction("switch-subtitle-language"');
    expect(content).toContain("const canSwitchOfficialSubtitle = rows.length > 0 && !isAsrSubtitle && !running");
    expect(sidepanel).toContain("const languageButton = canSwitchOfficialSubtitle");
    expect(sidepanel).toContain("showSubtitleLanguageMenu");
    expect(sidepanelCss).toContain(".subtitle-language-option.active");
    expect(sidepanelCss).toContain('.ai-summary-plugin-box[data-theme="dark"] .metrics-box');
  });

  it("keeps automatic subtitle capture invisible without blocking manual controls", () => {
    expect(inject).toContain("if (!event.isTrusted) return");
    expect(inject).toContain("manualOverrideRouteKey === getRouteVideoKey()");
    expect(inject).toContain('userSubtitlePreference = { mode: "unknown", label: "" }');
    expect(inject).toContain('userSubtitlePreference = /关闭/.test(label)');
    expect(inject).toContain('userSubtitlePreference.mode === "on"');
    expect(inject).toContain("restoreSilentSessionState");
    expect(inject).toContain("finishSilentSession");
    expect(inject).toContain("const retryDelays = [0, 80, 200, 400, 800]");
    expect(inject).toContain('emitLog("subtitle_stealth_close_pending"');
    expect(inject).toContain('emitLog("subtitle_route_reset", { bvid: capturedBvid, reason });\n        performSilentAutoTrigger();\n        scheduleAutoTriggerFlow');
    expect(content).toContain("allowDomOpen = false");
    expect(content).toContain("if (allowDomOpen && mergeSubtitleOptions(apiOptions, domOptions).length <= 1)");
  });

  it("defers subtitle follow scrolling until the new part player time settles", () => {
    expect(content).toContain("subtitleUiCoordinator.scrollUnlockAt = Number.POSITIVE_INFINITY");
    expect(content).toContain("armSubtitleScrollAlignment(routeKey, generation)");
    expect(content).toContain('document.addEventListener("loadedmetadata", onMediaEvent, true)');
    expect(content).toContain('document.addEventListener("durationchange", onMediaEvent, true)');
    expect(content).toContain('document.addEventListener("timeupdate", onMediaEvent, true)');
    expect(content).toContain('fallbackTimer = setTimeout(() => unlock("fallback", false), 5000)');
    expect(content).toContain("listNode.scrollTop = 0");
    expect(content).toContain("const rows = getCurrentSubtitleStateRows()");
    expect(content).not.toMatch(/scrollUnlockAt = Math\.max\([\s\S]*?subtitleUiCoordinator\.scrollUnlockAt,[\s\S]*?Date\.now\(\) \+ 300/);
  });

  it("deduplicates route, playinfo, and subtitle follow polling", () => {
    expect(inject.match(/setInterval\(\(\) =>/g)?.length || 0).toBe(1);
    expect(inject).not.toContain("new MutationObserver(() =>");
    expect(content).toContain("const playInfoWaiters = new Set()");
    expect(content).toContain("resolvePlayInfoWaiters(normalizedInfo)");
    expect(content).not.toContain("for (let i = 0; i < 30; i++)");
    expect(content).toContain("appState.focusTickerTimer = setInterval");
    expect(content).not.toContain("requestAnimationFrame(loop)");
  });

  it("keeps the CC panel loading while a subtitle request is in flight", () => {
    expect(content).toContain('event.data.event === "subtitle_request_start"');
    expect(content).toContain("extendSubtitleUiLoadingForRequest");
    expect(content).toContain('event.data.event === "subtitle_response_done"');
    expect(content).toContain("completeSubtitleUiRequest");
    expect(content).toContain("pendingRequestUrls: new Set()");
    expect(content).toContain('scheduleSubtitleUiDeadline(routeKey, generation, 10000, "timeout")');
    expect(content).toContain('scheduleSubtitleUiDeadline(subtitleUiCoordinator.routeKey, subtitleUiCoordinator.generation, 1500, "unavailable")');
    expect(content).toContain('logSubtitleDiagnostic("ui_loading_extended"');
    expect(content).toContain('emptyTip.textContent = "正在读取字幕，请稍候..."');
  });

  it("separates absent subtitles, capture failures, and slow subtitle responses", () => {
    expect(content).toContain('subtitleUiCoordinator.phase = "probing"');
    expect(content).toContain('source: "subtitle_control_absent"');
    expect(content).toContain('scheduleSubtitleUiDeadline(routeKey, generation, 500, "unavailable")');
    expect(content).toContain("function isUsableSubtitleControl(node)");
    expect(content).toContain("function isSubtitleControlBarReady()");
    expect(content).toContain("controlProbeObserver: null");
    expect(content).toContain('stableWindowMs: 500');
    expect(content).toContain("Date.now() - startedAt >= 2000");
    expect(content).toContain('scheduleSubtitleUiDeadline(routeKey, generation, 10000, "timeout")');
    expect(content).toContain('data-action="${buttonAction}"');
    expect(content).toContain('const buttonAction = retryableSubtitleLoad ? "subtitle-load-retry" : "transcription-start"');
    expect(content).toContain('window.postMessage({ type: "BILI_RETRY_SUBTITLE_CAPTURE" }, "*")');
    expect(inject).toContain('event.data?.type === "BILI_RETRY_SUBTITLE_CAPTURE"');
  });

  it("detects missing subtitle controls independently from scroll alignment", () => {
    expect(content).not.toContain("if (!Number.isFinite(subtitleUiCoordinator.scrollUnlockAt))");
    expect(content).toMatch(/if \(isSubtitlePlayerReady\(\) && isSubtitleControlBarReady\(\)\)[\s\S]*?markSubtitleStateChanged\("subtitle_control_absent"\);/);
    expect(content).toMatch(/function isSubtitlePlayerReady\(\) \{[\s\S]*?return !!video && Number\(video\.readyState \|\| 0\) >= 1;/);
  });

  it("keeps subtitle fallback naming focused on transcription availability", () => {
    expect(content).toContain("function evaluateSubtitleFallback()");
    expect(content).toContain("function scheduleTranscriptionPrompt(meta)");
    expect(content).toContain("function scheduleTranscriptionAvailabilityCheck(source)");
    expect(content).toContain("function logPlayerApiCaptureDisabled(bvid)");
    expect(content).not.toContain("triggerDefaultSubtitleCapture");
    expect(content).not.toContain("scheduleSubtitleFallbackWatchdog");
    expect(content).not.toContain("fetchSubtitleByPlayerApi");
    expect(content).not.toContain("controlAvailable");
    expect(content).not.toContain("subtitleCaptureLock");
  });

  it("shows subtitle diagnostics only while debug mode is enabled", () => {
    expect(content).toMatch(/function logSubtitleDiagnostic\(event, detail = \{\}\) \{\s*if \(!isDebugLoggingEnabled\(\)\) return;/);
    expect(content).toContain('window.postMessage({ type: "BILI_SET_DEBUG_MODE", enabled: isDebugLoggingEnabled() }, "*")');
    expect(content).toContain('logSubtitleDiagnostic("source_disabled"');
    expect(inject).toContain("let subtitleDebugEnabled = false");
    expect(inject).toContain('event.data?.type === "BILI_SET_DEBUG_MODE"');
    expect(inject).toMatch(/function logSubtitleDiagnostic\(event, detail = \{\}\) \{\s*if \(!subtitleDebugEnabled\) return;/);
  });

  it("delegates full resets to the shared page reset", () => {
    expect(content).toMatch(/function resetAllState\(\) \{[\s\S]*?resetPageStateByBvidSwitch\(\);[\s\S]*?clearStreamCache\(\);/);
  });

  it("allows the cached Chinese CC variant to replace the injected display", () => {
    expect(content).toMatch(/if \(targetKey === "zh"\)[\s\S]*?subtitleUiCoordinator\.displaySource = "language_switch"/);
    expect(content).toMatch(/if \(targetKey === "zh"\)[\s\S]*?source: "language_switch"[\s\S]*?replace: true/);
    expect(content).toMatch(/if \(targetKey === "zh"\)[\s\S]*?delete ccPanel\.dataset\.subtitleDiagRenderSignature/);
  });

  it("does not leave a ready subtitle route showing the stale loading DOM", () => {
    expect(content).toContain("doesCcDomMatchRows(panel, rows)");
    expect(content).toContain("doesCcDomMatchLoading(panel)");
    expect(content).toContain("delete panel.dataset.subtitleDiagRenderSignature");
    expect(content).toContain("delete container.dataset.subtitleDiagRenderSignature");
    expect(content).toContain("canDirectRenderCurrentRoute");
    expect(content).toContain('logSubtitleDiagnostic("direct_render_skipped"');
    expect(content).toContain('reason: payloadP && currentUrlP && payloadP !== currentUrlP ? "payload_p_mismatch" : "route_state_not_aligned"');
  });

  it("records detailed resource timing for subtitle XHR requests", () => {
    expect(inject).toContain("logSubtitleResourceTiming(url, this, requestStartedAt, requestMeta)");
    expect(inject).toContain('logSubtitleDiagnostic("source_resource_timing"');
    expect(inject).toContain('emitLog("subtitle_resource_timing"');
    expect(inject).toContain("queueMs:");
    expect(inject).toContain("ttfbMs:");
    expect(inject).toContain("downloadMs:");
    expect(inject).toContain("nextHopProtocol");
  });

  it("stores ASR subtitles with the current part cid resolved from playurl", () => {
    expect(background).toContain("const effectiveCid = Number(media?.cid || media?.pageCid || cid || 0)");
    expect(background).toContain("cid: Number.isFinite(effectiveCid) ? effectiveCid : 0");
    expect(background).toContain("cid: Number(result?.identity?.cid || payload?.cid || 0)");
    expect(background).toContain("Number(params.get(\"p\") || state.p || fallbackData.page || 1)");
    expect(inject).toContain('_cid: Number.isFinite(currentCid) && currentCid > 0 ? currentCid : 0');
    expect(inject).toContain('emitLog("playinfo_stale_skip"');
    expect(inject).toContain("const stateMatchesRoute =");
    expect(content).toContain("const confirmedCid = await waitForConfirmedRouteCid(bvid)");
    expect(content).toContain("cid: confirmedCid");
  });

  it("restores existing ASR subtitles before starting another transcription", () => {
    expect(content).toContain("function getCurrentRouteCid()");
    expect(content).toContain("routeBvid === tabStateBvid");
    expect(content).toContain("function waitForConfirmedRouteCid(");
    expect(content).toContain('code: "PART_IDENTITY_PENDING"');
    expect(content).toContain('reason: "route_cid_pending"');
    expect(content).toContain('action: "SET_ACTIVE_PART"');
    expect(content).toContain("finishWithExistingSubtitle");
    expect(content).toContain("asrRequestDispatched: false");
    expect(content).toContain('action: "ABORT_TRANSCRIPTION"');
    expect(content).toContain('reason: "usable_subtitle_cache_arrived"');
    expect(background).toContain('const hasExplicitCid = Object.prototype.hasOwnProperty.call(msg || {}, "cid")');
    expect(background).toContain("cid: Number(hasExplicitCid ? msg.cid : (tabState?.activeCid || 0))");
    expect(background).toContain("if (!(cid > 0)) return null");
    expect(background).toContain("if (!identity.bvid || !(identity.cid > 0)) return null");
  });

  it("adds confirmed local cache cleanup actions in settings", () => {
    expect(background).toContain('msg.action === "DELETE_VIDEO_CACHE"');
    expect(background).toContain('msg.action === "DELETE_ALL_VIDEO_CACHE"');
    expect(background).toContain("buildDerivedCacheClearPatch");
    expect(background).not.toContain("cacheMemory.clear()");
    expect(content).toContain('data-action="settings-delete-current-cache"');
    expect(content).toContain('data-action="settings-delete-all-cache"');
    expect(content).toContain("本地字幕缓存会保留");
    expect(content).toContain('updateCloudCacheReadPref("current", true');
    expect(content).toContain('updateCloudCacheReadPref("all", true');
    expect(sidepanel).toContain('data-action="delete-current-cache"');
    expect(sidepanel).toContain('data-action="delete-all-cache"');
    expect(sidepanel).toContain("本地字幕缓存会保留");
    expect(sidepanel).toContain('updateCloudCacheReadPref("current", true');
    expect(sidepanel).toContain('updateCloudCacheReadPref("all", true');
  });

  it("adds cloud cache read controls in cache management", () => {
    expect(background).toContain("CLOUD_READ_DISABLED_BVIDS_KEY");
    expect(background).toContain('msg.action === "SET_CLOUD_CACHE_READ_PREF"');
    expect(background).toContain("shouldSkipCloudCacheRead");
    expect(content).toContain("缓存管理");
    expect(content).toContain("settings-disable-cloud-current");
    expect(content).toContain("settings-disable-cloud-all");
    expect(content).toContain("本视频不拉取云端缓存");
    expect(content).toContain("已由所有视频设置覆盖");
    expect(content).toContain("currentCloudDisabledAttr = currentBvid && !allCloudDisabledOn");
    expect(content).toContain("所有视频不拉取云端缓存");
    expect(sidepanel).toContain("setting-disable-cloud-current");
    expect(sidepanel).toContain("setting-disable-cloud-all");
    expect(sidepanel).toContain("currentCloudDisabledAttr = getBvid() && !allCloudDisabledOn");
  });

  it("does not show the empty summary call-to-action under task errors", () => {
    expect(sidepanel).toContain("const errorHtml = taskErrorHtml");
    expect(sidepanel).toContain('errorHtml ? ""');
  });

  it("reuses the embedded subtitle and summary presentation", () => {
    expect(sidepanelHtml).toContain('<script src="markdownRenderer.js"></script>');
    expect(sidepanel).toContain('class="cc-row"');
    expect(sidepanel).toContain("MarkdownRenderer?.render(summary)");
    expect(sidepanel).toContain('class="result-text summary-result-text"');
    expect(sidepanel).toContain('class="chat-display-area"');
    expect(sidepanel).toContain("Hello, Ask me anything!");
    expect(sidepanel).toContain('action === "chat-suggest"');
    expect(sidepanel).toContain('class="real-notice"');
    expect(sidepanel).toContain('class="settings-scroll-body"');
    expect(sidepanel).toContain('data-action="open-setup-guide"');
    expect(sidepanel).toContain('data-action="open-register"');
    expect(sidepanel).toContain('class="feedback-card"');
    expect(sidepanel).toContain('data-action="switch-to-embedded"');
    expect(sidepanel).toContain("state.settingsScrollTop");
    expect(sidepanel).toContain("state.chatDraft");
    expect(sidepanel).toContain("官方AI字幕");
    expect(sidepanel).toContain("生成 AI 总结");
    expect(sidepanel).toContain("enhanceSettingsSelects()");
    expect(sidepanel).toContain("showActionMenu(nav.dataset.nav, nav)");
    expect(sidepanel).toContain("个性化");
    expect(sidepanel).toContain("settings-action-row");
    expect(content).toContain("settings-theme-mode");
    expect(sidepanel).toContain("setting-theme-mode");
    expect(content).toContain("dataset.theme");
    expect(sidepanel).toContain("data-theme");
    expect(background).toContain('themeMode: "system"');
    expect(sidepanel).toContain("syncSubtitlePlayback");
    expect(sidepanel).toContain('data-action="follow-now"');
    expect(content).toContain('command === "get-playback-state"');
    expect(sidepanelCss).toContain(".custom-select-trigger");
    expect(sidepanelCss).toContain(".copy-option-menu");
    expect(sidepanel).toContain("hasTaskContent");
    expect(sidepanel).toContain("chatWasAtBottom");
    expect(sidepanel).toContain('taskStatus("segments") === "processing"');
    expect(sidepanel).toContain('data-tooltip="切换回内嵌插件"');
    expect(sidepanel).toContain("showUiTooltip");
    expect(sidepanelCss).toContain(".side-ui-tooltip::before");
    expect(sidepanel).toContain('class="ad-tag"');
    expect(sidepanelCss).toContain(".segment-card.ad");
    expect(sidepanel).toContain("is-success");
    expect(sidepanel).toContain("showCopyFeedback");
    expect(sidepanel).toContain("summaryWasAtBottom");
    expect(sidepanel).toContain("state.chatGuideHidden = false");
    expect(sidepanel).toContain("state.activePartKey !== nextPartKey");
    expect(sidepanel).toContain('if (kind === "copy") showCopyFeedback(anchor, "复制")');
    expect(sidepanel).toContain('showToast("反馈提交成功")');
    expect(sidepanelCss).toContain("z-index: 2147483647");
    expect(sidepanelCss).toContain(".panel-icon-btn.is-loading");
    expect(sidepanelCss).toContain(".settings-reset-btn");
    expect(sidepanelCss).toContain("word-break: keep-all");
    expect(content).toContain('command === "open-setup-guide"');
    expect(content).toContain('command === "switch-to-embedded"');
    expect(sidepanel).toContain('action: "RUN_CHAT_STREAM"');
    expect(sidepanel).toContain("scheduleSettingsSave()");
    expect(sidepanel).toContain('contentAction("prepare-download"');
    expect(sidepanelHtml).toContain('content/contentErrorMessages.js');
    expect(sidepanelHtml).toContain('content/contentReleaseNotice.js');
    expect(background).toContain("msg?.tabId || port?.sender?.tab?.id");
    expect(background).toContain("fetchBiliPlayUrlForTab");
    expect(background).toContain("probeUrlStatusForTab");
    expect(background).toContain('world: "MAIN"');
    expect(sidepanelCss).toContain(".cc-row:hover");
    expect(sidepanelCss).toContain(".chat-footer");
    expect(sidepanelCss).toContain(".claim-card.fake");
    expect(sidepanelCss).not.toContain("border-bottom: 1px solid #f1f2f3");
  });

  it("rejects empty or placeholder-only feedback before submission", () => {
    expect(background).toContain("function isMeaningfulFeedbackText(value)");
    expect(background).toContain("标题不能为空哦");
    expect(background).toContain("内容不能为空哦");
    expect(content).toContain("function isMeaningfulFeedbackText(value)");
    expect(content).toContain("if (!isMeaningfulFeedbackText(title))");
    expect(content).toContain("if (!isMeaningfulFeedbackText(content))");
    expect(sidepanel).toContain("function isMeaningfulFeedbackText(value)");
    expect(sidepanel).toContain("if (!isMeaningfulFeedbackText(title))");
    expect(sidepanel).toContain("if (!isMeaningfulFeedbackText(content))");
  });

  it("isolates AI results and chat streams by video part", () => {
    expect(background).toContain("function createVideoCachePartKey(bvid, cid)");
    expect(background).toContain("function getPartCacheForContext");
    expect(background).toContain("taskStateByPart");
    expect(background).toContain('msg.action === "SET_ACTIVE_PART"');
    expect(background).toContain('cid: identity.cid > 0 ? `eq.${identity.cid}` : "is.null"');
    expect(background).toContain("buildSupabaseVideoPatch(bvid, settings, patch, partContext = {})");
    expect(background).toContain("params: hasExisting ? rowFilter : {}");
    expect(videoCacheCidMigration).toContain("video_cache_bvid_cid_unique");
    expect(videoCacheCidMigration).toContain("where cid is not null");
    expect(background).toContain('safePortPost(port, { type: "done", messageId, partKey: identity.partKey');
    expect(content).toContain("messagePartKey !== currentPartKey");
    expect(content).toContain('action: "SET_ACTIVE_PART"');
    expect(sidepanel).toContain("messagePartKey !== currentPartKey");
  });

  it("falls back to legacy cloud rows only for confirmed single-part videos", () => {
    expect(inject).toContain("partCount: stateMatchesRoute ? pages.length : 0");
    expect(inject).toContain("_partCount: Number(currentMeta.partCount || 0)");
    expect(content).toContain("function getCurrentRoutePartCount()");
    expect(content).toContain("partCount: getCurrentRoutePartCount()");
    expect(background).toContain("identity.partCount === 1");
    expect(background).toContain('source = "legacy_bvid"');
    expect(background).toContain('requestName: "cloud_video_cache_legacy_fetch"');
    expect(background).toContain('cid: "is.null"');
  });

  it("logs part-scoped AI cache decisions only in debug mode", () => {
    expect(background).toContain('console.log("[PART_SCOPE_DIAG]"');
    expect(background).toContain("if (!currentDebugMode) return");
    expect(background).toContain('"cloud_read_query"');
    expect(background).toContain('"cache_write_target"');
    expect(content).toContain('console.log("[PART_SCOPE_DIAG]"');
    expect(content).toContain("if (!isDebugLoggingEnabled()) return");
    expect(content).toContain('"storage_cache_candidate"');
    expect(content).toContain('"ui_render_read"');
    expect(sidepanel).toContain("if (!state.settings?.debugMode) return");
    expect(sidepanel).toContain('"bootstrap_response_received"');
  });

  it("finishes visible task progress before background post-processing returns", () => {
    expect(content).toContain("visibleProgressCompletedTaskIds: new Set()");
    expect(content).toContain("syncStepProgressByTaskState(appState.tabState)");
    expect(content).toContain("startAsymptoticPseudoProgress(activeTaskId, 18)");
    expect(content).toContain("if (!appState.visibleProgressCompletedTaskIds.has(taskId))");
  });

  it("renders subtitles from one route-scoped state without empty-cache replacement", () => {
    expect(content).toContain("function commitSubtitleRows(rows, options = {})");
    expect(content).toContain("function renderSubtitleIfNeeded(container, reason = \"state_change\")");
    expect(content).toContain("function scheduleSubtitleRender(reason = \"state_change\")");
    expect(content).toContain('reason: "current_rows_already_authoritative"');
    expect(content).toContain("const rows = getCurrentSubtitleStateRows()");
    expect(content.match(/renderCC\(/g)?.length || 0).toBe(2);
  });

  it("declares the content action listener at top level", () => {
    const sidePanelHandlerIndex = content.indexOf("function onSidePanelMessage");
    const backgroundHandlerIndex = content.indexOf("function onBackgroundMessage");

    expect(sidePanelHandlerIndex).toBeGreaterThan(0);
    expect(backgroundHandlerIndex).toBeGreaterThan(sidePanelHandlerIndex);
  });

  it("opens the side panel before any awaited setup can consume the click gesture", () => {
    const branchStart = background.indexOf('if (msg.action === "OPEN_SIDE_PANEL")');
    const branchEnd = background.indexOf('if (msg.action === "REPORT_ERROR")', branchStart);
    const openBranch = background.slice(branchStart, branchEnd);

    expect(openBranch).toContain("chrome.sidePanel.open({ tabId })");
    expect(openBranch).not.toContain("await chrome.sidePanel");
    expect(openBranch).not.toContain("setOptions");
  });
});
