export type SupportedPlatform = 'darwin' | 'linux';

export interface StoragePaths {
  directory: string;
  credentialsFile: string;
  configFile: string;
}

export interface CredentialInput {
  token: string;
  refreshToken?: string;
  accountId?: string;
}

/**
 * One-time credential copied from a logged-in HidevLab browser session.
 *
 * The ticket is deliberately an import-only shape. It is exchanged for a
 * refresh token by the CLI and is never written as a separate field in the
 * credentials file.
 */
export interface AuthTicketInput {
  authTicket: string;
  accountId?: string;
}

export type CredentialImportInput = CredentialInput | AuthTicketInput;

export interface Credentials extends CredentialInput {
  schemaVersion: 1;
  environment: 'prod';
  updatedAt: string;
}

export interface AppConfig {
  schemaVersion: 1;
  defaultWorkingDirectory?: string;
}

export interface MachineInfo {
  devEnvId?: string | number;
  devEnvName?: string;
  ip?: string;
  host?: string;
  port?: string | number;
  userName?: string;
  username?: string;
  workingDir?: string;
  status?: string;
  description?: string;
  exceptionDesc?: string;
  usableTime?: string | number;
  accountType?: string;
  useProxy?: boolean;
  jumpName?: string;
  jumpIp?: string;
  jumpPort?: string | number;
  targetIp?: string;
  targetPort?: string | number;
  [key: string]: unknown;
}

export interface ConnectionPlan {
  kind: 'connection-plan';
  environmentId: string;
  mayStartEnvironment: true;
  host: string;
  port: number;
  user: string;
  workingDirectory?: string;
  proxy?: {
    host: string;
    port: number;
    user: 'jump';
  };
  sshConfig: string[];
  command: {
    executable: 'ssh';
    args: string[];
  };
}

export interface SyncPlan {
  kind: 'sync-plan';
  environmentId: string;
  mayStartEnvironment: true;
  transport: 'sftp' | 'rsync';
  localDirectory: string;
  remoteDirectory: string;
  connection: ConnectionPlan;
  command: {
    executable: 'sftp' | 'rsync';
    args: string[];
  };
  instructions: string[];
}

export interface UpstreamFileHash {
  path: string;
  sha256: string;
}

export interface UpstreamLock {
  schemaVersion: 1;
  extension: {
    id: 'openlibing.ResourceManager';
    publisher: 'openlibing';
    name: 'ResourceManager';
  };
  version: string;
  galleryApi: string;
  vsix: {
    url: string;
    sha256: string;
    size: number;
  };
  package: {
    name: string;
    version: string;
    license: string;
    repository?: string;
  };
  coreFiles: UpstreamFileHash[];
}
