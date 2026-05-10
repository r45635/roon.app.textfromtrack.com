'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ─── Redirect jobsPath to a temp file before loading jobStore ─────────────────

let tmpDir;
let tmpJobsPath;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-jobstore-test-'));
  tmpJobsPath = path.join(tmpDir, 'jobs.json');

  // Patch config singleton before jobStore is required
  const config = require('../../src/config');
  config.jobsPath = tmpJobsPath;
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// jobStore is required lazily so the config patch above takes effect
let jobStore;
before(() => {
  jobStore = require('../../src/textfromtrack/jobStore');
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return {
    job_id: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source_file: '/music/track.mp3',
    lrc_file: null,
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    status: 'pending',
    credits_quoted: 1,
    credits_charged: null,
    segment_count: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    error: null,
    ...overrides,
  };
}

// Reset store between tests
function clearStore() {
  if (fs.existsSync(tmpJobsPath)) fs.unlinkSync(tmpJobsPath);
}

// ─── create ──────────────────────────────────────────────────────────────────

describe('jobStore.create', () => {
  test('persists a new job and it can be found by ID', () => {
    clearStore();
    const job = makeJob();
    jobStore.create(job);
    const found = jobStore.findById(job.job_id);
    assert.ok(found, 'job should be found after creation');
    assert.equal(found.job_id, job.job_id);
    assert.equal(found.title, 'Test Track');
  });

  test('creates the storage file on first write', () => {
    clearStore();
    assert.ok(!fs.existsSync(tmpJobsPath));
    jobStore.create(makeJob());
    assert.ok(fs.existsSync(tmpJobsPath));
  });

  test('stores multiple jobs, newest first', () => {
    clearStore();
    const j1 = makeJob({ title: 'First' });
    const j2 = makeJob({ title: 'Second' });
    jobStore.create(j1);
    jobStore.create(j2);
    const all = jobStore.list();
    assert.equal(all[0].title, 'Second', 'newest should be first');
    assert.equal(all[1].title, 'First');
  });
});

// ─── findById ────────────────────────────────────────────────────────────────

describe('jobStore.findById', () => {
  test('returns null for unknown ID', () => {
    clearStore();
    assert.equal(jobStore.findById('nonexistent'), null);
  });

  test('returns null on empty store', () => {
    clearStore();
    assert.equal(jobStore.findById('any'), null);
  });

  test('finds the correct job among many', () => {
    clearStore();
    const j1 = makeJob({ title: 'Alpha' });
    const j2 = makeJob({ title: 'Beta' });
    const j3 = makeJob({ title: 'Gamma' });
    jobStore.create(j1);
    jobStore.create(j2);
    jobStore.create(j3);
    const found = jobStore.findById(j2.job_id);
    assert.equal(found?.title, 'Beta');
  });
});

// ─── update ──────────────────────────────────────────────────────────────────

describe('jobStore.update', () => {
  test('updates specified fields on an existing job', () => {
    clearStore();
    const job = makeJob({ status: 'pending' });
    jobStore.create(job);
    jobStore.update(job.job_id, { status: 'done', credits_charged: 1 });
    const updated = jobStore.findById(job.job_id);
    assert.equal(updated?.status, 'done');
    assert.equal(updated?.credits_charged, 1);
  });

  test('preserves fields not mentioned in the update', () => {
    clearStore();
    const job = makeJob({ title: 'Original', status: 'pending' });
    jobStore.create(job);
    jobStore.update(job.job_id, { status: 'processing' });
    const updated = jobStore.findById(job.job_id);
    assert.equal(updated?.title, 'Original', 'title should be preserved');
  });

  test('does not throw for unknown job ID', () => {
    clearStore();
    assert.doesNotThrow(() => jobStore.update('ghost-id', { status: 'done' }));
  });
});

// ─── list ────────────────────────────────────────────────────────────────────

describe('jobStore.list', () => {
  test('returns empty array on empty store', () => {
    clearStore();
    assert.deepEqual(jobStore.list(), []);
  });

  test('returns all jobs when no limit given', () => {
    clearStore();
    jobStore.create(makeJob());
    jobStore.create(makeJob());
    jobStore.create(makeJob());
    assert.equal(jobStore.list().length, 3);
  });

  test('respects the limit parameter', () => {
    clearStore();
    for (let i = 0; i < 5; i++) jobStore.create(makeJob());
    assert.equal(jobStore.list(3).length, 3);
  });

  test('returns all jobs when limit exceeds count', () => {
    clearStore();
    jobStore.create(makeJob());
    assert.equal(jobStore.list(100).length, 1);
  });
});
