import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import nock from 'nock';

import { exchangeAuthTicket } from '../src/core.js';
import { AuthenticationError } from '../src/errors.js';
import { getStoragePaths } from '../src/paths.js';
import { UserStorage } from '../src/storage.js';

const REFRESH_TOKEN_PATH =
  '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/hwaccount/refreshToken';

async function temporaryStorage(): Promise<{ root: string; storage: UserStorage }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openlibing-rm-auth-ticket-'));
  return { root, storage: new UserStorage(getStoragePaths('linux', root, {})) };
}

test('authTicket exchange sends the ticket as a session cookie and returns a durable refresh token', async () => {
  const { root, storage } = await temporaryStorage();
  nock.disableNetConnect();
  const scope = nock('https://hidevlab.huawei.com', {
    reqheaders: {
      cookie: 'sessionId=one-shot-ticket',
      referer: 'https://hidevlab.huawei.com'
    }
  })
    .get(REFRESH_TOKEN_PATH)
    .reply(200, { code: 200, data: 'durable-refresh-token' });

  try {
    assert.deepEqual(await exchangeAuthTicket(storage, ' one-shot-ticket '), {
      token: 'one-shot-ticket',
      refreshToken: 'durable-refresh-token'
    });
    assert.ok(scope.isDone());
    assert.equal(await storage.readCredentials(), null);
  } finally {
    nock.cleanAll();
    nock.enableNetConnect();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('failed authTicket exchange does not clear an existing credential file or expose the ticket', async () => {
  const { root, storage } = await temporaryStorage();
  await storage.writeCredentials({ token: 'existing-session', refreshToken: 'existing-refresh' });
  const globalState = globalThis as typeof globalThis & { authService?: unknown };
  const previousAuthService = globalState.authService;
  globalState.authService = {
    getHidevLabSessionId: () => 'existing-session',
    clearHidevLabAuth: async () => storage.clearCredentials(),
    handleHidevLabTokenExpired: async () => storage.clearCredentials(),
    refreshHidevLabToken: async () => false
  };
  nock.disableNetConnect();
  const scope = nock('https://hidevlab.huawei.com', {
    reqheaders: {
      cookie: 'sessionId=expired-ticket',
      referer: 'https://hidevlab.huawei.com'
    }
  })
    .get(REFRESH_TOKEN_PATH)
    .reply(200, { code: 401, data: null });

  try {
    await assert.rejects(
      () => exchangeAuthTicket(storage, 'expired-ticket'),
      (error: unknown) => {
        assert.ok(error instanceof AuthenticationError);
        assert.equal((error as Error).message.includes('expired-ticket'), false);
        return true;
      }
    );
    assert.ok(scope.isDone());
    const credentials = await storage.readCredentials();
    assert.equal(credentials?.token, 'existing-session');
    assert.equal(credentials?.refreshToken, 'existing-refresh');
  } finally {
    globalState.authService = previousAuthService;
    nock.cleanAll();
    nock.enableNetConnect();
    await fs.rm(root, { recursive: true, force: true });
  }
});
