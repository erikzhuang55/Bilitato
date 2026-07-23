import { FFmpeg } from "./node_modules/@ffmpeg/ffmpeg/dist/esm/index.js";
import {
  DEFAULT_ASR_CHUNK_OVERLAP_SECONDS,
  DEFAULT_ASR_CHUNK_SECONDS,
  MIN_ASR_CHUNK_SECONDS,
  buildOverlappedChunkPlan,
  estimateSafeChunkSeconds,
  mergePlaintextChunkRows,
  mergeTimestampedChunkRows
} from "./utils/asrChunking.js";
import {
  buildGroqTranscriptionPrompt,
  parseGroqQuotaHeaders
} from "./utils/asrTranscription.js";
import {
  DEFAULT_GROQ_BASE_URL,
  buildAsrEndpoint,
  normalizeAsrBaseUrl
} from "./utils/asrEndpoints.js";
import {
  MIMO_ASR_CHUNK_SECONDS,
  MIMO_ASR_MODEL,
  MIMO_ASR_TRANSCRIBE_URL,
  blobToBase64DataUrl,
  buildMimoAsrRequestBody,
  extractMimoAsrText
} from "./utils/mimoAsr.js";

const FFMPEG_CORE_URL = chrome.runtime.getURL("node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js");
const SILICONFLOW_AUDIO_TRANSCRIBE_URL = "https://api.siliconflow.cn/v1/audio/transcriptions";
let ffmpegPromise = null;
const chunkSessions = new Map();
const audioUploadSessions = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const action = String(message?.action || "");
  if (!/^OFFSCREEN_CHUNK_AUDIO/.test(action)) return false;
  handleChunkMessage(action, message?.payload || {})
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({
      ok: false,
      error: error?.message || "音轨切片失败",
      code: error?.code || "ASR_CHUNKING_FAILED"
    }));
  return true;
});

async function handleChunkMessage(action, payload = {}) {
  if (action === "OFFSCREEN_CHUNK_AUDIO_UPLOAD_START") return startAudioUpload(payload);
  if (action === "OFFSCREEN_CHUNK_AUDIO_UPLOAD_APPEND") return appendAudioUpload(payload);
  if (action === "OFFSCREEN_CHUNK_AUDIO_UPLOAD_FINISH") return finishAudioUpload(payload);
  if (action === "OFFSCREEN_CHUNK_AUDIO_UPLOAD_RELEASE") return releaseAudioUpload(payload);
  if (action === "OFFSCREEN_CHUNK_AUDIO_PREPARE") return prepareChunkAudioSession(payload);
  if (action === "OFFSCREEN_CHUNK_AUDIO_TRANSCRIBE_ALL") return transcribePreparedChunks(payload);
  if (action === "OFFSCREEN_CHUNK_AUDIO_RELEASE") return releasePreparedChunks(payload);
  throw createOffscreenError("ASR_CHUNKING_FAILED", `未知切片动作：${action}`);
}

