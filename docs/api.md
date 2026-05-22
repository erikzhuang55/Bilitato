# Bilitato 接口文档

本文档记录 Bilitato 目前最重要的接口边界。这个项目是 Chrome Manifest V3 浏览器插件，不是传统后端服务，所以“接口”主要包括：

- 页面脚本和后台脚本之间的 `chrome.runtime.sendMessage` 消息接口
- 页面脚本和后台脚本之间的 `chrome.runtime.connect` 长连接接口
- 后台脚本主动推送给页面脚本的消息
- 项目封装的外部 HTTP API 调用
- `utils/` 下供其他模块调用的工具函数接口

## 通用约定

### 普通消息返回格式

所有通过 `chrome.runtime.sendMessage` 发给后台的消息，都会经过 `background.js` 里的统一包装。

成功时：

```js
{
  ok: true,
  ...result
}
```

失败时：

```js
{
  ok: false,
  error: "错误信息",
  code: "错误代码"
}
```

### 普通消息调用方式

```js
const res = await chrome.runtime.sendMessage({
  action: "GET_SETTINGS"
});

if (!res?.ok) {
  throw new Error(res?.error || "请求失败");
}
```

### 重要文件

| 文件 | 作用 |
|---|---|
| `manifest.json` | Chrome 插件入口配置 |
| `background.js` | 后台 service worker，处理消息、下载、缓存、AI 请求 |
| `content.js` | 注入到 B 站页面的主脚本 |
| `content/` | 页面功能模块 |
| `utils/httpClient.js` | HTTP 请求封装 |
| `utils/providerAdapter.js` | AI Provider 调用封装 |
| `utils/supabaseClient.js` | Supabase REST/RPC 调用封装 |

## 页面到后台消息接口

这些接口由页面脚本调用，后台脚本处理。处理入口在 `background.js` 的 `handleMessage(msg, sender)`。

### GET_BOOTSTRAP

**用途**

页面初始化时获取当前标签页状态、缓存、设置和可用 AI Provider。

**调用方**

`content.js`

**处理方**

`background.js`

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "GET_BOOTSTRAP",
  skipCloud: true
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"GET_BOOTSTRAP"` |
| skipCloud | boolean | 否 | 是否跳过云端缓存同步 |

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| tabId | number | 当前标签页 ID |
| tabState | object/null | 当前标签页状态 |
| cache | object/null | 当前 BV 视频缓存 |
| settings | object | 合并后的插件设置 |
| providers | object | 支持的 AI Provider 配置 |

### GET_CACHE

**用途**

获取指定 BV 号或当前标签页 BV 号对应的缓存。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "GET_CACHE",
  bvid: "BVxxxx",
  skipCloud: false
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"GET_CACHE"` |
| bvid | string | 否 | 指定视频 BV 号；不传则使用当前标签页状态里的 BV 号 |
| skipCloud | boolean | 否 | 是否跳过云端缓存同步 |

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| bvid | string | 实际读取的 BV 号 |
| cache | object/null | 缓存内容 |
| tabState | object/null | 当前标签页状态 |

### SUBTITLE_CAPTURED

**用途**

页面脚本捕获到字幕后通知后台。后台会清洗字幕、生成 hash、写入缓存，并更新标签页状态。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "SUBTITLE_CAPTURED",
  payload: {
    bvid: "BVxxxx",
    cid: 123456,
    tid: null,
    title: "视频标题",
    source: "official",
    subtitle: [
      { start: 0, end: 3.2, text: "字幕文本" }
    ]
  }
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"SUBTITLE_CAPTURED"` |
| payload.bvid | string | 是 | 视频 BV 号 |
| payload.cid | number | 否 | B 站 cid |
| payload.tid | string/null | 否 | 字幕轨道 ID |
| payload.title | string | 否 | 视频标题 |
| payload.source | string | 否 | 字幕来源，如 `official`、ASR 来源等 |
| payload.subtitle | array | 是 | 原始字幕数组 |

**返回**

```js
{ ok: true }
```

**副作用**

- 更新本地缓存
- 更新当前标签页状态
- 可能同步云端字幕缓存
- 可能向页面推送 `SUBTITLE_READY` 或 `UPDATE_STATE`

### RUN_TASKS

**用途**

触发 AI 任务，例如总结、分段、验真等。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "RUN_TASKS",
  tasks: ["summary", "segments"],
  bvid: "BVxxxx",
  force: true,
  taskContext: {
    title: "视频标题"
  }
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"RUN_TASKS"` |
| tasks | string[] | 是 | 任务列表；后台只接受 `TASK_KEYS` 中存在的任务 |
| bvid | string | 否 | 目标视频 BV 号 |
| force | boolean | 否 | 是否强制重新生成；不是 `false` 时默认强制 |
| taskContext | object | 否 | 任务上下文，如标题、时长等 |

