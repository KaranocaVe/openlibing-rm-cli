import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { ValidationError } from '../src/errors.js';
import type { UpstreamFileHash, UpstreamLock } from '../src/types.js';

export const GALLERY_API = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
export const EXTENSION_ID = 'openlibing.ResourceManager' as const;
export const REQUIRED_CORE_FILES = [
  'out/api/HidevLabApi.js',
  'out/utils/HidevLabHttpClient.js',
  'out/utils/Logger.js'
] as const;

export interface ResolvedVsix {
  version: string;
  url: string;
}

export interface UpstreamPackageMetadata {
  name: string;
  version: string;
  license: string;
  repository?: string;
}

export interface ExtractedCore {
  files: Map<string, Buffer>;
  packageMetadata: UpstreamPackageMetadata;
}

interface GalleryFile {
  assetType?: string;
  source?: string;
}

interface GalleryVersion {
  version?: string;
  files?: GalleryFile[];
}

interface GalleryExtension {
  extensionName?: string;
  publisher?: { publisherName?: string };
  versions?: GalleryVersion[];
}

interface GalleryResponse {
  results?: Array<{ extensions?: GalleryExtension[] }>;
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function serializeRepository(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string') {
    return (value as { url: string }).url;
  }
  return undefined;
}

export function assertSafeArchivePath(entryName: string): void {
  const normalized = entryName.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new ValidationError(`Unsafe VSIX archive path: ${entryName}`);
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new ValidationError(`Unsafe VSIX archive path: ${entryName}`);
  }

  const canonical = path.posix.normalize(normalized);
  if (canonical.startsWith('../') || canonical === '..') {
    throw new ValidationError(`Unsafe VSIX archive path: ${entryName}`);
  }
}