function startAudioUpload(payload = {}) {
  const expectedBytes = Number(payload?.expectedBytes || 0);
  const maxAudioBytes = Number(payload?.maxAudioBytes || 0);
  if (!(expectedBytes > 0) || !(maxAudioBytes > 0)) {
    throw createOffscreenError("ASR_CHUNKING_FAILED", "缺少音轨大小，无法准备切片");
  }
  const uploadId = `upload_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  audioUploadSessions.set(uploadId, {
    chunks: [],
    totalBytes: 0,
    expectedBytes,
    maxAudioBytes,
    mimeType: String(payload?.mimeType || "audio/mp4").trim() || "audio/mp4",
    provider: String(payload?.provider || "groq").toLowerCase()
  });
  return { uploadId };
}

function appendAudioUpload(payload = {}) {
  const uploadId = String(payload?.uploadId || "").trim();
  const session = audioUploadSessions.get(uploadId);
  if (!session) throw createOffscreenError("ASR_CHUNKING_SESSION_MISSING", "音轨传输会话不存在，请重新开始转录");
  const base64 = String(payload?.dataBase64 || "");
  if (!base64) throw createOffscreenError("ASR_CHUNKING_FAILED", "收到空音轨分块");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  session.totalBytes += bytes.byteLength;
  if (session.totalBytes > session.expectedBytes) {
    audioUploadSessions.delete(uploadId);
    throw createOffscreenError("ASR_CHUNKING_FAILED", "音轨传输大小异常，请重新开始转录");
  }
  session.chunks.push(bytes);
  return { receivedBytes: session.totalBytes };
}

async function finishAudioUpload(payload = {}) {
  const uploadId = String(payload?.uploadId || "").trim();
  const session = audioUploadSessions.get(uploadId);
  if (!session) throw createOffscreenError("ASR_CHUNKING_SESSION_MISSING", "音轨传输会话不存在，请重新开始转录");
  audioUploadSessions.delete(uploadId);
  if (session.totalBytes !== session.expectedBytes) {
    throw createOffscreenError("ASR_CHUNKING_FAILED", "音轨传输不完整，请重新开始转录");
  }
  const sourceBytes = new Uint8Array(session.totalBytes);
  let offset = 0;
  for (const chunk of session.chunks) {
    sourceBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return prepareChunkAudioSession({
    audioBytes: sourceBytes.buffer,
    mimeType: session.mimeType,
    maxAudioBytes: session.maxAudioBytes,
    provider: session.provider
  });
}

function releaseAudioUpload(payload = {}) {
  const uploadId = String(payload?.uploadId || "").trim();
  if (uploadId) audioUploadSessions.delete(uploadId);
  return { released: !!uploadId };
}

async function prepareChunkAudioSession(payload = {}) {
  const audioBytes = payload?.audioBytes instanceof ArrayBuffer ? payload.audioBytes : null;
  const audioUrl = String(payload?.audioUrl || "").trim();
  const mimeType = String(payload?.mimeType || "audio/mp4").trim() || "audio/mp4";
  const provider = String(payload?.provider || "groq").toLowerCase();
  const maxAudioBytes = Number(payload?.maxAudioBytes || 0);
  if ((!audioBytes && !audioUrl) || !(maxAudioBytes > 0)) {
    throw createOffscreenError("ASR_CHUNKING_FAILED", "缺少音轨数据，无法切片");
  }
  const sourceBytes = audioBytes || await fetchAudioBytes(audioUrl);
  const ffmpeg = await getFFmpegRuntime();
  const sessionPrefix = `asr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const inputName = `${sessionPrefix}.m4a`;
  const cleanupFiles = new Set([inputName]);
  try {
    const durationSec = await resolveAudioDurationSeconds(sourceBytes, mimeType);
    if (!(durationSec > 0)) {
      throw createOffscreenError("ASR_CHUNK_DURATION_UNKNOWN", "无法识别音轨时长，暂时不能自动切片转录");
    }
    await ffmpeg.writeFile(inputName, new Uint8Array(sourceBytes));
    const preferredChunkSeconds = provider === "mimo" ? MIMO_ASR_CHUNK_SECONDS : DEFAULT_ASR_CHUNK_SECONDS;
    let chunkSeconds = estimateSafeChunkSeconds(sourceBytes.byteLength, durationSec, maxAudioBytes, {
      fallbackSeconds: preferredChunkSeconds
    });
    if (chunkSeconds < MIN_ASR_CHUNK_SECONDS) {
      throw createOffscreenError("ASR_CHUNKING_UNSUPPORTED", "该音轨码率过高，当前自动切片仍无法稳定转录");
    }
    let plan = buildOverlappedChunkPlan(durationSec, chunkSeconds, DEFAULT_ASR_CHUNK_OVERLAP_SECONDS);
    let chunks = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      chunks = await exportAudioChunks(ffmpeg, inputName, sessionPrefix, plan, provider, cleanupFiles);
      const tooLargeChunk = chunks.find((chunk) => chunk.bytes >= maxAudioBytes);
      if (!tooLargeChunk) break;
      chunkSeconds = Math.floor(chunkSeconds * 0.7);
      if (chunkSeconds < MIN_ASR_CHUNK_SECONDS) {
        throw createOffscreenError("ASR_CHUNKING_UNSUPPORTED", "自动切片后单段音轨仍超出限制，请稍后再试");
      }
      plan = buildOverlappedChunkPlan(durationSec, chunkSeconds, DEFAULT_ASR_CHUNK_OVERLAP_SECONDS);
    }
    if (chunks.some((chunk) => chunk.bytes >= maxAudioBytes)) {
      throw createOffscreenError("ASR_CHUNKING_UNSUPPORTED", "自动切片后单段音轨仍超出限制，请稍后再试");
    }
    const sessionId = `${sessionPrefix}_${Math.random().toString(36).slice(2, 8)}`;
    chunkSessions.set(sessionId, { chunks, createdAt: Date.now() });
    return {
      sessionId,
      durationSec,
      chunkSeconds,
      overlapSeconds: DEFAULT_ASR_CHUNK_OVERLAP_SECONDS,
      chunkCount: chunks.length,
      chunks: chunks.map((chunk) => ({
        fileName: chunk.fileName,
        startSec: chunk.startSec,
        durationSec: chunk.durationSec,
        endSec: chunk.endSec,
        bytes: chunk.bytes,
        mimeType: chunk.mimeType
      }))
    };
  } finally {
    await cleanupFFmpegFiles(ffmpeg, cleanupFiles);
  }
}

