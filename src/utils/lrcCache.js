'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('./logger');

function _ensureDir() {
  fs.mkdirSync(config.lrcCacheDir, { recursive: true });
}

function _sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

function _normalize(str) {
  return (str || '').trim().toLowerCase();
}

function _pathKey(sourceFile) {
  return _sha256(sourceFile) + '.lrc';
}

function _metaKey(artist, title, album) {
  const key = [_normalize(artist), _normalize(title), _normalize(album)].join('|');
  return 'meta_' + _sha256(key) + '.lrc';
}

function _read(filename) {
  const filePath = path.join(config.lrcCacheDir, filename);
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    logger.warn({ err: err.message, filename }, 'lrcCache: read error');
  }
  return null;
}

function _write(filename, content) {
  _ensureDir();
  const filePath = path.join(config.lrcCacheDir, filename);
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    logger.debug({ filename }, 'lrcCache: written');
  } catch (err) {
    logger.warn({ err: err.message, filename }, 'lrcCache: write error');
  }
}

/** Read cached LRC by source file path. Returns string or null. */
function get(sourceFile) {
  return _read(_pathKey(sourceFile));
}

/** Write LRC to cache indexed by source file path. */
function set(sourceFile, lrcContent) {
  _write(_pathKey(sourceFile), lrcContent);
}

/** Read cached LRC by track metadata (artist + title + album). Returns string or null. */
function getByMeta(artist, title, album) {
  return _read(_metaKey(artist, title, album));
}

/** Write LRC to cache indexed by track metadata. */
function setByMeta(artist, title, album, lrcContent) {
  _write(_metaKey(artist, title, album), lrcContent);
}

/** Write LRC to cache under both path key and metadata key. */
function setAll(sourceFile, artist, title, album, lrcContent) {
  set(sourceFile, lrcContent);
  if (artist || title || album) {
    setByMeta(artist, title, album, lrcContent);
  }
}

module.exports = { get, set, getByMeta, setByMeta, setAll };
