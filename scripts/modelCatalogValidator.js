import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PROVIDER = 'modelscope';
const DEFAULT_BASE_URL = 'https://api-inference.modelscope.cn/v1';
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_VALIDATIONS = 20;
const TARGET_MODEL_PREFIXES = [
  'Qwen/',
  'deepseek-ai/',
  'meituan-longcat/',
  'MiniMax/',
  'mistralai/',
  'ZhipuAI/',
];

function envNumber(name, fallback, minimum = 1) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

export function normalizeCatalog(payload) {
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error('ModelScope 模型目录返回格式不正确：缺少 data 数组');
  }

  return [...new Set(payload.data
    .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

export function isTargetTextModel(modelId) {
  const id = String(modelId || '').trim();
  return TARGET_MODEL_PREFIXES.some((prefix) => id.startsWith(prefix))
    && !/^Qwen\/.*(?:Image|VL)/i.test(id);
}

export function diffCatalog(discoveredModels, knownModels) {
  const discovered = new Set(discoveredModels);
  const known = new Set(knownModels);
  return {
    added: [...discovered].filter((id) => !known.has(id)).sort(),
    missing: [...known].filter((id) => !discovered.has(id)).sort(),
    unchanged: [...discovered].filter((id) => known.has(id)).sort(),
  };
}

export function parseJsonContent(content) {
  if (typeof content !== 'string') throw new Error('响应内容不是字符串');
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    if (start < 0) throw new Error('响应中没有 JSON 对象');
    for (let end = start + 1; end < trimmed.length; end += 1) {
      if (trimmed[end] !== '}') continue;
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Keep scanning until the first complete JSON object is found.
      }
    }
    throw new Error('响应中没有完整的 JSON 对象');
  }
}

export function classifyProbeResults(results) {
  if (results.every((result) => result.status === 'ok')) return 'available';
  const priority = ['auth_error', 'rate_limited', 'unavailable', 'degraded', 'incompatible'];
  return priority.find((status) => results.some((result) => result.status === status)) || 'incompatible';
}

export function prioritizeValidationTargets(models, candidateById) {
  return [...models].sort((left, right) => {
    const leftCheckedAt = Date.parse(candidateById.get(left)?.last_checked_at || '');
    const rightCheckedAt = Date.parse(candidateById.get(right)?.last_checked_at || '');
    const leftTime = Number.isFinite(leftCheckedAt) ? leftCheckedAt : 0;
    const rightTime = Number.isFinite(rightCheckedAt) ? rightCheckedAt : 0;
    return leftTime - rightTime || left.localeCompare(right);
  });
}

function sanitizeError(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .slice(0, 500);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function classifyHttpFailure(status, body) {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (status === 404 || /model.{0,30}(not found|does not exist|不存在)/i.test(body)) return 'unavailable';
  if (status >= 500) return 'degraded';
  return 'incompatible';
}

async function runProbe({ baseUrl, apiKey, model, kind, timeoutMs }) {
  const isStream = kind === 'stream';
  const prompt = kind === 'json'
    ? 'Return only this JSON object with no markdown: {"ok":true,"items":[{"id":1}]}'
    : 'Reply with exactly OK.';
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    // Reasoning models may spend the first tokens in reasoning_content before
    // emitting message.content. A tiny limit would incorrectly reject them.
    max_tokens: kind === 'json' ? 256 : 128,
    temperature: 0,
    stream: isStream,
  };
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, timeoutMs);
    const text = await response.text();
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        kind,
        status: classifyHttpFailure(response.status, text),
        latencyMs,
        errorCode: `http_${response.status}`,
        errorMessage: sanitizeError(text || response.statusText),
      };
    }

    if (isStream) {
      let content = '';
      let reasoningContent = '';
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const event = JSON.parse(data);
          content += event?.choices?.[0]?.delta?.content || '';
          reasoningContent += event?.choices?.[0]?.delta?.reasoning_content || '';
        } catch {
          return { kind, status: 'incompatible', latencyMs, errorCode: 'invalid_sse', errorMessage: '流式响应包含无法解析的数据' };
        }
      }
      if (!content.trim()) {
        if (reasoningContent.trim()) {
          return { kind, status: 'degraded', latencyMs, errorCode: 'reasoning_only', errorMessage: '模型只返回了推理过程，没有最终文本' };
        }
        return { kind, status: 'incompatible', latencyMs, errorCode: 'empty_stream', errorMessage: '流式响应没有文本内容' };
      }
      return { kind, status: 'ok', latencyMs };
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return { kind, status: 'incompatible', latencyMs, errorCode: 'invalid_json_response', errorMessage: '接口返回的不是有效 JSON' };
    }
    const message = payload?.choices?.[0]?.message;
    const content = message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      if (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) {
        return { kind, status: 'degraded', latencyMs, errorCode: 'reasoning_only', errorMessage: '模型只返回了推理过程，没有最终文本' };
      }
      return { kind, status: 'incompatible', latencyMs, errorCode: 'empty_choices', errorMessage: '响应 choices 为空或没有文本内容' };
    }
    if (kind === 'json') {
      try {
        const parsed = parseJsonContent(content);
        if (parsed?.ok !== true || !Array.isArray(parsed?.items) || parsed.items[0]?.id !== 1) {
          throw new Error('JSON 结构不符合预期');
        }
      } catch (error) {
        return { kind, status: 'incompatible', latencyMs, errorCode: 'invalid_model_json', errorMessage: sanitizeError(error.message) };
      }
    }
    return { kind, status: 'ok', latencyMs };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      kind,
      status: 'degraded',
      latencyMs: Date.now() - startedAt,
      errorCode: timedOut ? 'timeout' : 'network_error',
      errorMessage: sanitizeError(error?.message),
    };
  }
}

