const els = {
    provider: document.getElementById("provider"),
    regLink: document.getElementById("reg-link"),
    apiKey: document.getElementById("apiKey"),
    model: document.getElementById("model"),
    customBaseUrl: document.getElementById("customBaseUrl"),
    prefMode: document.getElementById("prefMode"),
    debugMode: document.getElementById("debugMode"),
    promptSummary: document.getElementById("promptSummary"),
    promptSegments: document.getElementById("promptSegments"),
    promptRumors: document.getElementById("promptRumors"),
    save: document.getElementById("save"),
    status: document.getElementById("status")
};

let providers = {};
const appState = {
    settings: null
};
const logUI = globalThis.AIPluginLogger.create("ui", {
    getDebugMode: () => !!appState.settings?.debugMode
});

init();

async function init() {
    const res = await chrome.runtime.sendMessage({ action: "GET_SETTINGS" });
    providers = res.providers || {};
    appState.settings = res.settings || {};
    fillProviderOptions(providers);
    fillSettings(appState.settings);
    els.provider.addEventListener("change", updateProviderHint);
    els.save.addEventListener("click", saveSettings);
    updateProviderHint();
}

function fillProviderOptions(map) {
    const keys = Object.keys(map);
    els.provider.innerHTML = keys.map((key) => `<option value="${key}">${map[key].name}</option>`).join("");
}

function fillSettings(settings) {
    els.provider.value = settings.provider || "modelscope";
    els.apiKey.value = settings.apiKey || "";
    els.model.value = settings.model || "";
    els.customBaseUrl.value = settings.customBaseUrl || "";
    els.prefMode.value = settings.prefMode || "quality";
    els.debugMode.value = settings.debugMode ? "true" : "false";
    els.promptSummary.value = settings.prompts?.summary || "";
    els.promptSegments.value = settings.prompts?.segments || "";
    els.promptRumors.value = settings.prompts?.rumors || "";
}

function updateProviderHint() {
    const provider = providers[els.provider.value];
    els.regLink.href = provider?.regUrl || "#";
    els.regLink.textContent = `注册/获取 Key：${provider?.regUrl || "-"}`;
}

async function saveSettings() {
    const payload = {
        provider: els.provider.value,
        apiKey: els.apiKey.value.trim(),
        model: els.model.value.trim(),
        customBaseUrl: els.customBaseUrl.value.trim(),
        prefMode: els.prefMode.value,
        debugMode: els.debugMode.value === "true",
        prompts: {
            summary: els.promptSummary.value,
            segments: els.promptSegments.value,
            rumors: els.promptRumors.value
        }
    };
    logUI.info("storage_update", { source: "popup_save_settings", debug_mode: payload.debugMode });
    const res = await chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings: payload });
    appState.settings = res?.settings || payload;
    els.status.textContent = "已保存";
    setTimeout(() => {
        els.status.textContent = "";
    }, 1200);
}
