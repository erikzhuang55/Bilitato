import { callAI, getModelCapability } from "../utils/providerAdapter.js";

const keyNames = {
    openai: "OPENAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    kimi: "KIMI_API_KEY",
    gemini: "GEMINI_API_KEY",
    claude: "ANTHROPIC_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    zhipu: "ZHIPU_API_KEY"
};

const [provider, model, effort = "auto", task = "chat"] = process.argv.slice(2);
const keyName = keyNames[provider];
if (!keyName || !model || !["auto", "low", "medium", "high"].includes(effort) || !["chat", "summary", "segments"].includes(task)) {
    console.error("用法: node scripts/smokeReasoningEffort.js <provider> <model> [auto|low|medium|high] [chat|summary|segments]");
    process.exit(2);
}
if (getModelCapability(provider, model).parameterMode === "provider_default" && !(provider === "zhipu" && /^glm-5\.3(?:-flash)?$/i.test(model))) {
    console.error("该模型没有已知的推理强度参数映射，测试已停止。");
    process.exit(2);
}
const apiKey = process.env[keyName];
if (!apiKey) {
    console.error(`缺少 ${keyName} 环境变量。`);
    process.exit(2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 90000);
try {
    const result = await callAI(provider, {
        provider,
        model,
        apiKey,
        requestTask: task,
        reasoningEffort: effort === "auto" ? "" : effort,
        maxOutputTokens: 4096
    }, [{ role: "user", content: "只回答 OK。" }], controller.signal);
    console.log(`通过: ${provider} / ${model} / ${task} / ${effort}；返回 ${String(result?.text || "").length} 字符`);
} catch (error) {
    console.error(`失败: ${provider} / ${model} / ${task} / ${effort}；状态 ${error?.status || "未知"}；${String(error?.message || error?.code || "未知错误").slice(0, 240)}`);
    process.exitCode = 1;
} finally {
    clearTimeout(timeout);
}
