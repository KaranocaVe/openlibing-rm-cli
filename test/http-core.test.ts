import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import nock from 'nock';

import type { HidevLabApiLike } from '../src/core.js';
import { repositoryRoot } from '../src/repository.js';
import { installVscodeRuntime } from '../src/vscode-runtime.js';

test('copied HidevLab API uses the production endpoint and session cookie through HTTP mocks', async () => {
  installVscodeRuntime();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require(path.join(repositoryRoot(), 'vendor', 'openlibing-resource-manager', 'out', 'api', 'HidevLabApi.js')) as {
    HidevLabApi: HidevLabApiLike & Record<string, unknown>;
  };
  const api = loaded.HidevLabApi;
  api.httpClient = null;
  api.debugMode = false;
  api.environment = 'prod';
  (globalThis as typeof globalThis & { authService?: unknown }).authService = {
    getHidevLabSessionId: () => 'mock-session',
    clearHidevLabAuth: async () => undefined,
    refreshHidevLabToken: async () => false,
    handleHidevLabTokenExpired: async () => undefined
  };

  nock.disableNetConnect();
  const scope = nock('https://hidevlab.huawei.com', {
    reqheaders: {
      cookie: 'sessionId=mock-session',
      referer: 'https://hidevlab.huawei.com'
    }
  })
    .get('/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/localIde/v2/listDevEnv')
    .reply(200, { code: 200, data: [{ id: 'env-1', status: 'running' }] });

  try {
    assert.deepEqual(await api.listDevEnv(), [{ id: 'env-1', status: 'running' }]);
    assert.ok(scope.isDone());
  } finally {
    nock.cleanAll();
    nock.enableNetConnect();
  }
});
