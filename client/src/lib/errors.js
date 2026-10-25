import i18n from '../i18n/index.js';

// System errors that reach the UI as raw messages, and what the user can do about them.
const MESSAGE_PATTERNS = [
  [/EROFS|read-only file system/i, 'READ_ONLY'],
  [/EACCES|EPERM|permission denied/i, 'NO_PERMISSION'],
  [/ENOSPC/i, 'DISK_FULL'],
  [/Failed to fetch|NetworkError|Load failed/i, 'BACKEND_UNREACHABLE'],
];

/**
 * A sentence the user can act on, from an API error envelope ({ code, message }) or an Error.
 * Falls back to the raw message when the code is unknown.
 */
export function describeError(err) {
  if (!err) return '';
  const message = typeof err === 'string' ? err : err.message || '';
  const code = typeof err === 'object' ? err.code : null;
  for (const [re, key] of MESSAGE_PATTERNS) {
    if (re.test(message)) return i18n.t(`errors.${key}`, { msg: message });
  }
  if (code && i18n.exists(`errors.${code}`)) return i18n.t(`errors.${code}`, { msg: message });
  return message || i18n.t('errors.UNKNOWN_ERROR');
}
