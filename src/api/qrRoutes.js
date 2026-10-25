'use strict';

const { Router } = require('express');
const QRCode = require('qrcode');
const config = require('../config');
const { getLanAddress } = require('../utils/lanAddress');

const router = Router();

// GET /api/qr  — serves a QR code page for the local network URL
router.get('/', async (req, res) => {
  const ip = getLanAddress();
  const baseUrl = ip ? `http://${ip}:${config.port}` : null;
  // With ACCESS_TOKEN, the link carries the token so one scan sets the phone up.
  const tokenQuery = config.accessToken ? `/?access_token=${encodeURIComponent(config.accessToken)}` : '';
  const networkUrl = baseUrl ? `${baseUrl}${tokenQuery}` : null;
  const kioskUrl = baseUrl ? `${baseUrl}${tokenQuery || '/'}#/lyrics` : null;

  const qrOptions = { width: 280, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } };
  let qrDataUrl = null;
  let kioskQrDataUrl = null;
  if (networkUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(networkUrl, qrOptions);
      kioskQrDataUrl = await QRCode.toDataURL(kioskUrl, qrOptions);
    } catch { /* ignore */ }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect — TextFromTrack</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #111827;
      color: #f9fafb;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1f2937;
      border-radius: 16px;
      padding: 40px 32px;
      text-align: center;
      max-width: 360px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    h1 { font-size: 1.1rem; font-weight: 600; color: #d1d5db; margin-bottom: 6px; }
    .sub { font-size: 0.85rem; color: #9ca3af; margin-bottom: 28px; }
    .qr-wrap {
      background: #ffffff;
      border-radius: 12px;
      padding: 16px;
      display: inline-block;
      margin-bottom: 24px;
    }
    .qr-wrap img { display: block; border-radius: 4px; }
    .url {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.9rem;
      color: #60a5fa;
      background: #111827;
      border-radius: 8px;
      padding: 10px 16px;
      word-break: break-all;
      text-decoration: none;
      display: block;
      margin-bottom: 20px;
    }
    .url:hover { color: #93c5fd; }
    .note { font-size: 0.78rem; color: #6b7280; line-height: 1.5; }
    .error { color: #f87171; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect from your phone</h1>
    <p class="sub">Scan the QR code or open the link below</p>

    ${qrDataUrl
      ? `<div class="qr-wrap"><img src="${qrDataUrl}" width="248" height="248" alt="QR code" /></div>
         <a class="url" href="${networkUrl}" target="_blank">${networkUrl}</a>
         <h1 style="margin-top:28px">Lyrics display for a tablet or TV</h1>
         <p class="sub">Full-screen synced lyrics; pick the zone on the device.</p>
         ${kioskQrDataUrl ? `<div class="qr-wrap"><img src="${kioskQrDataUrl}" width="248" height="248" alt="QR code for the lyrics display" /></div>` : ''}
         <a class="url" href="${kioskUrl}" target="_blank">${kioskUrl}</a>
         ${config.accessToken ? '<p class="note">These links contain your access token — share them only with your own devices.</p>' : ''}`
      : `<p class="error">No local network interface found.<br/>Make sure Wi-Fi or Ethernet is connected.</p>`
    }

    <p class="note">Both devices must be on the same Wi-Fi or Ethernet network.</p>
  </div>
</body>
</html>`);
});

module.exports = router;
