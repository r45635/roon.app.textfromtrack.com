'use strict';

// ─── Local error codes ────────────────────────────────────────────────────────

const E = {
  ROON_NOT_CONNECTED: 'ROON_NOT_CONNECTED',
  ROON_NOT_AUTHORIZED: 'ROON_NOT_AUTHORIZED',
  NO_CURRENT_TRACK: 'NO_CURRENT_TRACK',
  NO_LOCAL_MATCH: 'NO_LOCAL_MATCH',
  LOW_CONFIDENCE_MATCH: 'LOW_CONFIDENCE_MATCH',
  LYRICS_ALREADY_EXIST: 'LYRICS_ALREADY_EXIST',
  LRC_ALREADY_EXISTS: 'LRC_ALREADY_EXISTS',
  TFT_TOKEN_MISSING: 'TFT_TOKEN_MISSING',
  TFT_UNAUTHORIZED: 'TFT_UNAUTHORIZED',
  TFT_INSUFFICIENT_CREDITS: 'TFT_INSUFFICIENT_CREDITS',
  TFT_RATE_LIMITED: 'TFT_RATE_LIMITED',
  TFT_TRACK_TOO_LONG: 'TFT_TRACK_TOO_LONG',
  TFT_UNSUPPORTED_FORMAT: 'TFT_UNSUPPORTED_FORMAT',
  TFT_EXPORT_EXPIRED: 'TFT_EXPORT_EXPIRED',
  TFT_NOT_FOUND: 'TFT_NOT_FOUND',
  TFT_VALIDATION_ERROR: 'TFT_VALIDATION_ERROR',
  TFT_INTERNAL_ERROR: 'TFT_INTERNAL_ERROR',
  SOURCE_FILE_NOT_FOUND: 'SOURCE_FILE_NOT_FOUND',
  SOURCE_FILE_TOO_LARGE: 'SOURCE_FILE_TOO_LARGE',
  SOURCE_FILE_UNREADABLE: 'SOURCE_FILE_UNREADABLE',
  LRC_WRITE_FAILED: 'LRC_WRITE_FAILED',
  LYRICS_EMBED_FAILED: 'LYRICS_EMBED_FAILED',
  LYRICS_EMBED_UNSUPPORTED: 'LYRICS_EMBED_UNSUPPORTED',
  BACKUP_EXISTS: 'BACKUP_EXISTS',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};

// ─── TFT API error code → local error code ────────────────────────────────────

const TFT_ERROR_MAP = {
  validation_error: E.TFT_VALIDATION_ERROR,
  unsupported_format: E.TFT_UNSUPPORTED_FORMAT,
  track_too_long: E.TFT_TRACK_TOO_LONG,
  unauthorized: E.TFT_UNAUTHORIZED,
  insufficient_credits: E.TFT_INSUFFICIENT_CREDITS,
  not_found: E.TFT_NOT_FOUND,
  gone: E.TFT_EXPORT_EXPIRED,
  rate_limited: E.TFT_RATE_LIMITED,
  internal_error: E.TFT_INTERNAL_ERROR,
};

/**
 * Map a TFT API error code to a local error code.
 * @param {string} apiCode
 * @returns {string}
 */
function mapTftError(apiCode) {
  return TFT_ERROR_MAP[apiCode] || E.UNKNOWN_ERROR;
}

/**
 * Build a standardised error response envelope.
 * @param {string} code   - One of the E.* constants
 * @param {string} message
 * @param {object} [details]
 * @returns {{ success: false, error: { code, message, details } }}
 */
function buildError(code, message, details = {}) {
  return { success: false, error: { code, message, details } };
}

/**
 * Build a custom Error that carries a local error code.
 * Useful for throwing inside services and catching in route handlers.
 */
class AppError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Normalise a string for metadata comparison (accent-folded, lowercased, stripped).
 * @param {string|null|undefined} str
 * @returns {string}
 */
function normalizeStr(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9\s]/g, ' ') // keep only alphanumeric + space
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── M2: Artist normalisation (strip featured artists, normalise separators) ──

/**
 * Normalise an artist string for matching:
 * - Strip everything after "feat.", "ft.", "featuring", "vs.", "versus"
 * - Replace " & " (and variants) with " and "
 * Then apply standard normaliseStr.
 * @param {string|null|undefined} str
 * @returns {string}
 */
function normalizeArtist(str) {
  if (!str) return '';
  const stripped = str
    .replace(/\s+(?:feat\.?|ft\.?|featuring|vs\.?|versus)\s+.+$/i, '')
    .replace(/\s+&\s+/g, ' and ');
  return normalizeStr(stripped);
}

// ─── M3: Album normalisation (strip edition/remaster/live suffixes) ───────────

// Match common edition/remaster suffixes inside trailing parentheses or brackets.
// Only removes the trailing parenthetical — leaves the base album title intact.
const _ALBUM_SUFFIX_RE = /\s*[\(\[]\s*(?:remaster(?:ed)?(?:\s+\d{4})?|live|deluxe(?:\s+edition)?|expanded(?:\s+edition)?|anniversary(?:\s+edition)?|special(?:\s+edition)?|super\s+deluxe|bonus\s+tracks?(?:\s+version)?|explicit(?:\s+(?:version|content))?)\s*[\)\]]\s*$/i;

/**
 * Normalise an album string for matching:
 * - Strip trailing remaster / deluxe / live edition suffixes (parenthetical)
 * Then apply standard normaliseStr.
 * @param {string|null|undefined} str
 * @returns {string}
 */
function normalizeAlbum(str) {
  if (!str) return '';
  return normalizeStr(str.replace(_ALBUM_SUFFIX_RE, ''));
}

module.exports = { E, mapTftError, buildError, AppError, normalizeStr, normalizeArtist, normalizeAlbum };