function mapTranscriptionToRows(data, options = {}) {
  if (options?.noTimestamp) {
    const plain = String(data?.text || data?.result || data?.data?.text || "").trim();
    if (!plain) return [];
    return splitTranscriptionTextByPunctuation(plain).map((text, index) => ({
      start: null,
      end: null,
      text,
      index,
      noTimestamp: true
    }));
  }
  const segments = Array.isArray(data?.segments) ? data.segments : [];
  if (segments.length) {
    return segments
      .map((item, index) => {
        const start = Number(item?.start ?? 0);
        const endRaw = Number(item?.end ?? start + 3);
        const end = Number.isFinite(endRaw) ? endRaw : start + 3;
        const text = String(item?.text || "").trim();
        if (!text) return null;
        return {
          start: Number.isFinite(start) ? start : 0,
          end: Math.max(Number.isFinite(start) ? start : 0, end),
          text,
          index
        };
      })
      .filter(Boolean);
  }
  const plain = String(data?.text || "").trim();
  if (!plain) return [];
  return [{ start: 0, end: 10, text: plain, index: 0 }];
}

async function transcribePreparedChunks(payload = {}) {
  const sessionId = String(payload?.sessionId || "").trim();
  const requestedProvider = String(payload?.provider || "groq").toLowerCase();
  const provider = ["groq", "siliconflow", "mimo"].includes(requestedProvider) ? requestedProvider : "groq";
  const apiKey = String(payload?.apiKey || payload?.groqApiKey || "").trim();
  const model = String(payload?.model || payload?.groqModel || "").trim()
    || (provider === "siliconflow" ? "FunAudioLLM/SenseVoiceSmall" : (provider === "mimo" ? MIMO_ASR_MODEL : "whisper-large-v3-turbo"));
  const videoTitle = String(payload?.videoTitle || "").trim();
  const baseUrl = normalizeAsrBaseUrl(payload?.baseUrl, DEFAULT_GROQ_BASE_URL);
  const tabId = Number(payload?.tabId || 0);
  const bvid = String(payload?.bvid || "").trim();
  const session = chunkSessions.get(sessionId);
  if (!session) {
    throw createOffscreenError("ASR_CHUNKING_SESSION_MISSING", "切片会话不存在，请重新开始转录");
  }
  if (!apiKey) {
    const providerLabel = provider === "siliconflow" ? "硅基流动" : (provider === "mimo" ? "小米 MiMo" : "Groq");
    throw createOffscreenError("ASR_CHUNKING_FAILED", `缺少${providerLabel} API Key，无法分片转录`);
  }
  const chunks = Array.isArray(session.chunks) ? session.chunks : [];
  const mergedRows = [];
  let quota = null;
  const boundaries = [];
  const noTimestamp = provider === "siliconflow" || provider === "mimo";
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) {
      throw createOffscreenError("ASR_CHUNKING_CHUNK_MISSING", "切片数据不存在，请重新开始转录");
    }
    if (tabId) {
      await chrome.runtime.sendMessage({
        action: "OFFSCREEN_CHUNK_AUDIO_PROGRESS",
        payload: {
          sessionId,
          tabId,
          bvid,
          chunkIndex: index + 1,
          chunkCount: chunks.length,
          startSec: Number(chunk.startSec || 0),
          endSec: Number(chunk.endSec || 0)
        }
      }).catch(() => {});
    }
    const file = new File([chunk.audioBytes], chunk.fileName, { type: chunk.mimeType || "audio/mp4" });
    const result = provider === "siliconflow"
      ? await requestSiliconFlowChunkTranscription(file, apiKey, model)
      : provider === "mimo"
        ? await requestMimoChunkTranscription(file, apiKey, model)
        : await requestGroqChunkTranscription(file, apiKey, model, videoTitle, baseUrl);
    quota = result.quota || quota;
    const chunkRows = mapTranscriptionToRows(result.data, { noTimestamp });
    const beforeTail = mergedRows.length ? mergedRows.slice(-2).map((row) => serializeBoundaryRow(row, noTimestamp)) : [];
    const chunkHead = chunkRows.slice(0, 2).map((row) => serializeBoundaryRow(row, noTimestamp));
    const nextRows = noTimestamp
      ? mergePlaintextChunkRows(mergedRows, chunkRows)
      : mergeTimestampedChunkRows(
          mergedRows,
          chunkRows,
          Number(chunk.startSec || 0),
          index > 0 ? DEFAULT_ASR_CHUNK_OVERLAP_SECONDS : 0
        );
    const afterTail = nextRows.length ? nextRows.slice(-2).map((row) => serializeBoundaryRow(row, noTimestamp)) : [];
    boundaries.push({
      index,
      chunkIndex: index + 1,
      chunkCount: chunks.length,
      startSec: chunk.startSec,
      endSec: chunk.endSec,
      sourceHead: chunkHead,
      sourceTail: chunkRows.slice(-2).map((row) => serializeBoundaryRow(row, noTimestamp)),
      mergedTailBefore: beforeTail,
      mergedTailAfter: afterTail
    });
    mergedRows.length = 0;
    mergedRows.push(...nextRows);
  }
  return {
    rows: mergedRows,
    quota,
    diagnostics: {
      boundaries
    }
  };
}

