import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { HidevLabApiLike } from '../src/core.js';
import { ResourceService } from '../src/resource-service.js';
import { UserStorage } from '../src/storage.js';
import { getStoragePaths } from '../src/paths.js';

function fakeApi(events: string[]): HidevLabApiLike {
  return {
    initDebugMode() {},
    async listDevEnv() { return [{ id: 'env-1', devEnvName: 'one', status: 'stopped' }]; },
    async checkEnvironmentStatus(id) { return { id, status: 'running' }; },
    async createDevEnv(request) { events.push(`create:${JSON.stringify(request)}`); return { code: 200, data: [] }; },
    async startEnvironment(id) { events.push(`start:${id}`); return { code: 200, machineInfo: { status: 'starting' } }; },
    async stopEnvironment(id) { events.push(`stop:${id}`); return { code: 200, data: true }; },
    async deleteEnvironment(id) { events.push(`delete:${id}`); return { code: 200, data: true }; },
    async connectToEnvironment() { return { ip: '198.51.100.1', port: 22, userName: 'dev', workingDir: '/workspace' }; },
    async pollEnvironmentStatus(id) { events.push(`poll-start:${id}`); return 'running'; },
    async pollStatusUntilTarget(id) { events.push(`poll-state:${id}`); return 'stopped'; },
    async getMaxEnvItems() { return 4; },
    async loadDefaultData() { return {}; },
    async listDeviceType() { return []; },
    async listImage() { return []; },
    async listFlavor() { return []; },
    async refreshAccessToken() { return 'new-session'; }
  };
}

test('resource service uses injected API calls and never needs a live account in tests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openlibing-rm-service-'));
  try {
    const storage = new UserStorage(getStoragePaths('linux', root, {}));
    const events: string[] = [];
    const service = new ResourceService(fakeApi(events), storage);
    assert.equal((await service.show('env-1')).devEnvName, 'one');
    await service.start('env-1', true);
    await service.stop('env-1', true);
    await service.delete('env-1', true);
    assert.deepEqual(events.slice(0, 6), ['start:env-1', 'poll-start:env-1', 'stop:env-1', 'poll-state:env-1', 'delete:env-1', 'poll-state:env-1']);

    await service.createEnvironment({
      computeType: 2,
      envType: 'multiple',
      ideDevs: [{ devEnvName: 'new-env', flavor: 'flavor', computeType: 2 }]
    });
    assert.ok(events.some((event) => event.startsWith('create:')));

    const local = path.join(root, 'local-project');
    await fs.mkdir(local);
    const plan = await service.syncPlan({ environmentId: 'env-1', localDirectory: local, transport: 'rsync' });
    assert.equal(plan.command.executable, 'rsync');
    assert.equal(plan.remoteDirectory, '/workspace/local-project');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
