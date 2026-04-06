(async () => {
    const domainEl = document.getElementById("domain");
    const statusEl = document.getElementById("status");
    const grantBtn = document.getElementById("grant-btn");
    const closeBtn = document.getElementById("close-btn");

    const setStatus = (text, type = "") => {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = type ? type : "";
    };

    let baseUrl = "";
    let origin = "";
    try {
        const params = new URLSearchParams(window.location.search);
        baseUrl = String(params.get("baseUrl") || "").trim();
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "https:") {
            throw new Error("只支持 https 域名授权");
        }
        origin = parsed.origin;
        if (domainEl) {
            domainEl.textContent = `${origin}/*`;
        }
    } catch (error) {
        if (domainEl) {
            domainEl.textContent = "域名无效";
        }
        setStatus(error?.message || "Base URL 格式无效", "error");
        if (grantBtn) grantBtn.disabled = true;
    }

    closeBtn?.addEventListener("click", () => window.close());

    grantBtn?.addEventListener("click", async () => {
        if (!origin) return;
        const pattern = `${origin}/*`;
        grantBtn.disabled = true;
        setStatus("正在请求授权...");
        try {
            const alreadyGranted = await chrome.permissions.contains({ origins: [pattern] });
            const granted = alreadyGranted || await chrome.permissions.request({ origins: [pattern] });
            if (!granted) {
                throw new Error("你取消了该域名授权");
            }
            setStatus("域名已授权，可以返回插件继续使用。", "success");
            setTimeout(() => window.close(), 900);
        } catch (error) {
            grantBtn.disabled = false;
            setStatus(error?.message || "授权失败，请重试", "error");
        }
    });
})();
