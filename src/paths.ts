import os from 'node:os';
import path from 'node:path';

import { ValidationError } from './errors.js';
import type { StoragePaths, SupportedPlatform } from './types.js';

type Environment = Record<string, string | undefined>;

export function getStoragePaths(
  platform: NodeJS.Platform = process.platform,
  homeDirectory = os.homedir(),
  environment: Environment = process.env
): StoragePaths {
  let directory: string;

  if (platform === 'darwin') {
    directory = path.join(homeDirectory, 'Library', 'Application Support', 'openlibing-rm');
  } else if (platform === 'linux') {
    directory = path.join(environment.XDG_CONFIG_HOME || path.join(homeDirectory, '.config'), 'openlibing-rm');
  } else {
    throw new ValidationError(`Unsupported local platform: ${platform}. Only macOS and Linux are supported.`);
  }

  return {
    directory,
    credentialsFile: path.join(directory, 'credentials.json'),
    configFile: path.join(directory, 'config.json')
  };
}

export function supportedPlatform(platform: NodeJS.Platform = process.platform): SupportedPlatform {
  if (platform === 'darwin' || platform === 'linux') {
    return platform;
  }
  throw new ValidationError(`Unsupported local platform: ${platform}. Only macOS and Linux are supported.`);
}
