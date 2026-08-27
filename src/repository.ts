import fs from 'node:fs';
import path from 'node:path';

import { ValidationError } from './errors.js';

function isRepositoryRoot(candidate: string): boolean {
  return fs.existsSync(path.join(candidate, 'package.json'));
}

export function repositoryRoot(): string {
  const explicit = process.env.OPENLIBING_RM_REPO_ROOT;
  if (explicit && isRepositoryRoot(explicit)) {
    return path.resolve(explicit);
  }

  const candidates = [
    process.cwd(),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..')
  ];
  const root = candidates.find(isRepositoryRoot);
  if (!root) {
    throw new ValidationError('Cannot locate the openlibing-rm repository root. Set OPENLIBING_RM_REPO_ROOT.');
  }
  return root;
}
