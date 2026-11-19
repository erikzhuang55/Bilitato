import { afterEach, describe, expect, it, vi } from "vitest";
import { callAI, PROVIDERS } from "../utils/providerAdapter.js";

function stubCompletion() {
    let requestBody;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
            choices: [{ message: { content: "ok" }, finish_reason: "stop" }]
        }), {
            status: 200,
            headers: { "content-type": "application/json" }
        });
    }));
    return () => requestBody;
}

describe("structured task reasoning disable policy", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("disables reasoning for versioned OpenAI models that support none", async () => {
        const getRequestBody = stubCompletion();
        const providerCatalog = {
            openai: {
                ...PROVIDERS.openai,
                model: "gpt-5.2",
                models: ["gpt-5.2"]
            }
        };

        await callAI("openai", {
            provider: "openai",
            apiKey: "test-key",
            model: "gpt-5.2",
            providerModels: { openai: "gpt-5.2" },
            providerCatalog,
            requestTask: "summary"
        }, [{ role: "user", content: "test" }]);

        expect(getRequestBody().reasoning_effort).toBe("none");
    });

    it("disables thinking for ModelScope GLM structured tasks", async () => {
        const getRequestBody = stubCompletion();
        const providerCatalog = {
            modelscope: {
                ...PROVIDERS.modelscope,
                model: "ZhipuAI/GLM-5.2",
                models: ["ZhipuAI/GLM-5.2"]
            }
        };

        await callAI("modelscope", {
            provider: "modelscope",
            apiKey: "test-key",
            model: "ZhipuAI/GLM-5.2",
            providerModels: { modelscope: "ZhipuAI/GLM-5.2" },
            providerCatalog,
            requestTask: "segments"
        }, [{ role: "user", content: "test" }]);

        expect(getRequestBody().chat_template_kwargs).toEqual({ enable_thinking: false });
    });

    it("does not change ModelScope GLM chat requests", async () => {
        const getRequestBody = stubCompletion();
        const providerCatalog = {
            modelscope: {
                ...PROVIDERS.modelscope,
                model: "ZhipuAI/GLM-5.2",
                models: ["ZhipuAI/GLM-5.2"]
            }
        };

        await callAI("modelscope", {
            provider: "modelscope",
            apiKey: "test-key",
            model: "ZhipuAI/GLM-5.2",
            providerModels: { modelscope: "ZhipuAI/GLM-5.2" },
            providerCatalog,
            requestTask: "chat"
        }, [{ role: "user", content: "test" }]);

        expect(getRequestBody()).not.toHaveProperty("chat_template_kwargs");
    });

    it("recomputes thinking parameters for each ModelScope fallback model", async () => {
        const requestBodies = [];
        vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
            requestBodies.push(JSON.parse(options.body));
            return new Response(JSON.stringify({
                choices: [{ message: { content: "ok" }, finish_reason: "stop" }]
            }), {
                status: 200,
                headers: { "content-type": "application/json" }
            });
        }));
        const models = [
            "Qwen/Qwen3.8-Flash-Next",
            "deepseek-ai/DeepSeek-V4.1-Flash-1017"
        ];
        const providerCatalog = {
            modelscope: {
                ...PROVIDERS.modelscope,
                model: models[0],
                models
            }
        };
        const baseConfig = {
            provider: "modelscope",
            apiKey: "test-key",
            providerCatalog,
            requestTask: "segments"
        };

        await callAI("modelscope", {
            ...baseConfig,
            model: models[0],
            providerModels: { modelscope: models[0] }
        }, [{ role: "user", content: "test" }]);
        await callAI("modelscope", {
            ...baseConfig,
            model: models[1],
            providerModels: { modelscope: models[1] }
        }, [{ role: "user", content: "test" }]);

        expect(requestBodies[0].enable_thinking).toBe(false);
        expect(requestBodies[0]).not.toHaveProperty("thinking");
        expect(requestBodies[1].thinking).toEqual({ type: "disabled" });
        expect(requestBodies[1]).not.toHaveProperty("enable_thinking");
    });
});
