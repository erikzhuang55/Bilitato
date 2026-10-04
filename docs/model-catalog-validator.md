# ModelScope 模型目录自动验证

该任务每天北京时间 04:00 读取 ModelScope 国内推理目录，只跟踪 Qwen、DeepSeek、Meituan LongCat、MiniMax、Mistral 和智谱 GLM 六个文本模型系列，并验证新增或需要复检的模型是否兼容 Bilitato 使用的聊天接口。图片、视觉模型不会进入检测范围。

每天检查目录中的全部目标文本模型，每个模型依次执行三项小请求：普通文本、JSON 内容和流式输出。检测器只记录状态和提醒，不修改扩展的远程配置，也不自动发布版本。

每天的完整报告保存在 GitHub Actions 摘要和 Artifact 中。只有出现不可用、限流、超时或新版本时，才会创建或更新一条统一的“ModelScope 模型异常汇总（自动更新）”Issue；所有模型恢复后会自动评论并关闭。是否修改模型列表、升级扩展版本和提交 Chrome 商店均由你人工决定。

## 首次启用

1. 在 GitHub 仓库的 Actions secrets 中配置 `MODELSCOPE_API_KEY`。
2. 在 Actions 中手动运行一次 `Model catalog validator`，确认报告正常；之后任务每天自动运行一次。

API Key 只能保存在 GitHub Secrets 中，不能写入扩展、仓库或浏览器端代码。历史状态保存在自动维护的 GitHub Issue 中，不需要数据库密钥。

## 本地检查

仅抓取公开目录，不发送模型测试请求：

```powershell
npm run models:validate:dry-run
```

配置 `MODELSCOPE_API_KEY` 后使用 `--dry-run`，可以实际验证，但不会更新 GitHub Issue：

```powershell
npm run models:validate:dry-run
```

正式运行：

```powershell
npm run models:validate
```

每次运行会生成 `model-catalog-report.json`；GitHub Actions 同时会把摘要写入任务页面并保留报告 14 天。

## 可调参数

- `MODEL_VALIDATOR_CONCURRENCY`：并发数，默认 2。
- `MODEL_VALIDATOR_TIMEOUT_MS`：单次请求超时，默认 45000 毫秒。
- `MODEL_VALIDATOR_MAX_VALIDATIONS`：单次最多实际调用并验证的模型数，默认 20，足以覆盖当前 16 个目标文本模型。
- `MODELSCOPE_BASE_URL`：仅用于测试或切换兼容端点。
