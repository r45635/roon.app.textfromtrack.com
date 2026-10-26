import i18n from '../i18n/index.js';
import { isPrivacyMode } from './privacy.js';

/** Link to the phone / TV QR page, in the UI's language (and with the example address in screenshot mode). */
export function qrPageUrl() {
  const params = new URLSearchParams({ lang: (i18n.language || 'en').slice(0, 2) });
  if (isPrivacyMode()) params.set('privacy', '1');
  return `/api/qr?${params}`;
}