**返回**

```js
{ ok: true }
```

**失败场景**

| 场景 | 错误 |
|---|---|
| 没有当前标签页 ID | `tabId 缺失` |
| `tasks` 为空或无效 | `任务为空` |

### RUN_CHAT

**用途**

向 AI 提问当前视频内容，并一次性返回完整回答。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "RUN_CHAT",
  text: "这个视频的核心观点是什么？",
  messageId: "msg-001",
  bvid: "BVxxxx"
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"RUN_CHAT"` |
| text | string | 是 | 用户问题 |
| messageId | string | 是 | 前端生成的消息 ID |
| bvid | string | 否 | 目标视频 BV 号 |

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| answer | string | AI 回答 |
| metrics | object | 调用耗时、token 等统计信息 |

### RUN_TRANSCRIBE_FALLBACK / GET_AUDIO_URL

**用途**

无官方字幕时，获取音频地址或触发转录兜底流程。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "RUN_TRANSCRIBE_FALLBACK",
  payload: {
    bvid: "BVxxxx",
    cid: 123456,
    title: "视频标题"
  }
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | `"RUN_TRANSCRIBE_FALLBACK"` 或 `"GET_AUDIO_URL"` |
| payload | object | 否 | 转录或音频解析所需上下文 |

**返回**

返回值由 `ContentProvider.transcribeFallback` 决定，通常包含音频地址、字幕、进度或转录结果相关信息。

### ABORT_TRANSCRIPTION

**用途**

中止当前标签页的转录任务。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "ABORT_TRANSCRIPTION",
  bvid: "BVxxxx"
});
```

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| aborted | number | 被中止的控制器数量 |

### ABORT_TAB_OPERATIONS

**用途**

中止当前标签页正在运行的任务，包括转录、AI 请求等。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "ABORT_TAB_OPERATIONS",
  reason: "page_unload"
});
```

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| aborted | number | 被中止的控制器数量 |

### CLEAR_SUBTITLE_CACHE

**用途**

清空某个 BV 号的字幕缓存。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "CLEAR_SUBTITLE_CACHE",
  bvid: "BVxxxx"
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"CLEAR_SUBTITLE_CACHE"` |
| bvid | string | 是 | 目标视频 BV 号 |

### SAVE_SETTINGS

**用途**

保存插件设置。后台会和默认设置合并，并同步运行时 debug 状态。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "SAVE_SETTINGS",
  settings: {
    provider: "openai",
    apiKey: "sk-...",
    model: "gpt-4o-mini"
  }
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"SAVE_SETTINGS"` |
| settings | object | 是 | 要保存的设置片段 |

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| settings | object | 合并后的完整设置 |

### GET_SETTINGS

**用途**

读取插件设置和支持的 AI Provider 列表。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "GET_SETTINGS"
});
```

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| settings | object | 合并后的插件设置 |
| providers | object | 支持的 AI Provider 配置 |

### DOWNLOAD_STREAM

**用途**

通过 Chrome 下载 API 下载视频、音频或字幕文件。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "DOWNLOAD_STREAM",
  payload: {
    url: "https://example.com/video.m4s",
    filename: "video.mp4"
  }
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"DOWNLOAD_STREAM"` |
| payload.url | string | 是 | 下载地址 |
| payload.filename | string | 否 | 保存文件名，默认 `download.mp4` |
| tabId | number | 否 | 指定标签页 ID；不传时使用发送者标签页 |

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| success | boolean | 是否成功提交下载 |
| downloadId | number | Chrome 下载任务 ID |

**失败场景**

| 场景 | 错误 |
|---|---|
| 缺少 URL | `URL is required` |
| 下载链接失效 | `DOWNLOAD_URL_UNVERIFIED` |
| Chrome 下载 API 失败 | `DOWNLOAD_CHROME_API_FAILED` |

### PROBE_URL

**用途**

检查下载链接是否仍然有效。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "PROBE_URL",
  payload: {
    url: "https://example.com/video.m4s"
  }
});
```

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| status | string | 链接状态，如 `ok`、`expired`、`unknown` |

### GET_COMPAT_PLAYURL

**用途**

