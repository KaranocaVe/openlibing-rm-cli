import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { CliError, ValidationError } from './errors.js';

export interface ConfirmationOptions {
  action: string;
  yes?: boolean;
  isTTY?: boolean;
  ask?: (message: string) => Promise<string>;
}

async function defaultAsk(message: string): Promise<string> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    return await readline.question(message);
  } finally {
    readline.close();
  }
}

export async function requireConfirmation(options: ConfirmationOptions): Promise<void> {
  if (options.yes) {
    return;
  }
  if (!(options.isTTY ?? stdin.isTTY)) {
    throw new ValidationError(`Refusing non-interactive ${options.action}. Pass --yes to continue.`);
  }

  const answer = await (options.ask ?? defaultAsk)(`${options.action}. Continue? [y/N] `);
  if (!/^(y|yes|是)$/i.test(answer.trim())) {
    throw new CliError('Action cancelled.', 1);
  }
}

export function requireExplicitYes(yes: boolean | undefined, action: string): void {
  if (!yes) {
    throw new ValidationError(`${action} requires --yes.`);
  }
}
