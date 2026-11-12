import { afterEach, describe, expect, it, vi } from "vitest";
import { callAI } from "../utils/providerAdapter.js";

function createConfig(requestTask) {
    return {
        provider: "mimo",
        apiKey: "test-key",
        model: "mimo-v2.6-flash",
        providerModels: { mimo: "mimo-v2.6-flash" },
        requestTask
    };
}

describe("MiMo thinking policy", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each(["summary", "segments"])("disables thinking for %s", async (requestTask) => {
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

        await callAI("mimo", createConfig(requestTask), [{ role: "user", content: "test" }]);

        expect(requestBody.thinking).toEqual({ type: "disabled" });
    });

    it("keeps chat on the provider default", async () => {
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

        await callAI("mimo", createConfig("chat"), [{ role: "user", content: "test" }]);

        expect(requestBody).not.toHaveProperty("thinking");
    });
});
