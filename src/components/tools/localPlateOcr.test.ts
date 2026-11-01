import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { localPlateOcr } from './localPlateOcr';

const worker = vi.hoisted(() => ({
  setParameters: vi.fn(), recognize: vi.fn(), terminate: vi.fn(),
}));
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => worker),
  PSM: { SPARSE_TEXT: '11', SINGLE_BLOCK: '6' },
}));
const fixture = readFileSync(resolve(process.cwd(), 'src/test/fixtures/ocr/controlled-plate-test-1234.png'));

describe('local plate OCR error and provenance contract', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto);
    worker.setParameters.mockResolvedValue(undefined);
    worker.terminate.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports the input hash and actual returned OCR text without inventing a plate record', async () => {
    // Controlled worker-response fixture tests the result contract; real OCR evidence
    // is measured separately by verify-production-ocr.mjs against the same PNG.
    worker.recognize.mockResolvedValue({ data: { text: 'TEST 1234\n', confidence: 96, blocks: [] } });
    const result = await localPlateOcr.process({ image_base64: fixture.toString('base64') });
    const frames = (result.details.data as { frames: Array<Record<string, unknown>> }).frames;
    expect(frames[0]).toMatchObject({ recognized_text: 'TEST 1234', plate_candidates: ['TEST 1234'], sha256: createHash('sha256').update(fixture).digest('hex') });
    expect(worker.setParameters).toHaveBeenCalledWith({ tessedit_pageseg_mode: '6' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not label an empty OCR response as a successful identification', async () => {
    worker.recognize.mockResolvedValue({ data: { text: '', confidence: 0, blocks: [] } });
    await expect(localPlateOcr.process({ image_base64: fixture.toString('base64') })).rejects.toThrow('OCR found no readable text');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('preserves frames with no recognized text when another actual frame is readable', async () => {
    worker.recognize.mockResolvedValueOnce({ data: { text: '', confidence: 0, blocks: [] } })
      .mockResolvedValueOnce({ data: { text: 'TEST 1234', confidence: 96, blocks: [] } });
    const dataUri = `data:image/png;base64,${fixture.toString('base64')}`;
    const result = await localPlateOcr.process({ frames_json: JSON.stringify([{ time_seconds: 0, image_base64: dataUri }, { time_seconds: 1, image_base64: dataUri }]) });
    const frames = (result.details.data as { frames: Array<Record<string, unknown>> }).frames;
    expect(frames[0]).toMatchObject({ recognized_text: '', notice: 'No text was recognized in this frame.', time_seconds: 0 });
    expect(frames[1]).toMatchObject({ recognized_text: 'TEST 1234', time_seconds: 1 });
  });

  it('rejects null frame records before starting an OCR worker', async () => {
    await expect(localPlateOcr.process({ frames_json: '[null]' })).rejects.toThrow('Video frame data is invalid');
    expect(worker.recognize).not.toHaveBeenCalled();
  });

  it('rejects oversized decoded-frame input before attempting OCR', async () => {
    await expect(localPlateOcr.process({ frames_json: ' '.repeat(5 * 1024 * 1024 + 1) })).rejects.toThrow('5 MiB OCR input limit');
    expect(worker.recognize).not.toHaveBeenCalled();
  });

  it('preserves real OCR errors and cleans up the worker', async () => {
    worker.recognize.mockRejectedValue(new Error('Controlled decoder failure'));
    await expect(localPlateOcr.process({ image_base64: fixture.toString('base64') })).rejects.toThrow('Controlled decoder failure');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
