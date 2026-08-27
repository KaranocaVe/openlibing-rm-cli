import { stdout } from 'node:process';

import { redactValue } from './redact.js';

function scalar(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function objectTable(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return 'No results.';
  }
  const preferred = ['id', 'devEnvId', 'devEnvName', 'status', 'workingDir', 'description'];
  const columns = [...new Set([...preferred, ...rows.flatMap((row) => Object.keys(row))])]
    .filter((column) => rows.some((row) => row[column] !== undefined));
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => scalar(row[column]).length)));
  const render = (values: string[]) => values.map((value, index) => value.padEnd(widths[index])).join('  ').trimEnd();
  return [
    render(columns),
    render(widths.map((width) => '-'.repeat(width))),
    ...rows.map((row) => render(columns.map((column) => scalar(row[column]))))
  ].join('\n');
}

function humanOutput(value: unknown): string {
  if (Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object')) {
    return objectTable(value as Array<Record<string, unknown>>);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items) && record.items.every((item) => item !== null && typeof item === 'object')) {
      return objectTable(record.items as Array<Record<string, unknown>>);
    }
    return Object.entries(record).map(([key, nested]) => `${key}: ${scalar(nested)}`).join('\n');
  }
  return scalar(value);
}

export function writeOutput(value: unknown, json = false): void {
  const safe = redactValue(value);
  const rendered = json ? JSON.stringify(safe, null, 2) : humanOutput(safe);
  stdout.write(`${rendered}\n`);
}
