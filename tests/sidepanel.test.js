import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const buildScript = readFileSync(new URL("../scripts/build-release.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const content = readFileSync(new URL("../content.js", import.meta.url), "utf8");
const releaseNotice = readFileSync(new URL("../content/contentReleaseNotice.js", import.meta.url), "utf8");
const sidepanel = readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
const sidepanelHtml = readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
const sidepanelCss = readFileSync(new URL("../sidepanel.css", import.meta.url), "utf8");
const inject = readFileSync(new URL("../inject.js", import.meta.url), "utf8");

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
    expect(releaseNotice).toContain('majorHistory.push("1.5.0", "1.4.3"');
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
    expect(content).toContain("该语种暂不支持直接切换");
    expect(content).toContain("BILI_SWITCH_SUBTITLE_LANGUAGE");
    expect(inject).toContain('event.data?.type === "BILI_SWITCH_SUBTITLE_LANGUAGE"');
    expect(inject).toContain("switchSubtitleLanguageByLabel");
    expect(content).toContain("BILI_ALLOW_SUBTITLE_RECAPTURE");
    expect(inject).toContain('event.data?.type === "BILI_ALLOW_SUBTITLE_RECAPTURE"');
    expect(background).toContain("subtitleLanguage");
    expect(background).toContain("clearDerived");
    expect(sidepanel).toContain('contentAction("switch-subtitle-language"');
    expect(content).toContain("const canSwitchOfficialSubtitle = rows.length > 0 && !isAsrSubtitle && !running");
    expect(sidepanel).toContain("const languageButton = canSwitchOfficialSubtitle");
    expect(sidepanel).toContain("showSubtitleLanguageMenu");
    expect(sidepanelCss).toContain(".subtitle-language-option.active");
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
    expect(sidepanel).toContain("state.activeBvid !== nextBvid");
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
