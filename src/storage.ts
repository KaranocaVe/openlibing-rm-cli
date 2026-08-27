import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { AuthenticationError, ValidationError } from './errors.js';
import { getStoragePaths } from './paths.js';
import type {
  AppConfig,
  AuthTicketInput,
  CredentialImportInput,
  CredentialInput,
  Credentials,
  StoragePaths
} from './types.js';

const credentialInputSchema = z.object({
  token: z.string().min(1, 'token must not be empty'),
  refreshToken: z.string().min(1).optional(),
  accountId: z.string().min(1).optional()
}).strict();

const authTicketInputSchema = z.object({
  authTicket: z.string().min(1, 'authTicket must not be empty'),
  accountId: z.string().min(1).optional()
}).strict();

const credentialsSchema = credentialInputSchema.extend({
  schemaVersion: z.literal(1),
  environment: z.literal('prod'),
  updatedAt: z.string().datetime()
});

const configSchema = z.object({
  schemaVersion: z.literal(1),
  defaultWorkingDirectory: z.string().min(1).optional()
}).strict();

async function fileExists(filename: string): Promise<boolean> {
  try {
    await fs.access(filename);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filename: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filename, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw new ValidationError(`Cannot parse ${filename}: ${(error as Error).message}`);
  }
}

export class UserStorage {
  constructor(readonly paths: StoragePaths = getStoragePaths()) {}

  async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.paths.directory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.paths.directory, 0o700);
  }

  async readCredentials(): Promise<Credentials | null> {
    const value = await readJson(this.paths.credentialsFile);
    if (value === undefined) {
      return null;
    }

    const parsed = credentialsSchema.safeParse(value);
    if (!parsed.success) {
      throw new ValidationError(`Invalid credentials file: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
    }
    return parsed.data;
  }

  async requireCredentials(): Promise<Credentials> {
    const credentials = await this.readCredentials();
    if (!credentials) {
      throw new AuthenticationError('No credentials found. Pipe credential JSON to `auth set --stdin` first.');
    }
    return credentials;
  }

  async writeCredentials(input: CredentialInput): Promise<Credentials> {
    const parsed = credentialInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(`Invalid credentials: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
    }

    const credentials: Credentials = {
      schemaVersion: 1,
      environment: 'prod',
      ...parsed.data,
      updatedAt: new Date().toISOString()
    };
    await this.writeAtomicJson(this.paths.credentialsFile, credentials);
    return credentials;
  }

  async updateRefreshToken(token: string): Promise<Credentials> {
    const existing = await this.requireCredentials();
    return this.writeCredentials({
      token,
      refreshToken: existing.refreshToken,
      accountId: existing.accountId
    });
  }

  async clearCredentials(): Promise<void> {
    if (await fileExists(this.paths.credentialsFile)) {
      await fs.unlink(this.paths.credentialsFile);
    }
  }

  async readConfig(): Promise<AppConfig> {
    const value = await readJson(this.paths.configFile);
    if (value === undefined) {
      return { schemaVersion: 1 };
    }

    const parsed = configSchema.safeParse(value);
    if (!parsed.success) {
      throw new ValidationError(`Invalid config file: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
    }
    return parsed.data;
  }

  async setDefaultWorkingDirectory(directory: string): Promise<AppConfig> {
    if (!path.isAbsolute(directory)) {
      throw new ValidationError('default working directory must be an absolute path');
    }
    const config: AppConfig = {
      schemaVersion: 1,
      defaultWorkingDirectory: directory
    };
    await this.writeAtomicJson(this.paths.configFile, config);
    return config;
  }

  private async writeAtomicJson(filename: string, value: unknown): Promise<void> {
    await this.ensureDirectory();
    const temporary = path.join(
      this.paths.directory,
      `.${path.basename(filename)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    const content = `${JSON.stringify(value, null, 2)}\n`;

    try {
      await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, filename);
      await fs.chmod(filename, 0o600);
    } finally {
      if (await fileExists(temporary)) {
        await fs.unlink(temporary);
      }
    }
  }
}

export function parseCredentialInput(value: unknown): CredentialImportInput {
  const isAuthTicket = value !== null && typeof value === 'object' && 'authTicket' in value;
  const parsed = (isAuthTicket ? authTicketInputSchema : credentialInputSchema).safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`Invalid credential JSON: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
  }
  return parsed.data as CredentialImportInput;
}

export function isAuthTicketInput(value: CredentialImportInput): value is AuthTicketInput {
  return 'authTicket' in value;
}
