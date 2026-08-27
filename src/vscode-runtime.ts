import { createInterface } from 'node:readline/promises';
import { stdin, stderr, stdout } from 'node:process';

import { redactText } from './redact.js';

export interface VscodeCompatRuntime {
  workspaceFolders?: unknown[];
  configuration?: Record<string, unknown>;
  emit(level: 'debug' | 'info' | 'warning' | 'error', message: string): void;
  choose(message: string, items: string[]): Promise<string | undefined>;
}

declare global {
  // This is intentionally global because copied upstream modules obtain their VS Code runtime with require('vscode').
  // eslint-disable-next-line no-var
  var __openlibingRmVscodeRuntime: VscodeCompatRuntime | undefined;
}

async function chooseFromTerminal(message: string, items: string[]): Promise<string | undefined> {
  if (!stdin.isTTY || items.length === 0) {
    return undefined;
  }

  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const options = items.map((item, index) => `${index + 1}) ${item}`).join('  ');
    const response = await readline.question(`${redactText(message)}\n${options}\nSelect [1-${items.length}] (Enter cancels): `);
    const index = Number.parseInt(response, 10) - 1;
    return Number.isInteger(index) && index >= 0 && index < items.length ? items[index] : undefined;
  } finally {
    readline.close();
  }
}

export function installVscodeRuntime(debug = process.env.OPENLIBING_RM_DEBUG === '1'): VscodeCompatRuntime {
  const runtime: VscodeCompatRuntime = {
    workspaceFolders: undefined,
    configuration: {},
    emit(level, message) {
      if (level === 'debug' && !debug) {
        return;
      }
      stderr.write(`[upstream:${level}] ${redactText(message)}\n`);
    },
    choose: chooseFromTerminal
  };
  globalThis.__openlibingRmVscodeRuntime = runtime;
  return runtime;
}