export async function resolveVsix(
  requestedVersion: string | undefined,
  fetcher: typeof fetch = fetch
): Promise<ResolvedVsix> {
  const response = await fetcher(GALLERY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json;api-version=7.2-preview.1'
    },
    body: JSON.stringify({
      filters: [
        {
          criteria: [{ filterType: 7, value: EXTENSION_ID }],
          pageNumber: 1,
          pageSize: 1,
          sortBy: 0,
          sortOrder: 0
        }
      ],
      flags: 103
    })
  });

  if (!response.ok) {
    throw new ValidationError(`Marketplace Gallery query failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GalleryResponse;
  const extension = payload.results?.flatMap((result) => result.extensions || []).find((candidate) => {
    return candidate.extensionName?.toLowerCase() === 'resourcemanager'
      && candidate.publisher?.publisherName?.toLowerCase() === 'openlibing';
  });
  if (!extension) {
    throw new ValidationError(`Marketplace did not return ${EXTENSION_ID}`);
  }

  const version = requestedVersion
    ? extension.versions?.find((candidate) => candidate.version === requestedVersion)
    : extension.versions?.[0];
  if (!version?.version) {
    throw new ValidationError(requestedVersion
      ? `Marketplace does not publish ${EXTENSION_ID}@${requestedVersion}`
      : `Marketplace returned no versions for ${EXTENSION_ID}`);
  }

  const vsix = version.files?.find((file) => file.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage');
  if (!vsix?.source) {
    throw new ValidationError(`Marketplace did not return a VSIX package for ${EXTENSION_ID}@${version.version}`);
  }
  return { version: version.version, url: vsix.source };
}

export async function downloadVsix(url: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetcher(url, { headers: { Accept: 'application/octet-stream' } });
  if (!response.ok) {
    throw new ValidationError(`VSIX download failed: HTTP ${response.status}`);
  }
  const value = Buffer.from(await response.arrayBuffer());
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) !== value.length) {
    throw new ValidationError(`VSIX download size mismatch: header=${contentLength}, actual=${value.length}`);
  }
  return value;
}

export function extractCore(vsix: Buffer, expectedVersion?: string): ExtractedCore {
  const zip = new AdmZip(vsix);
  const entries = zip.getEntries();
  const archive = new Map<string, Buffer>();
  for (const entry of entries) {
    assertSafeArchivePath(entry.entryName);
    if (!entry.isDirectory) {
      archive.set(entry.entryName.replace(/\\/g, '/'), entry.getData());
    }
  }

  const packageBuffer = archive.get('extension/package.json');
  if (!packageBuffer) {
    throw new ValidationError('VSIX does not contain extension/package.json');
  }

  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(packageBuffer.toString('utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new ValidationError(`Cannot parse upstream package.json: ${(error as Error).message}`);
  }
  const packageMetadata: UpstreamPackageMetadata = {
    name: String(packageJson.name || ''),
    version: String(packageJson.version || ''),
    license: String(packageJson.license || ''),
    repository: serializeRepository(packageJson.repository)
  };
  if (packageMetadata.name !== 'ResourceManager' || !packageMetadata.version || !packageMetadata.license) {
    throw new ValidationError('Upstream package.json is missing ResourceManager identity or license metadata');
  }
  if (expectedVersion && packageMetadata.version !== expectedVersion) {
    throw new ValidationError(`VSIX package version ${packageMetadata.version} does not match resolved version ${expectedVersion}`);
  }

  const selected = new Map<string, Buffer>();
  selected.set('package.json', packageBuffer);
  for (const relativePath of REQUIRED_CORE_FILES) {
    const content = archive.get(`extension/${relativePath}`);
    if (!content) {
      throw new ValidationError(`VSIX is missing required core file: extension/${relativePath}`);
    }
    selected.set(relativePath, content);
  }

  const notice = [
    '# Copied upstream runtime',
    '',
    `Source: ${EXTENSION_ID}@${packageMetadata.version}`,
    `License declared by upstream package: ${packageMetadata.license}`,
    `Repository: ${packageMetadata.repository || 'not declared'}`,
    '',
    'This directory is generated by scripts/sync-upstream.ts. Do not hand edit copied files.',
    ''
  ].join('\n');
  selected.set('UPSTREAM.md', Buffer.from(notice, 'utf8'));

  return { files: selected, packageMetadata };
}

export function fileHashes(files: Map<string, Buffer>): UpstreamFileHash[] {
  return [...files.entries()]
    .map(([relativePath, content]) => ({ path: relativePath, sha256: sha256(content) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function makeLock(resolved: ResolvedVsix, vsix: Buffer, extracted: ExtractedCore): UpstreamLock {
  return {
    schemaVersion: 1,
    extension: {
      id: EXTENSION_ID,
      publisher: 'openlibing',
      name: 'ResourceManager'
    },
    version: resolved.version,
    galleryApi: GALLERY_API,
    vsix: {
      url: resolved.url,
      sha256: sha256(vsix),
      size: vsix.length
    },
    package: extracted.packageMetadata,
    coreFiles: fileHashes(extracted.files)
  };
}

async function exists(filename: string): Promise<boolean> {
  try {
    await fs.access(filename);
    return true;
  } catch {
    return false;
  }
}

async function writeFileSafely(root: string, relativePath: string, content: Buffer): Promise<void> {
  assertSafeArchivePath(relativePath);
  const destination = path.resolve(root, relativePath);
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  if (!destination.startsWith(rootPrefix)) {
    throw new ValidationError(`Refusing to write outside generated snapshot: ${relativePath}`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content, { mode: 0o644 });
}

export async function replaceVendorSnapshot(repositoryRoot: string, extracted: ExtractedCore): Promise<void> {
  const vendorParent = path.join(repositoryRoot, 'vendor');
  const destination = path.join(vendorParent, 'openlibing-resource-manager');
  await fs.mkdir(vendorParent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(vendorParent, '.sync-'));
  const backup = path.join(vendorParent, `.previous-${process.pid}-${crypto.randomUUID()}`);
  let movedExisting = false;

  try {
    for (const [relativePath, content] of extracted.files) {
      await writeFileSafely(staging, relativePath, content);
    }
    if (await exists(destination)) {
      await fs.rename(destination, backup);
      movedExisting = true;
    }
    await fs.rename(staging, destination);
    if (movedExisting) {
      await fs.rm(backup, { recursive: true, force: true });
    }
  } catch (error) {
    if (movedExisting && !(await exists(destination)) && await exists(backup)) {
      await fs.rename(backup, destination);
    }
    throw error;
  } finally {
    if (await exists(staging)) {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}

export async function writeLock(repositoryRoot: string, lock: UpstreamLock): Promise<void> {
  const destination = path.join(repositoryRoot, 'upstream.lock.json');
  const temporary = path.join(repositoryRoot, `.upstream.lock.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`, { encoding: 'utf8', mode: 0o644, flag: 'wx' });
    await fs.rename(temporary, destination);
  } finally {
    if (await exists(temporary)) {
      await fs.unlink(temporary);
    }
  }
}

export async function readLock(repositoryRoot: string): Promise<UpstreamLock> {
  const filename = path.join(repositoryRoot, 'upstream.lock.json');
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(filename, 'utf8'));
  } catch (error) {
    throw new ValidationError(`Cannot read upstream lock file: ${(error as Error).message}`);
  }
  const lock = value as Partial<UpstreamLock>;
  if (lock.schemaVersion !== 1 || lock.extension?.id !== EXTENSION_ID || !lock.version || !lock.vsix?.url || !lock.vsix.sha256 || !Array.isArray(lock.coreFiles)) {
    throw new ValidationError('upstream.lock.json does not have the expected schema');
  }
  return lock as UpstreamLock;
}

export async function verifyLockAndSnapshot(repositoryRoot: string, lock: UpstreamLock, vsix: Buffer): Promise<void> {
  if (sha256(vsix) !== lock.vsix.sha256) {
    throw new ValidationError('Downloaded VSIX SHA-256 does not match upstream.lock.json');
  }
  if (vsix.length !== lock.vsix.size) {
    throw new ValidationError('Downloaded VSIX size does not match upstream.lock.json');
  }

  const extracted = extractCore(vsix, lock.version);
  const expectedHashes = new Map(lock.coreFiles.map((file) => [file.path, file.sha256]));
  const actualHashes = fileHashes(extracted.files);
  if (actualHashes.length !== expectedHashes.size || actualHashes.some((file) => expectedHashes.get(file.path) !== file.sha256)) {
    throw new ValidationError('VSIX copied-file hashes do not match upstream.lock.json');
  }

  for (const file of actualHashes) {
    const filename = path.join(repositoryRoot, 'vendor', 'openlibing-resource-manager', file.path);
    let current: Buffer;
    try {
      current = await fs.readFile(filename);
    } catch (error) {
      throw new ValidationError(`Generated vendor file is missing: ${file.path} (${(error as Error).message})`);
    }
    if (sha256(current) !== file.sha256) {
      throw new ValidationError(`Generated vendor file hash mismatch: ${file.path}`);
    }
  }
}
