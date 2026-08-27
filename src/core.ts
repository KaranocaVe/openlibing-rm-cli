import path from 'node:path';

import { AuthenticationError, ValidationError } from './errors.js';
import { repositoryRoot } from './repository.js';
import { UserStorage } from './storage.js';
import type { CredentialInput, Credentials, MachineInfo } from './types.js';
import { installVscodeRuntime } from './vscode-runtime.js';

export interface HidevLabApiLike {
  initDebugMode(): void;
  listDevEnv(): Promise<unknown[]>;
  checkEnvironmentStatus(environmentId: string): Promise<unknown>;
  createDevEnv(request: unknown): Promise<unknown>;
  startEnvironment(environmentId: string): Promise<unknown>;
  stopEnvironment(environmentId: string): Promise<unknown>;
  deleteEnvironment(environmentId: string): Promise<unknown>;
  connectToEnvironment(environmentId: string): Promise<MachineInfo>;
  pollEnvironmentStatus(
    environmentId: string,
    onStatusChange: (status: string) => void,
    maxAttempts?: number,
    intervalMs?: number,
    cancelFlag?: { cancel: boolean }
  ): Promise<string>;
  pollStatusUntilTarget(
    environmentId: string,
    targetStatuses: string[],
    maxAttempts?: number,
    intervalMs?: number
  ): Promise<string>;
  getMaxEnvItems(): Promise<unknown>;
  loadDefaultData(): Promise<unknown>;
  listDeviceType(): Promise<unknown>;
  listImage(modelType?: string): Promise<unknown>;
  listFlavor(computeType?: number, imageId?: string, modelType?: string): Promise<unknown>;
  refreshAccessToken(refreshToken: string): Promise<string>;
}

interface LoadedUpstreamModule {
  HidevLabApi: HidevLabApiLike & {
    getRefreshToken(): Promise<string>;
  };
}

interface UpstreamAuthServiceLike {
  getHidevLabSessionId(): string | null;
  clearHidevLabAuth(): Promise<void>;
  handleHidevLabTokenExpired(): Promise<void>;
  refreshHidevLabToken(): Promise<boolean>;
}

export class CliAuthBridge {
  private credentials: Credentials;

  constructor(
    private readonly storage: UserStorage,
    private readonly api: Pick<HidevLabApiLike, 'refreshAccessToken'>,
    credentials: Credentials
  ) {
    this.credentials = credentials;
  }

  getHidevLabSessionId(): string {
    return this.credentials.token;
  }

  async clearHidevLabAuth(): Promise<void> {
    await this.storage.clearCredentials();
  }

  async handleHidevLabTokenExpired(): Promise<void> {
    await this.clearHidevLabAuth();
  }

  async refreshHidevLabToken(): Promise<boolean> {
    if (!this.credentials.refreshToken) {
      await this.clearHidevLabAuth();
      return false;
    }

    try {
      const sessionToken = await this.api.refreshAccessToken(this.credentials.refreshToken);
      this.credentials = await this.storage.writeCredentials({
        token: sessionToken,
        refreshToken: this.credentials.refreshToken,
        accountId: this.credentials.accountId
      });
      return true;
    } catch {
      await this.clearHidevLabAuth();
      return false;
    }
  }
}

export interface CoreRuntime {
  api: HidevLabApiLike;
  auth: CliAuthBridge;
}

function loadUpstreamModule(): LoadedUpstreamModule {
  const modulePath = path.join(
    repositoryRoot(),
    'vendor',
    'openlibing-resource-manager',
    'out',
    'api',
    'HidevLabApi.js'
  );

  let upstream: LoadedUpstreamModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    upstream = require(modulePath) as LoadedUpstreamModule;
  } catch (error) {
    throw new ValidationError(
      `Copied upstream core is unavailable. Run \`npm run upstream:sync -- --version 0.0.34\`. ${(error as Error).message}`
    );
  }
  return upstream;
}

function installAuthRuntime(
  storage: UserStorage,
  upstream: LoadedUpstreamModule,
  credentials: Credentials
): CliAuthBridge {
  const auth = new CliAuthBridge(storage, upstream.HidevLabApi, credentials);
  (globalThis as typeof globalThis & { authService?: UpstreamAuthServiceLike }).authService = auth;
  upstream.HidevLabApi.initDebugMode();
  return auth;
}

export async function loadCoreRuntime(storage: UserStorage): Promise<CoreRuntime> {
  const credentials = await storage.requireCredentials();
  installVscodeRuntime();
  const upstream = loadUpstreamModule();
  const auth = installAuthRuntime(storage, upstream, credentials);
  return { api: upstream.HidevLabApi, auth };
}

/**
 * Exchange a one-time browser credential without touching the browser's
 * cookies. The copied upstream API expects the ticket in the sessionId
 * cookie/header and returns the durable refresh token from its
 * `hwaccount/refreshToken` endpoint.
 */
export async function exchangeAuthTicket(storage: UserStorage, authTicket: string): Promise<CredentialInput> {
  const normalized = authTicket.trim();
  if (!normalized) {
    throw new ValidationError('authTicket must not be empty.');
  }

  installVscodeRuntime();
  const upstream = loadUpstreamModule();
  const temporaryCredentials: Credentials = {
    schemaVersion: 1,
    environment: 'prod',
    token: normalized,
    updatedAt: new Date().toISOString()
  };
  const globalState = globalThis as typeof globalThis & { authService?: UpstreamAuthServiceLike };
  const previousAuthService = globalState.authService;

  try {
    // Do not bind this one-shot exchange to UserStorage. The copied HTTP
    // client may call the expiry hooks for a business-level 401; a no-op
    // bridge ensures a failed ticket cannot clear an already configured local
    // credential file.
    globalState.authService = {
      getHidevLabSessionId: () => temporaryCredentials.token,
      clearHidevLabAuth: async () => undefined,
      handleHidevLabTokenExpired: async () => undefined,
      refreshHidevLabToken: async () => false
    };
    upstream.HidevLabApi.initDebugMode();
    const refreshToken = await upstream.HidevLabApi.getRefreshToken();
    if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
      throw new Error('empty refresh token');
    }
    return { token: normalized, refreshToken: refreshToken.trim() };
  } catch {
    // Do not include the ticket or upstream response in the error. Both may
    // contain credentials, and this message is safe for terminal/CI output.
    throw new AuthenticationError(
      'Unable to exchange authTicket for a refresh token. Copy a fresh credential from HidevLab and try again.'
    );
  } finally {
    // HidevLabHttpClient schedules token-expiry handling with setTimeout(0)
    // after a business-level 401. Let that callback observe the no-op bridge
    // before restoring a caller's real bridge, otherwise it could clear valid
    // credentials belonging to an earlier session.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    globalState.authService = previousAuthService;
  }
}