async function releasePreparedChunks(payload = {}) {
  const sessionId = String(payload?.sessionId || "").trim();
  if (sessionId) chunkSessions.delete(sessionId);
  return { released: !!sessionId };
}

async function fetchAudioBytes(url) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      mode: "cors"
    });
  } catch (error) {
    throw createOffscreenError("ASR_CHUNK_FETCH_FAILED", `切片前下载音轨失败：${error?.message || error || "unknown error"}`);
  }
  if (!response.ok) {
    throw createOffscreenError("ASR_CHUNK_FETCH_FAILED", `切片前下载音轨失败：HTTP ${response.status}`);
  }
  return await response.arrayBuffer();
}

async function getFFmpegRuntime() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({ coreURL: FFMPEG_CORE_URL });
      return ffmpeg;
    })().catch((error) => {
      ffmpegPromise = null;
      throw createOffscreenError("ASR_CHUNKING_UNAVAILABLE", `FFmpeg 初始化失败：${error?.message || error || "unknown error"}`);
    });
  }
  return ffmpegPromise;
}

async function resolveAudioDurationSeconds(audioBytes, mimeType) {
  const durationFromElement = await readAudioDurationFromElement(audioBytes, mimeType).catch(() => 0);
  if (durationFromElement > 0) return durationFromElement;
  const ffmpeg = await getFFmpegRuntime();
  const probeName = `probe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.m4a`;
  try {
    await ffmpeg.writeFile(probeName, new Uint8Array(audioBytes));
    return await probeAudioDurationSeconds(ffmpeg, probeName);
  } finally {
    await ffmpeg.deleteFile(probeName).catch(() => {});
  }
}

