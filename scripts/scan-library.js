#!/usr/bin/env node
'use strict';

require('dotenv').config();

const config = require('../src/config');
const logger = require('../src/utils/logger');
const scanner = require('../src/music/scanner');

async function main() {
  if (!config.musicRoots.length) {
    console.error('Error: MUSIC_ROOTS is not set in .env\nExample: MUSIC_ROOTS=/Users/yourname/Music,/Volumes/Music');
    process.exit(1);
  }

  console.log('Scanning music library…');
  console.log('Roots:', config.musicRoots.join(', '));
  console.log('');

  const { track_count, error_count, elapsed_ms } = await scanner.scan({
    onProgress(scanned, errors) {
      process.stdout.write(`\r  Indexed: ${scanned} files  (${errors} errors)`);
    },
  });

  process.stdout.write('\n');
  console.log('');
  console.log(`✓ Scan complete: ${track_count} tracks indexed in ${(elapsed_ms / 1000).toFixed(1)}s`);
  if (error_count > 0) {
    console.log(`  ⚠ ${error_count} files skipped (unreadable or unsupported)`);
  }
  console.log(`  Index saved to: ${config.musicIndexPath}`);
}

main().catch(err => {
  console.error('Scan failed:', err.message);
  process.exit(1);
});
