import { afterEach, describe, expect, it, vi } from "vitest";
import { callAI } from "../utils/providerAdapter.js";

async function requestBody(provider, model, task = "chat", effort = "", extraConfig = {}) {
    let body;
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
        body = JSON.parse(options.body);
        const response = provider === "gemini"
            ? { candidates: [{ content: { parts: [{ text: "ok" }] } }] }
            : provider === "claude"
                ? { content: [{ type: "text", text: "ok" }] }
                : { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { "content-type": "application/json" }
        });
    }));
    await callAI(provider, {
        provider,
        apiKey: "test-key",
        model,
        requestTask: task,
        reasoningEffort: effort,
        ...extraConfig
    }, [{ role: "user", content: "只回答 OK" }]);
    return body;
}

describe("reasoning parameters sent to providers", () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each([
        ["openai", "gpt-6.2-sol", "reasoning_effort", "medium"],
        ["deepseek", "deepseek-flash", "reasoning_effort", "high"],
        ["kimi", "kimi-k3", "reasoning_effort", "low"],
        ["gemini", "gemini-3.8-flash", "generationConfig.thinkingConfig.thinkingLevel", "medium"],
        ["claude", "claude-sonnet-5-5", "output_config.effort", "medium"],
        ["openrouter", "openai/gpt-6.2-sol", "reasoning.effort", "medium"],
        ["zhipu", "glm-5.3", "reasoning_effort", "high"]
    ])("sends valid chat effort values to %s", async (provider, model, path, automatic) => {
        for (const effort of ["", "low", "medium", "high"]) {
            const body = await requestBody(provider, model, "chat", effort);
            const sent = path.split(".").reduce((value, key) => value?.[key], body);
            const expected = provider === "zhipu" && effort === "medium" ? "high" : effort || automatic;
            expect(sent).toBe(expected);
            expect(body.temperature).toBeUndefined();
            if (provider === "zhipu") expect(body.thinking).toEqual({ type: "enabled" });
        }
    });

    it("uses supported summary defaults and does not combine disable with effort", async () => {
        expect((await requestBody("openai", "gpt-6.2-sol", "summary")).reasoning_effort).toBe("low");
        expect((await requestBody("openai", "gpt-6.1-sol", "summary")).reasoning_effort).toBe("low");
        expect((await requestBody("openai", "gpt-5.6", "summary")).reasoning_effort).toBe("none");
        const deepseek = await requestBody("deepseek", "deepseek-flash", "summary");
        expect(deepseek.thinking).toEqual({ type: "disabled" });
        expect(deepseek.reasoning_effort).toBeUndefined();
        expect((await requestBody("kimi", "kimi-k3", "summary")).reasoning_effort).toBe("low");
        expect((await requestBody("gemini", "gemini-3.8-flash", "summary")).generationConfig.thinkingConfig.thinkingLevel).toBe("low");
        expect((await requestBody("claude", "claude-sonnet-5-5", "summary")).output_config.effort).toBe("low");
        expect((await requestBody("openrouter", "openai/gpt-6.2-sol", "summary")).reasoning.effort).toBe("low");
        const zhipu = await requestBody("zhipu", "glm-5.3-flash", "summary");
        expect(zhipu).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "low" });
        const modelscope = await requestBody("modelscope", "Qwen/Qwen3.8-Flash-Next", "summary");
        expect(modelscope.enable_thinking).toBe(false);
        expect(modelscope.reasoning_effort).toBeUndefined();
        const mimo = await requestBody("mimo", "mimo-v2.6-flash", "summary");
        expect(mimo.thinking).toEqual({ type: "disabled" });
        expect(mimo.reasoning_effort).toBeUndefined();
    });

    it("clamps unsupported GPT-6 Astra, 6.1 Sol, and 6.2 none requests to low", async () => {
        expect((await requestBody("openai", "gpt-6-astra", "chat", "none")).reasoning_effort).toBe("low");
        expect((await requestBody("openai", "gpt-6.1-sol", "chat", "none")).reasoning_effort).toBe("low");
        expect((await requestBody("openai", "gpt-6.2-astra", "chat", "none")).reasoning_effort).toBe("low");
        const remote = await requestBody("openai", "gpt-6.1-sol", "summary", "", {
            requestPolicies: {
                enabled: true,
                schemaVersion: 1,
                rules: [{ provider: "openai", modelPattern: "^gpt-6\\.1-sol$", tasks: ["summary"], mode: "disabled", transport: "reasoning_effort" }]
            }
        });
        expect(remote.reasoning_effort).toBe("low");
    });
});
