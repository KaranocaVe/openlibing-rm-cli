import fs from 'node:fs/promises';
import { stderr, stdin } from 'node:process';

import { Command } from 'commander';

import { requireConfirmation, requireExplicitYes, type ConfirmationOptions } from './confirmation.js';
import { exchangeAuthTicket } from './core.js';
import { CliError, ValidationError } from './errors.js';
import { writeOutput } from './output.js';
import { redactText } from './redact.js';
import { ResourceService } from './resource-service.js';
import { isAuthTicketInput, parseCredentialInput, UserStorage } from './storage.js';
import type { CredentialInput } from './types.js';

type OutputOptions = { json?: boolean };
type Confirm = (options: ConfirmationOptions) => Promise<void>;

export interface CliDependencies {
  createStorage?: () => UserStorage;
  createService?: (storage: UserStorage, accountName?: string) => Promise<ResourceService>;
  exchangeAuthTicket?: (storage: UserStorage, authTicket: string) => Promise<CredentialInput>;
  confirm?: Confirm;
}

async function readStdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const source = Buffer.concat(chunks).toString('utf8').trim();
  if (!source) {
    throw new ValidationError('Credential JSON is required on standard input.');
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new ValidationError(`Credential JSON is invalid: ${(error as Error).message}`);
  }
}

async function readJsonFile(filename: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filename, 'utf8'));
  } catch (error) {
    throw new ValidationError(`Cannot read creation spec ${filename}: ${(error as Error).message}`);
  }
}

function jsonOption(command: Command): Command {
  return command.option('--json', 'emit machine-readable JSON');
}

function accountOption(command: Command): Command {
  return command.option('--account <name>', 'credential account profile (defaults to the current account)');
}

function mutatingOptions(command: Command): Command {
  return jsonOption(command).option('--yes', 'skip the interactive confirmation');
}

function emit(value: unknown, options: OutputOptions): void {
  writeOutput(value, Boolean(options.json));
}

function services(dependencies: CliDependencies): {
  storage: () => UserStorage;
  service: (storage: UserStorage, accountName?: string) => Promise<ResourceService>;
  exchangeAuthTicket: (storage: UserStorage, authTicket: string) => Promise<CredentialInput>;
  confirm: Confirm;
} {
  return {
    storage: dependencies.createStorage ?? (() => new UserStorage()),
    service: dependencies.createService ?? ((storage, accountName) => ResourceService.create(storage, accountName)),
    exchangeAuthTicket: dependencies.exchangeAuthTicket ?? exchangeAuthTicket,
    confirm: dependencies.confirm ?? requireConfirmation
  };
}

