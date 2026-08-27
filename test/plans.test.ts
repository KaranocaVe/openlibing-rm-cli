import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConnectionPlan, buildSyncPlan, resolveRemoteDirectory } from '../src/plans.js';

test('connection plans redact credentials by never accepting them into the result', () => {
  const plan = buildConnectionPlan('dev-1', {
    ip: '198.51.100.10',
    port: '2222',
    userName: 'developer',
    workingDir: '/workspace/user',
    password: 'must-not-leak'
  });

  assert.deepEqual(plan.command, {
    executable: 'ssh',
    args: ['-p', '2222', 'developer@198.51.100.10']
  });
  assert.equal(JSON.stringify(plan).includes('must-not-leak'), false);
});

test('proxy plans use the target endpoint and a jump-only ProxyJump rule', () => {
  const plan = buildConnectionPlan('dev-2', {
    useProxy: true,
    jumpIp: '203.0.113.5',
    jumpPort: '2200',
    targetIp: '10.0.0.8',
    targetPort: '22',
    userName: 'developer'
  });

  assert.equal(plan.host, '10.0.0.8');
  assert.deepEqual(plan.proxy, { host: '203.0.113.5', port: 2200, user: 'jump' });
  assert.ok(plan.command.args.includes('ProxyJump=jump@203.0.113.5:2200'));
});

test('sync plans only return a command model and respect remote path precedence', () => {
  const local = '/tmp/source-project';
  assert.equal(resolveRemoteDirectory(local, '/custom/target', '/device/path', '/configured/path'), '/custom/target');
  assert.equal(resolveRemoteDirectory(local, undefined, '/device/path', '/configured/path'), '/device/path/source-project');
  assert.equal(resolveRemoteDirectory(local, undefined, undefined, '/configured/path'), '/configured/path/source-project');

  const plan = buildSyncPlan({
    environmentId: 'dev-3',
    localDirectory: local,
    configuredWorkingDirectory: '/configured/path',
    transport: 'sftp',
    machine: { ip: '198.51.100.11', port: 22, userName: 'developer' }
  });
  assert.equal(plan.command.executable, 'sftp');
  assert.equal(plan.remoteDirectory, '/configured/path/source-project');
  assert.deepEqual(plan.instructions, [
    'mkdir /configured/path/source-project',
    'cd /configured/path/source-project',
    'put -r /tmp/source-project/*',
    'bye'
  ]);
  assert.equal('spawn' in plan.command, false);
});