通过后台获取兼容格式的 B 站播放地址。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "GET_COMPAT_PLAYURL",
  payload: {
    bvid: "BVxxxx",
    cid: 123456
  }
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"GET_COMPAT_PLAYURL"` |
| payload | object | 是 | 播放地址解析参数 |
| tabId | number | 否 | 指定标签页 ID |

**返回**

返回值由 `getCompatPlayUrlForTab` 决定，通常包含可下载或可播放的音视频 URL 信息。

### ENSURE_OPTIONAL_ORIGIN_PERMISSION

**用途**

检查或申请自定义 API 域名权限。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "ENSURE_OPTIONAL_ORIGIN_PERMISSION",
  baseUrl: "https://api.example.com/v1",
  request: true
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"ENSURE_OPTIONAL_ORIGIN_PERMISSION"` |
| baseUrl | string | 是 | 自定义 API 地址，必须是 HTTPS |
| request | boolean | 否 | 是否主动弹出权限申请 |

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| granted | boolean | 是否已拥有权限 |
| pattern | string | Chrome 权限匹配模式，例如 `https://api.example.com/*` |

### OPEN_PERMISSION_REQUEST_PAGE

**用途**

打开权限申请说明页。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "OPEN_PERMISSION_REQUEST_PAGE",
  baseUrl: "https://api.example.com/v1"
});
```

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| ok | boolean | 是否成功创建窗口或标签页 |
| windowId | number/null | popup 窗口 ID |
| tabId | number/null | 普通标签页 ID |

### REPORT_ERROR

**用途**

页面脚本向后台上报错误。后台会走统一错误采集流程，可能写入日志或上报 Sentry。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "REPORT_ERROR",
  error: {
    message: "页面脚本错误"
  },
  context: {
    source: "content",
    task: "summary"
  }
});
```

### LOG_ENTRY

**用途**

页面脚本写入运行日志。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "LOG_ENTRY",
  entry: {
    level: "info",
    message: "subtitle_detected",
    detail: {}
  }
});
```

### GET_LOGS

**用途**

读取当前内存中的全局日志。

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| logs | array | 日志列表 |

### CLEAR_LOGS

**用途**

清空当前内存中的全局日志。

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| cleared | boolean | 是否已清空 |

### SET_RUNTIME_DEBUG

**用途**

临时开启或关闭运行时 debug 模式。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "SET_RUNTIME_DEBUG",
  enabled: true,
  source: "settings"
});
```

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| enabled | boolean | 当前 debug 状态 |

## 长连接接口

长连接入口在 `background.js` 的 `chrome.runtime.onConnect`。当前只处理 `port.name === "chat-stream"`。

### chat-stream / RUN_CHAT_STREAM

**用途**

流式 AI 聊天。页面通过 port 发送问题，后台通过 port 持续推送增量内容。

**连接示例**