async function readAudioDurationFromElement(audioBytes, mimeType) {
  const blob = new Blob([audioBytes], { type: mimeType || "audio/mp4" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const audio = new Audio();
      let settled = false;
      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", onLoadedMetadata);
        audio.removeEventListener("error", onError);
      };
      const onLoadedMetadata = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const duration = Number(audio.duration || 0);
        resolve(Number.isFinite(duration) ? duration : 0);
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("audio metadata load failed"));
      };
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
      audio.addEventListener("error", onError, { once: true });
      audio.src = blobUrl;
    });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function probeAudioDurationSeconds(ffmpeg, inputName) {
  const outputName = `${inputName}.duration.txt`;
  const exitCode = await ffmpeg.ffprobe([
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputName,
    "-o", outputName
  ]);
  if (exitCode !== 0) {
    throw createOffscreenError("ASR_CHUNK_DURATION_UNKNOWN", "无法识别音轨时长，暂时不能自动切片转录");
  }
  try {
    const output = await ffmpeg.readFile(outputName, "utf8");
    const duration = Number(String(output || "").trim());
    return Number.isFinite(duration) ? duration : 0;
  } finally {
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}

async function exportAudioChunks(ffmpeg, inputName, sessionPrefix, plan, provider, cleanupFiles) {
  const chunks = [];
  for (const item of plan) {
    const isMimo = provider === "mimo";
    const outputName = `${sessionPrefix}_${String(item.index).padStart(3, "0")}.${isMimo ? "mp3" : "m4a"}`;
    cleanupFiles.add(outputName);
    const outputArgs = isMimo
      ? ["-c:a", "libmp3lame", "-b:a", "64k", "-ar", "16000", "-ac", "1"]
      : ["-c:a", "copy", "-movflags", "+faststart"];
    const exitCode = await ffmpeg.exec([
      "-i", inputName,
      "-ss", String(item.startSec),
      "-t", String(item.durationSec),
      "-vn",
      "-map", "0:a:0",
      ...outputArgs,
      outputName
    ]);
    if (exitCode !== 0) {
      throw createOffscreenError("ASR_CHUNKING_FAILED", "音轨切片失败，请稍后重试");
    }
    const output = await ffmpeg.readFile(outputName, "binary");
    const exactBytes = output instanceof Uint8Array ? output.slice() : new Uint8Array(output || []);
    chunks.push({
      fileName: outputName,
      startSec: item.startSec,
      durationSec: item.durationSec,
      endSec: item.endSec,
      bytes: exactBytes.byteLength || 0,
      mimeType: isMimo ? "audio/mpeg" : "audio/mp4",
      audioBytes: exactBytes
    });
  }
  return chunks;
}

async function cleanupFFmpegFiles(ffmpeg, fileNames) {
  if (!ffmpeg || !fileNames?.size) return;
  for (const fileName of fileNames) {
    try {
      await ffmpeg.deleteFile(fileName);
    } catch (_) {}
  }
}

async function requestGroqChunkTranscription(audioFile, groqApiKey, groqModel, videoTitle, baseUrl) {
  const formData = new FormData();
  formData.append("file", audioFile);
  formData.append("model", groqModel);
  formData.append("response_format", "verbose_json");
  formData.append("prompt", buildGroqTranscriptionPrompt(videoTitle));
  formData.append("timestamp_granularities[]", "segment");
  const response = await fetch(buildAsrEndpoint(baseUrl, "audio/transcriptions", DEFAULT_GROQ_BASE_URL), {
    method: "POST",
    headers: { Authorization: `Bearer ${groqApiKey}` },
    body: formData
  });
  const quota = parseGroqQuotaHeaders(response.headers);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw createOffscreenError("ASR_CHUNK_TRANSCRIBE_FAILED", `Groq 转录失败（${response.status}）${detail ? `：${detail.slice(0, 180)}` : ""}`);
  }
  const data = await response.json().catch(() => null);
  return { data, quota };
}