export function buildProgram(dependencies: CliDependencies = {}): Command {
  const factories = services(dependencies);
  const program = new Command()
    .name('openlibing-rm')
    .description('Command-line resource management for openLiBing HidevLab environments')
    .showSuggestionAfterError();

  const auth = program.command('auth').description('Manage production HidevLab credentials');
  accountOption(jsonOption(auth.command('set'))
    .description('Store credential JSON read from standard input; authTicket is exchanged through HidevLab')
    .requiredOption('--stdin', 'read {token, refreshToken?, accountId?} or {authTicket, accountId?} from standard input')
    .action(async (options: OutputOptions & { stdin?: boolean; account?: string }) => {
      if (!options.stdin) {
        throw new ValidationError('auth set requires --stdin. Credentials are never accepted as command-line arguments.');
      }
      const storage = factories.storage();
      const accountName = await storage.resolveAccountName(options.account);
      const imported = parseCredentialInput(await readStdinJson());
      const credentialInput = isAuthTicketInput(imported)
        ? {
            ...(await factories.exchangeAuthTicket(storage, imported.authTicket)),
            ...(imported.accountId ? { accountId: imported.accountId } : {})
          }
        : imported;
      const credentials = await storage.writeCredentials(credentialInput, accountName);
      emit({ account: accountName, configured: true, environment: credentials.environment, accountId: credentials.accountId, hasRefreshToken: Boolean(credentials.refreshToken), updatedAt: credentials.updatedAt }, options);
    }));
  accountOption(jsonOption(auth.command('status'))
    .description('Show whether local production credentials are configured')
    .action(async (options: OutputOptions & { account?: string }) => {
      const storage = factories.storage();
      const accountName = await storage.resolveAccountName(options.account);
      const credentials = await storage.readCredentials(accountName);
      emit(credentials
        ? { account: accountName, configured: true, environment: credentials.environment, accountId: credentials.accountId, hasRefreshToken: Boolean(credentials.refreshToken), updatedAt: credentials.updatedAt }
        : { account: accountName, configured: false, environment: 'prod' }, options);
    }));
  jsonOption(auth.command('list')
    .description('List configured account profiles without exposing credentials')
    .action(async (options: OutputOptions) => {
      const storage = factories.storage();
      emit({ currentAccount: await storage.currentAccountName(), accounts: await storage.listAccounts() }, options);
    }));
  jsonOption(auth.command('use <account>')
    .description('Select the account used by commands without --account')
    .action(async (account: string, options: OutputOptions) => {
      const currentAccount = await factories.storage().setCurrentAccount(account);
      emit({ currentAccount }, options);
    }));
  accountOption(jsonOption(auth.command('clear [account]'))
    .description('Delete one account profile, or all profiles with --all')
    .requiredOption('--yes', 'required because this deletes local credentials')
    .option('--all', 'delete every configured account')
    .action(async (account: string | undefined, options: OutputOptions & { yes?: boolean; all?: boolean; account?: string }) => {
      requireExplicitYes(options.yes, 'auth clear');
      const requestedAccount = account || options.account;
      if (account && options.account && account !== options.account) {
        throw new ValidationError('auth clear received two different account names.');
      }
      if (requestedAccount && options.all) {
        throw new ValidationError('auth clear accepts either an account name or --all, not both.');
      }
      const storage = factories.storage();
      if (options.all) {
        await storage.clearAllCredentials();
        emit({ cleared: true, all: true }, options);
        return;
      }
      const accountName = await storage.resolveAccountName(requestedAccount);
      await storage.clearCredentials(accountName);
      emit({ cleared: true, account: accountName }, options);
    }));

  const config = program.command('config').description('Manage local non-secret configuration');
  const configSet = config.command('set').description('Set one local configuration value');
  jsonOption(configSet.command('default-working-dir <directory>')
    .description('Set an absolute fallback remote working directory')
    .action(async (directory: string, options: OutputOptions) => {
      emit(await factories.storage().setDefaultWorkingDirectory(directory), options);
    }));
  jsonOption(config.command('show')
    .description('Show local non-secret configuration')
    .action(async (options: OutputOptions) => {
      emit(await factories.storage().readConfig(), options);
    }));

  const catalog = program.command('catalog').description('Discover resource creation options');
  accountOption(jsonOption(catalog.command('defaults'))
    .description('Show creation defaults and the maximum environment count')
    .action(async (options: OutputOptions & { account?: string }) => {
      const service = await factories.service(factories.storage(), options.account);
      const [defaults, maxEnvironments] = await Promise.all([service.catalogDefaults(), service.catalogMaxEnvironments()]);
      emit({ defaults, maxEnvironments }, options);
    }));
  accountOption(jsonOption(catalog.command('device-types'))
    .description('List available device types')
    .action(async (options: OutputOptions & { account?: string }) => {
      emit(await (await factories.service(factories.storage(), options.account)).catalogDeviceTypes(), options);
    }));
  accountOption(jsonOption(catalog.command('images'))
    .description('List available images')
    .option('--model-type <modelType>', 'device model type')
    .action(async (options: OutputOptions & { modelType?: string; account?: string }) => {
      emit(await (await factories.service(factories.storage(), options.account)).catalogImages(options.modelType), options);
    }));
  accountOption(jsonOption(catalog.command('flavors'))
    .description('List available flavors')
    .option('--compute-type <type>', 'compute type', '2')
    .option('--image-id <imageId>', 'image id')
    .option('--model-type <modelType>', 'device model type')
    .action(async (options: OutputOptions & { computeType: string; imageId?: string; modelType?: string; account?: string }) => {
      const computeType = Number.parseInt(options.computeType, 10);
      emit(await (await factories.service(factories.storage(), options.account)).catalogFlavors(computeType, options.imageId, options.modelType), options);
    }));

  const environment = program.command('env').description('Manage HidevLab resource environments');
  accountOption(jsonOption(environment.command('list'))
    .description('List resource environments')
    .action(async (options: OutputOptions & { account?: string }) => {
      emit(await (await factories.service(factories.storage(), options.account)).list(), options);
    }));
  accountOption(jsonOption(environment.command('show <id>'))
    .description('Show one environment from the resource inventory')
    .action(async (id: string, options: OutputOptions & { account?: string }) => {
      emit(await (await factories.service(factories.storage(), options.account)).show(id), options);
    }));
  accountOption(jsonOption(environment.command('status <id>'))
    .description('Fetch an environment status')
    .action(async (id: string, options: OutputOptions & { account?: string }) => {
      emit({ environmentId: id, status: await (await factories.service(factories.storage(), options.account)).status(id) }, options);
    }));
  accountOption(mutatingOptions(environment.command('create'))
    .description('Create one or more environments from an upstream-compatible JSON request')
    .requiredOption('--spec <file>', 'path to a createDevEnv JSON request')
    .action(async (options: OutputOptions & { spec: string; yes?: boolean; account?: string }) => {
      await factories.confirm({ action: 'Creating resource environments', yes: options.yes });
      emit(await (await factories.service(factories.storage(), options.account)).createEnvironment(await readJsonFile(options.spec)), options);
    }));

  for (const action of ['start', 'stop', 'delete'] as const) {
    accountOption(mutatingOptions(environment.command(`${action} <id>`))
      .description(`${action[0].toUpperCase()}${action.slice(1)} a resource environment`)
      .option('--no-wait', 'return after the upstream request instead of polling')
      .action(async (id: string, options: OutputOptions & { yes?: boolean; wait: boolean; account?: string }) => {
        await factories.confirm({ action: `${action} environment ${id}`, yes: options.yes });
        const service = await factories.service(factories.storage(), options.account);
        const result = action === 'start'
          ? await service.start(id, options.wait)
          : action === 'stop'
            ? await service.stop(id, options.wait)
            : await service.delete(id, options.wait);
        emit(result, options);
      }));
  }

  accountOption(mutatingOptions(environment.command('connection-plan <id>'))
    .description('Generate a redacted SSH plan; requesting connection data may start the environment')
    .action(async (id: string, options: OutputOptions & { yes?: boolean; account?: string }) => {
      await factories.confirm({ action: `Requesting a connection plan for environment ${id} (may start the environment)`, yes: options.yes });
      emit(await (await factories.service(factories.storage(), options.account)).connectionPlan(id), options);
    }));
  accountOption(mutatingOptions(environment.command('sync-plan <id>'))
    .description('Generate a redacted SFTP or rsync plan without transferring data')
    .requiredOption('--local <directory>', 'local source directory')
    .option('--remote-dir <directory>', 'explicit target remote directory')
    .option('--transport <transport>', 'sftp or rsync', 'sftp')
    .action(async (id: string, options: OutputOptions & {
      yes?: boolean;
      local: string;
      remoteDir?: string;
      transport: string;
      account?: string;
    }) => {
      if (options.transport !== 'sftp' && options.transport !== 'rsync') {
        throw new ValidationError('--transport must be sftp or rsync');
      }
      await factories.confirm({ action: `Requesting a sync plan for environment ${id} (may start the environment)`, yes: options.yes });
      emit(await (await factories.service(factories.storage(), options.account)).syncPlan({
        environmentId: id,
        localDirectory: options.local,
        remoteDirectory: options.remoteDir,
        transport: options.transport
      }), options);
    }));

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  await buildProgram().parseAsync(argv);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${redactText(message)}\n`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  });
}
