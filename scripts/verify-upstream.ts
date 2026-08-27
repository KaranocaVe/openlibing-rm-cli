import { CliError } from '../src/errors.js';
import { repositoryRoot } from '../src/repository.js';
import { downloadVsix, readLock, verifyLockAndSnapshot } from './upstream-lib.js';

export async function main(): Promise<void> {
  const root = repositoryRoot();
  const lock = await readLock(root);
  const vsix = await downloadVsix(lock.vsix.url);
  await verifyLockAndSnapshot(root, lock, vsix);
  process.stdout.write(`Verified ${lock.extension.id}@${lock.version}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  });
}
