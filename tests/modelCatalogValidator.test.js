import { describe, expect, it } from 'vitest';
import {
  classifyProbeResults,
  diffCatalog,
  isTargetTextModel,
  normalizeCatalog,
  parseJsonContent,
  prioritizeValidationTargets,
} from '../scripts/modelCatalogValidator.js';

describe('model catalog validator', () => {
  it('normalizes and deduplicates the catalog', () => {
    expect(normalizeCatalog({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, {}] })).toEqual(['a', 'b']);
  });

  it('detects added and missing models', () => {
    expect(diffCatalog(['a', 'b'], ['b', 'c'])).toEqual({
      added: ['a'],
      missing: ['c'],
      unchanged: ['b'],
    });
  });

  it('keeps only the requested text model families', () => {
    expect(isTargetTextModel('deepseek-ai/DeepSeek-V4-Pro')).toBe(true);
    expect(isTargetTextModel('meituan-longcat/LongCat-Flash-Lite')).toBe(true);
    expect(isTargetTextModel('MiniMax/MiniMax-M3')).toBe(true);
    expect(isTargetTextModel('mistralai/Mistral-Large-Instruct-2407')).toBe(true);
    expect(isTargetTextModel('ZhipuAI/GLM-5.2')).toBe(true);
    expect(isTargetTextModel('Qwen/Qwen3.8-Flash-Next')).toBe(true);
    expect(isTargetTextModel('Qwen/Qwen-Image-Edit')).toBe(false);
    expect(isTargetTextModel('MusePublic/Qwen-Image-Edit')).toBe(false);
  });

  it('parses plain and fenced JSON model output', () => {
    expect(parseJsonContent('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonContent('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(parseJsonContent('result: {"ok":true} done')).toEqual({ ok: true });
    expect(parseJsonContent('{"ok":true}\n额外说明 {不是 JSON}')).toEqual({ ok: true });
  });

  it('uses neutral provider failures before compatibility failures', () => {
    expect(classifyProbeResults([{ status: 'ok' }, { status: 'rate_limited' }])).toBe('rate_limited');
    expect(classifyProbeResults([{ status: 'ok' }, { status: 'incompatible' }])).toBe('incompatible');
    expect(classifyProbeResults([{ status: 'ok' }, { status: 'ok' }])).toBe('available');
  });

  it('validates never-checked and oldest-checked models first', () => {
    const candidates = new Map([
      ['recent', { last_checked_at: '2026-10-05T00:00:00.000Z' }],
      ['old', { last_checked_at: '2026-10-01T00:00:00.000Z' }],
      ['new', { last_checked_at: null }],
    ]);
    expect(prioritizeValidationTargets(['recent', 'old', 'new'], candidates)).toEqual(['new', 'old', 'recent']);
  });
});
