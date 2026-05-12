'use strict';

/**
 * Minimal Server-Sent Events (SSE) broadcast service.
 *
 * Connected clients are Express response objects that have had their headers
 * flushed for an `text/event-stream` connection.
 */

const clients = new Set();

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

/**
 * Broadcast a job_updated event to all connected SSE clients.
 * @param {string} jobId
 */
function broadcast(jobId) {
  const data = JSON.stringify({ type: 'job_updated', job_id: jobId });
  for (const res of clients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

module.exports = { addClient, removeClient, broadcast };