async function requestSiliconFlowChunkTranscription(audioFile, apiKey, model) {
  const formData = new FormData();
  formData.append("file", audioFile);
  formData.append("model", model || "FunAudioLLM/SenseVoiceSmall");
  const response = await fetch(SILICONFLOW_AUDIO_TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 429) {
      throw createOffscreenError("ASR_RATE_LIMIT", "硅基流动限流，请稍后重试");
    }
    throw createOffscreenError("ASR_CHUNK_TRANSCRIBE_FAILED", `硅基流动转录失败（${response.status}）${detail ? `：${detail.slice(0, 180)}` : ""}`);
  }
  const data = await response.json().catch(() => null);
  return { data, quota: null };
}

async function requestMimoChunkTranscription(audioFile, apiKey, model) {
  const audioDataUrl = await blobToBase64DataUrl(audioFile);
  const response = await fetch(MIMO_ASR_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildMimoAsrRequestBody(audioDataUrl, model))
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 429) {
      throw createOffscreenError("ASR_RATE_LIMIT", "小米 MiMo 限流，请稍后重试");
    }
    throw createOffscreenError("ASR_CHUNK_TRANSCRIBE_FAILED", `小米 MiMo 转录失败（${response.status}）${detail ? `：${detail.slice(0, 180)}` : ""}`);
  }
  const responseData = await response.json().catch(() => null);
  const finishReason = String(responseData?.choices?.[0]?.finish_reason || "").trim();
  const text = extractMimoAsrText(responseData);
  if (finishReason && finishReason !== "stop") {
    throw createOffscreenError("ASR_CHUNK_TRANSCRIBE_INCOMPLETE", `小米 MiMo 返回未完成（${finishReason}），请重新转录`);
  }
  if (!text) {
    throw createOffscreenError("ASR_CHUNK_TRANSCRIBE_EMPTY", "小米 MiMo 返回了空分片，为避免生成残缺字幕，本次转录已停止");
  }
  return {
    data: { text },
    quota: null
  };
}

function createOffscreenError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function serializeBoundaryRow(row = {}, noTimestamp = false) {
  return {
    start: noTimestamp ? null : Number(row?.start || 0),
    end: noTimestamp ? null : Number(row?.end || 0),
    text: String(row?.text || "").trim()
  };
}

function splitTranscriptionTextByPunctuation(text) {
  const normalized = stripEmojiFromText(text)
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  const pieces = normalized.match(/[^。！？!?；;，,、\n]+[。！？!?；;，,、]?/g) || [normalized];
  const rows = [];
  let buffer = "";
  const flush = () => {
    const value = buffer.trim();
    if (value) rows.push(value);
    buffer = "";
  };
  pieces.forEach((piece) => {
    const value = String(piece || "").trim();
    if (!value) return;
    if (!buffer) {
      buffer = value;
      if (/[。！？!?；;]$/.test(value) || value.length >= 80) flush();
      return;
    }
    if ((buffer + value).length <= 80 && !/[。！？!?；;]$/.test(buffer)) {
      buffer += value;
    } else {
      flush();
      buffer = value;
    }
    if (/[。！？!?；;]$/.test(buffer) || buffer.length >= 80) flush();
  });
  flush();
  return rows.length ? rows : [normalized];
}

function stripEmojiFromText(text) {
  return String(text || "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\uFE0E\uFE0F\u200D]/g, "");
}