```js
const port = chrome.runtime.connect({ name: "chat-stream" });

port.postMessage({
  action: "RUN_CHAT_STREAM",
  text: "总结这个视频",
  messageId: "msg-001",
  bvid: "BVxxxx"
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| action | string | 是 | 固定为 `"RUN_CHAT_STREAM"` |
| text | string | 是 | 用户问题 |
| messageId | string | 是 | 消息 ID |
| bvid | string | 否 | 目标视频 BV 号 |

**后台推送消息**

后台通过 `port.postMessage` 推送，常见类型包括：

| type | 说明 |
|---|---|
| `delta` | 增量文本 |
| `done` | 流式回答结束 |
| `error` | 流式回答失败 |

**错误示例**

```js
{
  type: "error",
  messageId: "msg-001",
  error: "聊天失败",
  code: "NETWORK_ERROR"
}
```

### chat-stream / ABORT_CHAT_STREAM

**用途**

中止某条流式聊天请求。

**请求示例**

```js
port.postMessage({
  action: "ABORT_CHAT_STREAM",
  messageId: "msg-001"
});
```

## 后台到页面推送接口

这些消息由 `background.js` 主动发给 `content.js`。

### SUBTITLE_READY

**用途**

后台完成字幕处理后通知页面刷新字幕和缓存。

**消息示例**

```js
{
  action: "SUBTITLE_READY",
  bvid: "BVxxxx",
  cache: {},
  subtitle: [],
  tabState: {},
  reason: "fresh"
}
```

**字段说明**

| 字段 | 类型 | 说明 |
|---|---|---|
| bvid | string | 视频 BV 号 |
| cache | object/null | 标准化后的缓存 |
| subtitle | array | 原始字幕数组 |
| tabState | object/null | 标签页状态 |
| reason | string | 推送原因，通常为 `fresh` |

### UPDATE_STATE

**用途**

后台通知页面状态或缓存更新。字幕重复上报时也可能使用这个 action。

**消息示例**

```js
{
  action: "UPDATE_STATE",
  bvid: "BVxxxx",
  cache: {},
  subtitle: [],
  tabState: {},
  reason: "duplicate"
}
```

## 外部 HTTP 接口

### Bilibili 播放信息接口

**用途**

获取视频播放地址、字幕相关信息。

**调用位置**

`background.js`、`content.js`

**地址示例**

```text
https://api.bilibili.com/x/player/playurl
https://api.bilibili.com/x/player/v2
```

**常见参数**

| 字段 | 说明 |
|---|---|
| bvid | 视频 BV 号 |
| cid | 视频 cid |

**注意事项**

- 通常需要带上 B 站页面上下文或 cookie。
- 链接可能有时效，下载前需要通过 `PROBE_URL` 检查。

### AI Provider 接口

**用途**

调用不同模型服务完成总结、分段、聊天、验真等任务。

**封装位置**

`utils/providerAdapter.js`

**主要函数**

| 函数 | 说明 |
|---|---|
| `callAI(providerKey, config, messages, signal)` | 非流式 AI 调用 |
| `callAIStream(providerKey, config, messages, signal, onDelta)` | 流式 AI 调用 |

**支持的 Provider**

以 `utils/providerAdapter.js` 里的 `PROVIDERS` 为准，包含 OpenAI 兼容接口、DeepSeek、Moonshot、Groq 等。

### Supabase 接口

**用途**

读取或写入云端缓存、上报每日使用量等。

**封装位置**

`utils/supabaseClient.js`

**主要函数**

| 函数 | 说明 |
|---|---|
| `supabaseSelect(settings, tableName, params, options)` | 查询表数据 |
| `supabaseWrite(settings, tableName, body, options)` | 写入表数据 |
| `supabaseRpc(settings, rpcName, payload, options)` | 调用 Supabase RPC |

## 工具模块接口

### requestJson(url, options)

**文件**

`utils/httpClient.js`

**用途**

发送 HTTP 请求并解析 JSON 响应。

**调用示例**

```js
const { data, response, durationMs } = await requestJson(url, {
  method: "GET",
  timeoutMs: 10000,
  requestName: "example_request"
});
```

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| data | any | 解析后的响应体 |
| response | Response | 原始 fetch Response |
| durationMs | number | 请求耗时 |

**可能错误**

| code | 说明 |
|---|---|
| `TIMEOUT` | 请求超时 |
| `NETWORK_ERROR` | 网络错误 |
| `JSON_PARSE_ERROR` | JSON 解析失败 |
| `HTTP_4XX` / `HTTP_5XX` | HTTP 状态码错误 |

### createAppError(code, message, extra)

**文件**

`utils/appError.js`

**用途**

创建带 `code` 的业务错误，方便前端展示和日志归类。

**调用示例**

```js
throw createAppError("TIMEOUT", "网络请求超时", {
  requestName: "summary"
});
```

### robustJSONParse(str)

**文件**

`utils/jsonParse.js`

**用途**

解析 AI 返回的 JSON，容忍模型输出里夹带 Markdown 或额外文本的情况。

### buildPrompt(options)

**文件**

`utils/promptBuilder.js`

**用途**

根据任务类型、字幕、视频元信息和用户设置构造 AI Prompt。

### normalizeSegments(value)

**文件**

`utils/resultNormalize.js`

**用途**

标准化 AI 返回的分段/章节结果。

### normalizeRumors(value)

**文件**

`utils/resultNormalize.js`

**用途**

标准化 AI 返回的验真结果。

## 新增接口时的文档模板

以后新增 `action` 时，建议同时补下面这段。

```md
### ACTION_NAME

**用途**

说明这个接口解决什么问题。

**调用方**

说明哪个文件或模块调用它。

**处理方**

说明哪个文件或函数处理它。

**请求示例**

```js
chrome.runtime.sendMessage({
  action: "ACTION_NAME"
});
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|

**返回字段**

| 字段 | 类型 | 说明 |
|---|---|---|

**失败场景**

| 场景 | 错误 |
|---|---|

**副作用**

- 是否写缓存
- 是否调用外部 API
- 是否更新页面状态
- 是否触发下载或权限申请
```

