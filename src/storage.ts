import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { AuthenticationError, ValidationError } from './errors.js';
import { getStoragePaths } from './paths.js';
import type {
  AccountName,
  AccountSummary,
  AppConfig,
  AuthTicketInput,
  CredentialStore,
  CredentialImportInput,
  CredentialInput,
  Credentials,
  StoragePaths
} from './types.js';

export const DEFAULT_ACCOUNT_NAME = 'default' as const;

const accountNameSchema = z.string()
  .trim()
  .min(1, 'account name must not be empty')
  .max(64, 'account name must be at most 64 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'account name may contain only letters, numbers, dot, underscore, and hyphen');

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

const credentialStoreSchema = z.object({
  schemaVersion: z.literal(2),
  currentAccount: z.string().min(1).nullable(),
  accounts: z.record(credentialsSchema)
}).strict().superRefine((value, context) => {
  for (const name of Object.keys(value.accounts)) {
    if (!accountNameSchema.safeParse(name).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accounts', name],
        message: 'invalid account name'
      });
    }
  }
  if (value.currentAccount !== null && !(value.currentAccount in value.accounts)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currentAccount'],
      message: 'current account does not exist'
    });
  }
  if (value.currentAccount === null && Object.keys(value.accounts).length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currentAccount'],
      message: 'current account is required when accounts exist'
    });
  }
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

  async readCredentials(accountName?: AccountName): Promise<Credentials | null> {
    const store = await this.readStore();
    const selected = accountName === undefined
      ? store.currentAccount
      : normalizeAccountName(accountName);
    return selected ? store.accounts[selected] || null : null;
  }

  async requireCredentials(accountName?: AccountName): Promise<Credentials> {
    const selected = accountName === undefined ? await this.currentAccountName() : normalizeAccountName(accountName);
    const credentials = selected ? await this.readCredentials(selected) : null;
    if (!credentials) {
      const suffix = selected ? ` for account "${selected}"` : '';
      throw new AuthenticationError(`No credentials found${suffix}. Pipe credential JSON to \`auth set --stdin\` first.`);
    }
    return credentials;
  }

  async currentAccountName(): Promise<AccountName | null> {
    return (await this.readStore()).currentAccount;
  }

  async resolveAccountName(accountName?: AccountName): Promise<AccountName> {
    if (accountName !== undefined) {
      return normalizeAccountName(accountName);
    }
    return (await this.currentAccountName()) || DEFAULT_ACCOUNT_NAME;
  }

  async listAccounts(): Promise<AccountSummary[]> {
    const store = await this.readStore();
    return Object.entries(store.accounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, credentials]) => ({
        name,
        accountId: credentials.accountId,
        hasRefreshToken: Boolean(credentials.refreshToken),
        updatedAt: credentials.updatedAt,
        current: store.currentAccount === name
      }));
  }

  async setCurrentAccount(accountName: AccountName): Promise<AccountName> {
    const selected = normalizeAccountName(accountName);
    const store = await this.readStore();
    if (!store.accounts[selected]) {
      throw new ValidationError(`Account "${selected}" was not found.`);
    }
    if (store.currentAccount !== selected) {
      await this.writeStore({ ...store, currentAccount: selected });
    }
    return selected;
  }

  async writeCredentials(input: CredentialInput, accountName?: AccountName): Promise<Credentials> {
    const parsed = credentialInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(`Invalid credentials: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
    }

    const store = await this.readStore();
    const selected = accountName === undefined
      ? store.currentAccount || DEFAULT_ACCOUNT_NAME
      : normalizeAccountName(accountName);
    const credentials: Credentials = {
      schemaVersion: 1,
      environment: 'prod',
      ...parsed.data,
      updatedAt: new Date().toISOString()
    };
    await this.writeStore({
      schemaVersion: 2,
      currentAccount: store.currentAccount || selected,
      accounts: {
        ...store.accounts,
        [selected]: credentials
      }
    });
    return credentials;
  }

  async updateRefreshToken(token: string, accountName?: AccountName): Promise<Credentials> {
    const selected = await this.resolveAccountName(accountName);
    const existing = await this.requireCredentials(selected);
    return this.writeCredentials({
      token,
      refreshToken: existing.refreshToken,
      accountId: existing.accountId
    }, selected);
  }

  async clearCredentials(accountName?: AccountName): Promise<void> {
    const store = await this.readStore();
    const selected = accountName === undefined
      ? store.currentAccount || DEFAULT_ACCOUNT_NAME
      : normalizeAccountName(accountName);
    if (!store.accounts[selected]) {
      return;
    }

    const accounts = { ...store.accounts };
    delete accounts[selected];
    if (Object.keys(accounts).length === 0) {
      await this.removeCredentialsFile();
      return;
    }

    const currentAccount = store.currentAccount === selected
      ? Object.keys(accounts).sort((left, right) => left.localeCompare(right))[0]
      : store.currentAccount;
    await this.writeStore({ schemaVersion: 2, currentAccount, accounts });
  }

  async clearAllCredentials(): Promise<void> {
    await this.removeCredentialsFile();
  }

  private async readStore(): Promise<CredentialStore> {
    const value = await readJson(this.paths.credentialsFile);
    if (value === undefined) {
      return { schemaVersion: 2, currentAccount: null, accounts: {} };
    }

    const store = credentialStoreSchema.safeParse(value);
    if (store.success) {
      return store.data;
    }

    // Migrate the original single-account format in memory. It is upgraded to
    // schema v2 on the next write, so existing users can keep using the CLI
    // without a manual credentials-file edit.
    const legacy = credentialsSchema.safeParse(value);
    if (legacy.success) {
      return {
        schemaVersion: 2,
        currentAccount: DEFAULT_ACCOUNT_NAME,
        accounts: { [DEFAULT_ACCOUNT_NAME]: legacy.data }
      };
    }

    throw new ValidationError('Invalid credentials file format.');
  }

  private async writeStore(store: CredentialStore): Promise<void> {
    const parsed = credentialStoreSchema.safeParse(store);
    if (!parsed.success) {
      throw new ValidationError('Invalid credentials store.');
    }
    await this.writeAtomicJson(this.paths.credentialsFile, parsed.data);
  }

  private async removeCredentialsFile(): Promise<void> {
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

export function normalizeAccountName(value: AccountName): AccountName {
  const parsed = accountNameSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`Invalid account name: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
  }
  return parsed.data;
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
