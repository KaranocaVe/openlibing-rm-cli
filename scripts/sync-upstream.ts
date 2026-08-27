import { Command } from 'commander';

import { CliError } from '../src/errors.js';
import { repositoryRoot } from '../src/repository.js';
import {
  downloadVsix,
  extractCore,
  makeLock,
  replaceVendorSnapshot,
  resolveVsix,
  writeLock
} from './upstream-lib.js';

export async function syncUpstream(version: string | undefined): Promise<{ version: string; sha256: string }> {
  const resolved = await resolveVsix(version);
  const vsix = await downloadVsix(resolved.url);
  const extracted = extractCore(vsix, resolved.version);
  const lock = makeLock(resolved, vsix, extracted);
  const root = repositoryRoot();

  await replaceVendorSnapshot(root, extracted);
  await writeLock(root, lock);
  return { version: lock.version, sha256: lock.vsix.sha256 };
}

export async function main(argv = process.argv): Promise<void> {
  const program = new Command()
    .name('sync-upstream')
    .description('Download and vendor a selected openlibing.ResourceManager VSIX runtime')
    .option('--version <version>', 'explicit Marketplace version to synchronize')
    .option('--latest', 'resolve the newest Marketplace version explicitly');

  program.parse(argv);
  const options = program.opts<{ version?: string; latest?: boolean }>();
  if (Boolean(options.version) === Boolean(options.latest)) {
    throw new CliError('Specify exactly one of --version <version> or --latest.', 2);
  }

  const result = await syncUpstream(options.latest ? undefined : options.version);
  process.stdout.write(`Synchronized ${result.version} (sha256 ${result.sha256})\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  });
}
