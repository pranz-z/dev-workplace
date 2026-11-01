import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./policy.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { validatePreviewVideoFile, MAX_PREVIEW_VIDEO_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('MP4 policy accepts 5 MB, 10 MB, and the inclusive 15 MB boundary', () => {
  for (const size of [5, 10, 15].map(n => n * 1024 * 1024)) assert.equal(validatePreviewVideoFile({ name: 'preview.MP4', type: 'video/mp4', size }), null);
  assert.equal(MAX_PREVIEW_VIDEO_BYTES, 15728640);
});
test('rejects empty, oversized, invalid sizes, MIME types and extension mismatches', () => {
  for (const size of [0, -1, NaN, Infinity, 1.5, 15728641]) assert.ok(validatePreviewVideoFile({ name: 'preview.mp4', type: 'video/mp4', size }));
  for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', 'video/webm', '']) assert.ok(validatePreviewVideoFile({ name: 'preview.mp4', type, size: 10 }));
  for (const name of ['preview.html', 'preview.svg', 'preview', 'preview.webm']) assert.ok(validatePreviewVideoFile({ name, type: 'video/mp4', size: 10 }));
});
