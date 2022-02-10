#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import Balaur from '../src/index.mjs';

const fsExistsSync = (path) => {
  let exists = true;

  try {
    fs.lstatSync(path);
  } catch {
    exists = false;
  }

  return exists;
};

const CONFIG_FILE_NAME = process.env.BALAUR_CONFIG_FILE || 'balaur.config.mjs';

let config = null;

if (fsExistsSync(CONFIG_FILE_NAME)) {
  try {
    const configFilePath = path.resolve(process.cwd(), CONFIG_FILE_NAME);
    const configModule = await import(configFilePath);

    if (!configModule.default) {
      console.warn('Invalid Balaur config file, using defaults.');
    }

    config = configModule.default;
  } catch {
    console.warn('Unable to read Balaur config file, using defaults.');
  }
}

try {
  const balaur = new Balaur(
    async () => {
      const mainPath = path.resolve(process.cwd(), config?.main);
      return await import(mainPath);
    },
    config
  );

  balaur.processArgs();
} catch (err) {
  console.error('Error', err);
}