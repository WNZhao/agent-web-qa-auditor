import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, assertPublicUrl, isPrivateAddress } from '../src/audit.js';

test('detects private IPv4 and IPv6 addresses', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.20'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('rejects local and credential-bearing URLs', async () => {
  await assert.rejects(() => assertPublicUrl('http://localhost/admin'), /Private or local/);
  await assert.rejects(() => assertPublicUrl('https://user:pass@example.com'), /credentials/);
});

test('returns deterministic findings for incomplete HTML', () => {
  const result = analyzeHtml('<html><body><img src="x.png"><a href="/about">About</a></body></html>', 'https://example.com/');
  assert.deepEqual(result.links, ['https://example.com/about']);
  assert.deepEqual(result.findings.map((item) => item.code), [
    'missing_title',
    'missing_meta_description',
    'missing_h1',
    'missing_image_alt',
    'missing_viewport',
  ]);
});
