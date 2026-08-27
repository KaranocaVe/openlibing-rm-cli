import path from 'node:path';

import { ValidationError } from './errors.js';
import type { ConnectionPlan, MachineInfo, SyncPlan } from './types.js';

function valueOf(machine: MachineInfo, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = machine[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function portOf(value: string | undefined, label: string): number {
  const port = Number.parseInt(value || '22', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ValidationError(`Invalid ${label} port: ${value || '(empty)'}`);
  }
  return port;
}

function requiresProxy(machine: MachineInfo): boolean {
  return Boolean(machine.useProxy && valueOf(machine, 'jumpIp') && valueOf(machine, 'targetIp'));
}

function commandAlias(environmentId: string): string {
  return `openlibing-${environmentId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function buildConnectionPlan(environmentId: string, machine: MachineInfo): ConnectionPlan {
  const proxied = requiresProxy(machine);
  const host = proxied ? valueOf(machine, 'targetIp') : valueOf(machine, 'ip', 'host');
  const user = valueOf(machine, 'userName', 'username');
  if (!host || !user) {
    throw new ValidationError('Upstream connection response is missing host or user information.');
  }

  const port = portOf(proxied ? valueOf(machine, 'targetPort') : valueOf(machine, 'port'), 'target');
  const args: string[] = [];
  const config = [
    `Host ${commandAlias(environmentId)}`,
    `  HostName ${host}`,
    `  Port ${port}`,
    `  User ${user}`
  ];

  let proxy: ConnectionPlan['proxy'];
  if (proxied) {
    const proxyHost = valueOf(machine, 'jumpIp');
    const proxyPort = portOf(valueOf(machine, 'jumpPort'), 'jump host');
    if (!proxyHost) {
      throw new ValidationError('Upstream connection response has incomplete jump-host details.');
    }
    proxy = { host: proxyHost, port: proxyPort, user: 'jump' };
    const jump = `${proxy.user}@${proxy.host}:${proxy.port}`;
    args.push('-o', `ProxyJump=${jump}`);
    config.push(`  ProxyJump ${jump}`);
  }
  args.push('-p', String(port), `${user}@${host}`);

  return {
    kind: 'connection-plan',
    environmentId,
    mayStartEnvironment: true,
    host,
    port,
    user,
    workingDirectory: valueOf(machine, 'workingDir'),
    proxy,
    sshConfig: config,
    command: { executable: 'ssh', args }
  };
}

export function resolveRemoteDirectory(
  localDirectory: string,
  explicitRemoteDirectory: string | undefined,
  machineWorkingDirectory: string | undefined,
  configuredWorkingDirectory: string | undefined
): string {
  const chosen = explicitRemoteDirectory || machineWorkingDirectory || configuredWorkingDirectory;
  if (!chosen) {
    throw new ValidationError('No remote working directory is available. Use --remote-dir or configure default-working-dir.');
  }
  if (!path.posix.isAbsolute(chosen)) {
    throw new ValidationError(`Remote working directory must be absolute: ${chosen}`);
  }
  if (explicitRemoteDirectory) {
    return path.posix.normalize(explicitRemoteDirectory);
  }
  return path.posix.join(path.posix.normalize(chosen), path.basename(localDirectory));
}

export function buildSyncPlan(options: {
  environmentId: string;
  machine: MachineInfo;
  localDirectory: string;
  explicitRemoteDirectory?: string;
  configuredWorkingDirectory?: string;
  transport: 'sftp' | 'rsync';
}): SyncPlan {
  const connection = buildConnectionPlan(options.environmentId, options.machine);
  const remoteDirectory = resolveRemoteDirectory(
    options.localDirectory,
    options.explicitRemoteDirectory,
    connection.workingDirectory,
    options.configuredWorkingDirectory
  );
  const target = `${connection.user}@${connection.host}`;
  const proxyArgs = connection.proxy
    ? ['-o', `ProxyJump=${connection.proxy.user}@${connection.proxy.host}:${connection.proxy.port}`]
    : [];

  if (options.transport === 'sftp') {
    return {
      kind: 'sync-plan',
      environmentId: options.environmentId,
      mayStartEnvironment: true,
      transport: 'sftp',
      localDirectory: options.localDirectory,
      remoteDirectory,
      connection,
      command: {
        executable: 'sftp',
        args: [...proxyArgs, '-P', String(connection.port), target]
      },
      instructions: [
        `mkdir ${remoteDirectory}`,
        `cd ${remoteDirectory}`,
        `put -r ${options.localDirectory}/*`,
        'bye'
      ]
    };
  }

  const sshArgs = [
    'ssh',
    ...proxyArgs,
    '-p',
    String(connection.port)
  ].join(' ');
  return {
    kind: 'sync-plan',
    environmentId: options.environmentId,
    mayStartEnvironment: true,
    transport: 'rsync',
    localDirectory: options.localDirectory,
    remoteDirectory,
    connection,
    command: {
      executable: 'rsync',
      args: ['-av', '-e', sshArgs, `${options.localDirectory}/`, `${target}:${remoteDirectory}/`]
    },
    instructions: ['Run the command model above only after reviewing the target and host-key policy.']
  };
}