async function validateModel(options) {
  const results = [];
  for (const kind of ['text', 'json', 'stream']) {
    const result = await runProbe({ ...options, kind });
    results.push(result);
    if (['auth_error', 'rate_limited', 'unavailable', 'degraded'].includes(result.status)) break;
  }
  const status = classifyProbeResults(results);
  return {
    status,
    probes: results,
    latencyMs: Math.max(...results.map((result) => result.latencyMs || 0)),
    errorCode: results.find((result) => result.status !== 'ok')?.errorCode || null,
    errorMessage: results.find((result) => result.status !== 'ok')?.errorMessage || null,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function readStateFile(path) {
  if (!path) return { candidates: [] };
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    return { candidates: Array.isArray(state?.candidates) ? state.candidates : [] };
  } catch (error) {
    if (error?.code === 'ENOENT') return { candidates: [] };
    throw new Error(`读取历史检测状态失败：${sanitizeError(error?.message)}`);
  }
}

async function writeSummary(report) {
  await writeFile('model-catalog-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const lines = [
    '# ModelScope 模型目录验证',
    '',
    `- 目录模型：${report.counts.discovered}`,
    `- 新发现：${report.counts.added}`,
    `- 目录消失（未删除）：${report.counts.missing}`,
    `- 本次验证：${report.counts.validated}`,
    `- 当前检测异常：${report.counts.unavailable}`,
    '',
  ];
  if (report.added.length) lines.push('## 新模型 / 新版本', '', ...report.added.map((id) => `- ${id}`), '');
  if (report.unavailable.length) lines.push('## 本次不可用或不兼容', '', ...report.unavailable.map((item) => `- ${item.model}: ${item.status}${item.errorCode ? ` (${item.errorCode})` : ''}`), '');
  if (report.statusChanges.length) lines.push('## 状态变化', '', ...report.statusChanges.map((item) => `- ${item.model}: ${item.from} → ${item.to}`), '');
  if (report.missing.length) lines.push('## 目录中消失（保留现有配置）', '', ...report.missing.map((id) => `- ${id}`), '');
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
}

export async function runValidator({ dryRun = false } = {}) {
  const baseUrl = (process.env.MODELSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const timeoutMs = envNumber('MODEL_VALIDATOR_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1_000);
  const concurrency = envNumber('MODEL_VALIDATOR_CONCURRENCY', DEFAULT_CONCURRENCY);
  const maxValidations = envNumber('MODEL_VALIDATOR_MAX_VALIDATIONS', DEFAULT_MAX_VALIDATIONS);
  const apiKey = process.env.MODELSCOPE_API_KEY || '';
  const statePath = process.env.MODEL_VALIDATOR_STATE_PATH || '';

  if (!dryRun && !apiKey) throw new Error('缺少 MODELSCOPE_API_KEY');

  const catalogResponse = await fetchWithTimeout(`${baseUrl}/models`, { headers: { Accept: 'application/json' } }, timeoutMs);
  if (!catalogResponse.ok) throw new Error(`读取 ModelScope 模型目录失败：HTTP ${catalogResponse.status}`);
  const discovered = normalizeCatalog(await catalogResponse.json()).filter(isTargetTextModel);

  const state = await readStateFile(statePath);
  const knownModels = [...new Set(state.candidates.map((row) => row.model_id))];
  const diff = diffCatalog(discovered, knownModels);
  const candidateById = new Map(state.candidates.map((row) => [row.model_id, row]));
  const targets = apiKey
    ? prioritizeValidationTargets(
      discovered,
      candidateById,
    ).slice(0, maxValidations)
    : [];
  const now = new Date().toISOString();

  const validations = [];
  if (targets.length) {
    const first = {
      model: targets[0],
      ...(await validateModel({ baseUrl, apiKey, model: targets[0], timeoutMs })),
    };
    validations.push(first);
    if (first.status !== 'auth_error') {
      validations.push(...await mapWithConcurrency(targets.slice(1), concurrency, async (model) => ({
        model,
        ...(await validateModel({ baseUrl, apiKey, model, timeoutMs })),
      })));
    }
  }

  const rows = [];
  for (const validation of validations) {
    const previous = candidateById.get(validation.model);
    const available = validation.status === 'available';
    const neutral = ['rate_limited', 'degraded', 'auth_error'].includes(validation.status);
    rows.push({
      provider: PROVIDER,
      model_id: validation.model,
      status: validation.status,
      first_seen_at: previous?.first_seen_at || now,
      last_seen_at: now,
      last_checked_at: now,
      consecutive_successes: available ? Number(previous?.consecutive_successes || 0) + 1 : (neutral ? Number(previous?.consecutive_successes || 0) : 0),
      consecutive_failures: available || neutral ? 0 : Number(previous?.consecutive_failures || 0) + 1,
      missing_runs: 0,
      latency_ms: validation.latencyMs,
      last_error_code: validation.errorCode,
      last_error_message: validation.errorMessage,
      last_check: { probes: validation.probes },
    });
  }

  for (const model of diff.added.filter((id) => !targets.includes(id))) {
    rows.push({
      provider: PROVIDER,
      model_id: model,
      status: 'candidate',
      first_seen_at: now,
      last_seen_at: now,
      consecutive_successes: 0,
      consecutive_failures: 0,
      missing_runs: 0,
      last_check: {},
    });
  }

  for (const model of diff.missing) {
    const previous = candidateById.get(model);
    rows.push({
      provider: PROVIDER,
      model_id: model,
      status: 'missing',
      first_seen_at: previous?.first_seen_at || now,
      last_checked_at: now,
      consecutive_successes: Number(previous?.consecutive_successes || 0),
      consecutive_failures: Number(previous?.consecutive_failures || 0),
      missing_runs: Number(previous?.missing_runs || 0) + 1,
      last_error_code: 'missing_from_catalog',
      last_error_message: '模型未出现在本次 ModelScope 推理目录中；未自动删除',
      last_check: {},
    });
  }

  const authFailed = validations.some((item) => item.status === 'auth_error');
  const unavailable = validations.filter((item) => item.status !== 'available');
  const statusChanges = validations
    .filter((item) => candidateById.has(item.model) && candidateById.get(item.model)?.status !== item.status)
    .map((item) => ({
      model: item.model,
      from: candidateById.get(item.model)?.status,
      to: item.status,
    }));

  const nextStateById = new Map(state.candidates.map((row) => [row.model_id, row]));
  for (const row of rows) nextStateById.set(row.model_id, row);

  const report = {
    provider: PROVIDER,
    dryRun,
    generatedAt: now,
    isInitialRun: state.candidates.length === 0,
    counts: {
      discovered: discovered.length,
      added: diff.added.length,
      missing: diff.missing.length,
      validated: validations.length,
      unavailable: unavailable.length,
    },
    discovered,
    added: diff.added,
    missing: diff.missing,
    unavailable,
    statusChanges,
    validations,
    stateCandidates: [...nextStateById.values()],
  };
  await writeSummary(report);
  if (authFailed) throw new Error('ModelScope API Key 无效或无权限；本次未写入 Supabase');
  return report;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const dryRun = process.argv.includes('--dry-run');
  runValidator({ dryRun })
    .then((report) => {
      console.log(JSON.stringify(report.counts));
      if (!process.env.MODELSCOPE_API_KEY) console.log('未配置 MODELSCOPE_API_KEY：本次只抓取目录，不发送验证请求。');
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
