import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { loadCoreRuntime, type HidevLabApiLike } from './core.js';
import { ValidationError } from './errors.js';
import { buildConnectionPlan, buildSyncPlan } from './plans.js';
import { UserStorage } from './storage.js';
import type { AccountName, ConnectionPlan, MachineInfo, SyncPlan } from './types.js';

const createRequestSchema = z.object({
  computeType: z.coerce.number().int().positive(),
  envType: z.literal('multiple'),
  ideDevs: z.array(z.object({
    devEnvName: z.string().min(1),
    flavor: z.any().refine((value) => value !== undefined, 'flavor is required'),
    image: z.string().optional(),
    customImageUrl: z.string().optional(),
    computeType: z.coerce.number().int().positive(),
    storeSize: z.any().optional(),
    modelType: z.string().optional()
  }).passthrough()).min(1)
}).passthrough();

function requireEnvironmentId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ValidationError('environment id must not be empty');
  }
  return normalized;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function successful(action: string, response: unknown): void {
  const record = recordOf(response);
  if (record && typeof record.code === 'number' && record.code !== 200) {
    throw new ValidationError(`${action} failed: ${typeof record.msg === 'string' ? record.msg : `code ${record.code}`}`);
  }
}

export class ResourceService {
  constructor(
    private readonly api: HidevLabApiLike,
    private readonly storage: UserStorage
  ) {}

  static async create(storage = new UserStorage(), accountName?: AccountName): Promise<ResourceService> {
    const runtime = await loadCoreRuntime(storage, accountName);
    return new ResourceService(runtime.api, storage);
  }

  async list(): Promise<unknown[]> {
    return this.api.listDevEnv();
  }

  async show(environmentId: string): Promise<Record<string, unknown>> {
    const requested = requireEnvironmentId(environmentId);
    const environments = await this.list();
    const found = environments.find((environment) => {
      const record = recordOf(environment);
      return record && (String(record.id ?? '') === requested || String(record.devEnvId ?? '') === requested);
    });
    const record = recordOf(found);
    if (!record) {
      throw new ValidationError(`Environment ${requested} was not found.`);
    }
    return record;
  }

  async status(environmentId: string): Promise<unknown> {
    return this.api.checkEnvironmentStatus(requireEnvironmentId(environmentId));
  }

  async createEnvironment(request: unknown): Promise<unknown> {
    const parsed = createRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ValidationError(`Invalid environment creation spec: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
    }
    const response = await this.api.createDevEnv(parsed.data);
    successful('Environment creation', response);
    return response;
  }

  async start(environmentId: string, wait = true): Promise<unknown> {
    const id = requireEnvironmentId(environmentId);
    const response = await this.api.startEnvironment(id);
    successful('Environment start', response);
    if (wait) {
      const machine = recordOf(response)?.machineInfo as MachineInfo | undefined;
      if (machine?.status && machine.status !== 'running') {
        await this.api.pollEnvironmentStatus(id, () => undefined, 60, 5000, { cancel: false });
      }
    }
    return response;
  }

  async stop(environmentId: string, wait = true): Promise<unknown> {
    const id = requireEnvironmentId(environmentId);
    const response = await this.api.stopEnvironment(id);
    successful('Environment stop', response);
    if (wait) {
      await this.api.pollStatusUntilTarget(id, ['stopped', 'stop_exception', 'disconnect', 'ready'], 30, 2000);
    }
    return response;
  }

  async delete(environmentId: string, wait = true): Promise<unknown> {
    const id = requireEnvironmentId(environmentId);
    const response = await this.api.deleteEnvironment(id);
    successful('Environment deletion', response);
    if (wait) {
      await this.api.pollStatusUntilTarget(id, ['deleted', 'stopped', 'exception'], 30, 2000);
    }
    return response;
  }

  async catalogDefaults(): Promise<unknown> {
    return this.api.loadDefaultData();
  }

  async catalogDeviceTypes(): Promise<unknown> {
    return this.api.listDeviceType();
  }

  async catalogImages(modelType?: string): Promise<unknown> {
    return this.api.listImage(modelType);
  }

  async catalogFlavors(computeType: number, imageId?: string, modelType?: string): Promise<unknown> {
    if (!Number.isInteger(computeType) || computeType < 1) {
      throw new ValidationError('compute-type must be a positive integer');
    }
    return this.api.listFlavor(computeType, imageId, modelType);
  }

  async catalogMaxEnvironments(): Promise<unknown> {
    return this.api.getMaxEnvItems();
  }

  async connectionPlan(environmentId: string): Promise<ConnectionPlan> {
    const id = requireEnvironmentId(environmentId);
    const machine = await this.api.connectToEnvironment(id);
    return buildConnectionPlan(id, machine);
  }

  async syncPlan(options: {
    environmentId: string;
    localDirectory: string;
    remoteDirectory?: string;
    transport: 'sftp' | 'rsync';
  }): Promise<SyncPlan> {
    const id = requireEnvironmentId(options.environmentId);
    const localDirectory = path.resolve(options.localDirectory);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(localDirectory);
    } catch {
      throw new ValidationError(`Local directory does not exist: ${localDirectory}`);
    }
    if (!stat.isDirectory()) {
      throw new ValidationError(`Local path is not a directory: ${localDirectory}`);
    }

    const [machine, config] = await Promise.all([
      this.api.connectToEnvironment(id),
      this.storage.readConfig()
    ]);
    return buildSyncPlan({
      environmentId: id,
      machine,
      localDirectory,
      explicitRemoteDirectory: options.remoteDirectory,
      configuredWorkingDirectory: config.defaultWorkingDirectory,
      transport: options.transport
    });
  }
}
