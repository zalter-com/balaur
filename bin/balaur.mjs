#!/usr/bin/env node
import fs from 'fs';
import { cpus } from 'os';
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

const CONFIG_FILE_NAME = process.env.BALAUR_CONFIG_FILE || 'balaur.config.json';

let config = null;

if (fsExistsSync(CONFIG_FILE_NAME)) {
  try {
    const data = fs.readFileSync(
      CONFIG_FILE_NAME,
      { encoding: 'utf-8' }
    );
    config = JSON.parse(data);
  } catch {
    console.warn('Unable to read Balaur config file, using defaults.');
  }
}

const importFile = `file://${process.cwd()}/${config?.main || 'index.mjs'}`;
const serveFunction = (await import(importFile)).default;

try {
  const balaur = new Balaur(serveFunction, config);

  balaur.processArgs();
} catch (err) {
  console.error('Error', err);
}
