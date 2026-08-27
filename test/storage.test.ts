import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getStoragePaths } from '../src/paths.js';
import { parseCredentialInput, UserStorage } from '../src/storage.js';

async function temporaryDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openlibing-rm-storage-'));
}

test('credentials use user-only files and do not expose their values through status data', async () => {
  const root = await temporaryDirectory();
  try {
    const storage = new UserStorage(getStoragePaths('linux', root, {}));
    const written = await storage.writeCredentials({
      token: 'session-secret',
      refreshToken: 'refresh-secret',
      accountId: 'account-1'
    });
    assert.equal(written.environment, 'prod');
    assert.equal((await storage.requireCredentials()).token, 'session-secret');

    const directoryMode = (await fs.stat(storage.paths.directory)).mode & 0o777;
    const fileMode = (await fs.stat(storage.paths.credentialsFile)).mode & 0o777;
    assert.equal(directoryMode, 0o700);
    assert.equal(fileMode, 0o600);

    await storage.clearCredentials();
    assert.equal(await storage.readCredentials(), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('default working-directory configuration is absolute and platform paths are deterministic', async () => {
  const root = await temporaryDirectory();
  try {
    const linuxPaths = getStoragePaths('linux', root, { XDG_CONFIG_HOME: path.join(root, 'xdg') });
    assert.equal(linuxPaths.directory, path.join(root, 'xdg', 'openlibing-rm'));
    const macPaths = getStoragePaths('darwin', root, {});
    assert.equal(macPaths.directory, path.join(root, 'Library', 'Application Support', 'openlibing-rm'));

    const storage = new UserStorage(linuxPaths);
    await assert.rejects(() => storage.setDefaultWorkingDirectory('relative/path'), /absolute path/);
    assert.deepEqual(await storage.setDefaultWorkingDirectory('/workspace/project'), {
      schemaVersion: 1,
      defaultWorkingDirectory: '/workspace/project'
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('credential input accepts a browser authTicket import without treating it as stored credentials', () => {
  assert.deepEqual(parseCredentialInput({ authTicket: 'one-shot-ticket' }), {
    authTicket: 'one-shot-ticket'
  });
  assert.deepEqual(parseCredentialInput({ token: 'session', refreshToken: 'refresh' }), {
    token: 'session',
    refreshToken: 'refresh'
  });
  assert.throws(() => parseCredentialInput({ authTicket: '' }), /authTicket must not be empty/);
});

test('storage supports multiple named accounts and keeps the current account explicit', async () => {
  const root = await temporaryDirectory();
  try {
    const storage = new UserStorage(getStoragePaths('linux', root, {}));
    await storage.writeCredentials({ token: 'alice-session', refreshToken: 'alice-refresh', accountId: 'alice-id' }, 'alice');
    await storage.writeCredentials({ token: 'bob-session', refreshToken: 'bob-refresh', accountId: 'bob-id' }, 'bob');

    assert.equal(await storage.currentAccountName(), 'alice');
    assert.equal((await storage.requireCredentials()).token, 'alice-session');
    assert.equal((await storage.requireCredentials('bob')).token, 'bob-session');
    assert.deepEqual((await storage.listAccounts()).map((account) => ({ name: account.name, current: account.current })), [
      { name: 'alice', current: true },
      { name: 'bob', current: false }
    ]);

    await storage.setCurrentAccount('bob');
    assert.equal((await storage.requireCredentials()).token, 'bob-session');
    await storage.clearCredentials('bob');
    assert.equal(await storage.currentAccountName(), 'alice');
    assert.equal((await storage.requireCredentials()).token, 'alice-session');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('legacy single-account credentials migrate transparently to the default account', async () => {
  const root = await temporaryDirectory();
  try {
    const storage = new UserStorage(getStoragePaths('linux', root, {}));
    await fs.mkdir(storage.paths.directory, { recursive: true });
    await fs.writeFile(storage.paths.credentialsFile, JSON.stringify({
      schemaVersion: 1,
      environment: 'prod',
      token: 'legacy-session',
      updatedAt: new Date().toISOString()
    }));

    assert.equal(await storage.currentAccountName(), 'default');
    assert.equal((await storage.requireCredentials()).token, 'legacy-session');
    await storage.writeCredentials({ token: 'new-session' }, 'secondary');
    const migrated = JSON.parse(await fs.readFile(storage.paths.credentialsFile, 'utf8')) as {
      schemaVersion: number;
      currentAccount: string;
      accounts: Record<string, { token: string }>;
    };
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.currentAccount, 'default');
    assert.equal(migrated.accounts.default.token, 'legacy-session');
    assert.equal(migrated.accounts.secondary.token, 'new-session');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
