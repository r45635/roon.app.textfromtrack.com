'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Read a JSON file. Returns `defaultValue` if the file does not exist or is invalid.
 * @param {string} filePath
 * @param {*} defaultValue
 */
function readJson(filePath, defaultValue = null) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

/**
 * Write JSON to a file atomically (write to .tmp then rename).
 * @param {string} filePath
 * @param {*} data
 */
function writeJson(filePath, data) {
  const tmp = filePath + '.tmp';
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Ensure a directory exists.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

module.exports = { readJson, writeJson, ensureDir };
