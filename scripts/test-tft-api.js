#!/usr/bin/env node
'use strict';

require('dotenv').config();

const config = require('../src/config');
const tftClient = require('../src/textfromtrack/tftClient');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'me';

  if (!config.tftToken) {
    console.error('Error: TFT_TOKEN is not set in .env');
    process.exit(1);
  }

  console.log(`TextFromTrack API test — command: ${command}`);
  console.log(`Base URL: ${config.tftBaseUrl}`);
  console.log('');

  switch (command) {
    case 'me': {
      console.log('GET /me');
      const me = await tftClient.getMe();
      console.log(JSON.stringify(me, null, 2));
      break;
    }

    case 'list': {
      console.log('GET /transcriptions');
      const list = await tftClient.listTranscriptions({ per_page: 10 });
      console.log(JSON.stringify(list, null, 2));
      break;
    }

    case 'status': {
      const jobId = args[1];
      if (!jobId) { console.error('Usage: npm run test:tft status <job_id>'); process.exit(1); }
      console.log(`GET /transcriptions/${jobId}`);
      const job = await tftClient.getTranscription(jobId);
      console.log(JSON.stringify(job, null, 2));
      break;
    }

    case 'submit': {
      const filePath = args[1];
      if (!filePath) { console.error('Usage: npm run test:tft submit <file_path>'); process.exit(1); }
      console.log(`POST /transcriptions — file: ${filePath}`);
      const result = await tftClient.submitTranscription(filePath);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'download': {
      const jobId = args[1];
      const format = args[2] || 'lrc';
      if (!jobId) { console.error('Usage: npm run test:tft download <job_id> [format]'); process.exit(1); }
      console.log(`GET /transcriptions/${jobId}/export?format=${format}`);
      const content = await tftClient.downloadExport(jobId, format);
      console.log(content);
      break;
    }

    default:
      console.log('Available commands: me | list | status <job_id> | submit <file> | download <job_id> [format]');
  }
}

main().catch(err => {
  console.error('Error:', err.code ? `[${err.code}] ${err.message}` : err.message);
  process.exit(1);
});
