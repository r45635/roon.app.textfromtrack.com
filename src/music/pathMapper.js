'use strict';

const config = require('../config');

/**
 * Apply configured PATH_MAPPINGS to resolve a path that Roon (or another source)
 * uses into the locally accessible path.
 *
 * Mappings are applied in order; the first match wins.
 *
 * Example:
 *   Roon exposes: smb://NAS.local/Music/Pink Floyd/Track.flac
 *   Mapping:      smb://NAS.local/Music  →  /Volumes/Music
 *   Result:       /Volumes/Music/Pink Floyd/Track.flac
 *
 * @param {string} remotePath
 * @returns {string} Resolved local path (unchanged if no mapping matches)
 */
function mapPath(remotePath) {
  if (!remotePath) return remotePath;
  for (const { from, to } of config.pathMappings) {
    if (remotePath.startsWith(from)) {
      return to + remotePath.slice(from.length);
    }
  }
  return remotePath;
}

/**
 * Attempt to recover an SMB URL that Roon may store as the file location.
 * Normalises smb:// URLs to a plain path (without the host/share prefix)
 * that can then be resolved via PATH_MAPPINGS.
 *
 * @param {string} rawPath
 * @returns {string}
 */
function normalizeRoonPath(rawPath) {
  if (!rawPath) return rawPath;
  // Already a local absolute path — nothing to do
  if (rawPath.startsWith('/')) return rawPath;
  // smb://host/share/path/to/file → keep as-is for mapping
  return rawPath;
}

/**
 * Convenience: normalise then map.
 * @param {string} rawPath
 * @returns {string}
 */
function resolve(rawPath) {
  return mapPath(normalizeRoonPath(rawPath));
}

module.exports = { mapPath, normalizeRoonPath, resolve };
