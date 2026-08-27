import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildProgram } from '../src/cli.js';
import { requireConfirmation, requireExplicitYes } from '../src/confirmation.js';
import { redactValue } from '../src/redact.js';
import { repositoryRoot } from '../src/repository.js';

const execFileAsync = promisify(execFile);

test('confirmation rejects non-interactive remote mutation without --yes', async () => {
  await assert.rejects(
    () => requireConfirmation({ action: 'delete environment env-1', isTTY: false }),
    /Pass --yes/
  );
  assert.throws(() => requireExplicitYes(false, 'auth clear'), /requires --yes/);
});

test('CLI exposes planned command families and recursive output redaction', () => {
  const help = buildProgram().helpInformation();
  assert.match(help, /auth/);
  assert.match(help, /catalog/);
  assert.match(help, /env/);
  assert.deepEqual(redactValue({ token: 'secret', nested: { password: 'secret', status: 'ok' } }), {
    token: '[REDACTED]',
    nested: { password: '[REDACTED]', status: 'ok' }
  });
});

test('compiled CLI accepts --json after a leaf command without touching the real user configuration', async () => {
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'openlibing-rm-cli-'));
  try {
    const environment = {
      ...process.env,
      HOME: fakeHome,
      XDG_CONFIG_HOME: path.join(fakeHome, 'xdg')
    };
    const executable = path.join(repositoryRoot(), 'dist', 'src', 'cli.js');
    const setResult = await execFileAsync(process.execPath, [
      executable,
      'config',
      'set',
      'default-working-dir',
      '/workspace/project',
      '--json'
    ], { cwd: repositoryRoot(), env: environment });
    assert.deepEqual(JSON.parse(setResult.stdout), {
      schemaVersion: 1,
      defaultWorkingDirectory: '/workspace/project'
    });

    const showResult = await execFileAsync(process.execPath, [executable, 'config', 'show', '--json'], {
      cwd: repositoryRoot(),
      env: environment
    });
    assert.deepEqual(JSON.parse(showResult.stdout), {
      schemaVersion: 1,
      defaultWorkingDirectory: '/workspace/project'
    });
  } finally {
    await fs.rm(fakeHome, { recursive: true, force: true });
  }
});
