import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import AdmZip from 'adm-zip';

import {
  assertSafeArchivePath,
  downloadVsix,
  extractCore,
  makeLock,
  replaceVendorSnapshot,
  resolveVsix,
  verifyLockAndSnapshot
} from '../scripts/upstream-lib.js';

function fixtureVsix(options: { omit?: string } = {}): Buffer {
  const zip = new AdmZip();
  zip.addFile('extension/package.json', Buffer.from(JSON.stringify({
    name: 'ResourceManager',
    version: '0.0.34',
    license: 'MIT',
    repository: { url: 'https://gitcode.com/openlibing/openlibing-ide-plugin.git' }
  })));
  const entries: Record<string, string> = {
    'extension/out/api/HidevLabApi.js': 'exports.HidevLabApi = {};',
    'extension/out/utils/HidevLabHttpClient.js': 'exports.client = {};',
    'extension/out/utils/Logger.js': 'exports.default = {};'
  };
  for (const [filename, source] of Object.entries(entries)) {
    if (filename !== options.omit) {
      zip.addFile(filename, Buffer.from(source));
    }
  }
  return zip.toBuffer();
}

test('Gallery resolution selects the VSIX asset and sync extraction limits copied files', async () => {
  const response = {
    results: [{
      extensions: [{
        extensionName: 'ResourceManager',
        publisher: { publisherName: 'openlibing' },
        versions: [{
          version: '0.0.34',
          files: [{ assetType: 'Microsoft.VisualStudio.Services.VSIXPackage', source: 'https://example.test/extension.vsix' }]
        }]
      }]
    }]
  };
  const fetcher = async () => new Response(JSON.stringify(response), { status: 200 }) as Response;
  const resolved = await resolveVsix('0.0.34', fetcher as typeof fetch);
  assert.deepEqual(resolved, { version: '0.0.34', url: 'https://example.test/extension.vsix' });

  const extracted = extractCore(fixtureVsix(), '0.0.34');
  assert.deepEqual([...extracted.files.keys()].sort(), [
    'UPSTREAM.md',
    'out/api/HidevLabApi.js',
    'out/utils/HidevLabHttpClient.js',
    'out/utils/Logger.js',
    'package.json'
  ]);
});

test('unsafe archive paths and incomplete artifacts fail before a snapshot is replaced', async () => {
  assert.throws(() => assertSafeArchivePath('../outside.js'), /Unsafe VSIX archive path/);
  assert.throws(() => extractCore(fixtureVsix({ omit: 'extension/out/utils/Logger.js' })), /missing required core file/);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openlibing-rm-upstream-'));
  try {
    const initial = extractCore(fixtureVsix(), '0.0.34');
    await replaceVendorSnapshot(root, initial);
    const destination = path.join(root, 'vendor', 'openlibing-resource-manager', 'out', 'utils', 'Logger.js');
    const before = await fs.readFile(destination, 'utf8');
    assert.equal(before, 'exports.default = {};');
    assert.equal(await fs.readFile(destination, 'utf8'), before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('lock verification rejects modified copied files and download size mismatches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openlibing-rm-verify-'));
  try {
    const vsix = fixtureVsix();
    const resolved = { version: '0.0.34', url: 'https://example.test/extension.vsix' };
    const extracted = extractCore(vsix, resolved.version);
    const lock = makeLock(resolved, vsix, extracted);
    await replaceVendorSnapshot(root, extracted);
    await verifyLockAndSnapshot(root, lock, vsix);

    await fs.writeFile(path.join(root, 'vendor', 'openlibing-resource-manager', 'out', 'utils', 'Logger.js'), 'changed');
    await assert.rejects(() => verifyLockAndSnapshot(root, lock, vsix), /hash mismatch/);

    const badLengthFetcher = async () => new Response(Buffer.from('abc'), {
      status: 200,
      headers: { 'content-length': '4' }
    }) as Response;
    await assert.rejects(() => downloadVsix('https://example.test/extension.vsix', badLengthFetcher as typeof fetch), /size mismatch/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
