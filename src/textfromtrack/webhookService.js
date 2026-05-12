'use strict';

/**
 * TFT Webhook lifecycle management.
 *
 * Handles:
 *  - Registering/deleting webhooks with the TFT API
 *  - Verifying HMAC-SHA256 signatures on incoming deliveries
 *  - Processing `job.done` payloads and broadcasting SSE updates
 */

const crypto = require('crypto');
const tftClient = require('./tftClient');
const jobStore = require('./jobStore');
const userSettings = require('../storage/userSettings');
const sseService = require('../utils/sseService');
const logger = require('../utils/logger');

/**
 * Verify the HMAC-SHA256 signature on an incoming TFT webhook delivery.
 * @param {string} secret     Webhook secret stored in user settings
 * @param {Buffer} rawBody    Raw request body (Buffer, not parsed)
 * @param {string} header     Value of the `x-tft-signature` header
 * @returns {boolean}
 */
function verifySignature(secret, rawBody, header) {
  if (!secret || !header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
  } catch {
    return false;
  }
}

/**
 * Register a new webhook with TFT and persist the id + secret.
 * @param {string} callbackUrl  Full public URL TFT will POST events to
 */
async function registerWebhook(callbackUrl) {
  const result = await tftClient.registerWebhook(callbackUrl);
  userSettings.set({ webhook_id: result.id, webhook_secret: result.secret });
  logger.info({ webhook_id: result.id }, 'TFT webhook registered');
  return result;
}

/**
 * Delete an existing webhook from TFT and clear local storage.
 * @param {string} webhookId
 */
async function deleteWebhook(webhookId) {
  await tftClient.deleteWebhook(webhookId);
  userSettings.set({ webhook_id: '', webhook_secret: '' });
  logger.info({ webhookId }, 'TFT webhook deleted');
}

/**
 * Called at server startup: register a webhook if none is already saved.
 * No-op when WEBHOOK_BASE_URL is not set in config.
 */
async function ensureWebhookRegistered() {
  const settings = userSettings.get();
  if (settings.webhook_id) {
    logger.info({ webhook_id: settings.webhook_id }, 'Webhook already registered — skipping');
    return;
  }
  const config = require('../config');
  await registerWebhook(config.tftWebhookBaseUrl + '/api/tft/webhook');
}

/**
 * Process an inbound TFT webhook delivery.
 * @param {object} payload  Parsed JSON body from TFT
 */
async function handleDelivery(payload) {
  if (payload.event !== 'job.done') return;

  const { job_id, quality, segment_count, language, credits_charged } = payload;

  const updates = { status: 'done' };
  if (quality !== undefined) updates.quality = quality;
  if (segment_count !== undefined) updates.segment_count = segment_count;
  if (language !== undefined) updates.language = language;
  if (credits_charged !== undefined) updates.credits_charged = credits_charged;

  jobStore.update(job_id, updates);
  sseService.broadcast(job_id);

  logger.info({ job_id }, 'TFT webhook delivery handled');
}

module.exports = {
  verifySignature,
  registerWebhook,
  deleteWebhook,
  ensureWebhookRegistered,
  handleDelivery,
};
