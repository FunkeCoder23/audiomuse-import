// End-to-end: runs the CLI against a fake AudioMuse /api/sync and a throwaway
// library.db shaped like SUB/WAVE's `tracks` table. The column set below is the
// subset this tool touches, copied from SUB/WAVE's schema (v16+), including the
// GENERATED `genre` column that rejects writes.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const IMPORT = fileURLToPath(new URL('./import.mjs', import.meta.url));

const TRACKS = [
  { id: 'tagged', title: 'One', author: 'A', tempo: 120.5, key: 'A', scale: 'minor', energy: 0.12,
    mood_vector: 'rock:0.9,happy:0.6', other_features: 'danceable:0.7' },
  { id: 'bare', title: 'Two', author: 'B', tempo: 90, key: 'C', scale: 'major', energy: 0.02,
    mood_vector: 'jazz:0.8,mellow:0.5', other_features: '' },
  { id: 'new', title: 'Three', author: 'C', album: 'X', year: 2010, tempo: 128, key: 'F#',
    scale: 'major', energy: 0.08, mood_vector: 'electronic:0.7,party:0.5', other_features: '' },
  { id: 'silent', title: 'Four', author: 'D', tempo: 0, mood_vector: '', other_features: '' },
];

let server;
let url;
let providerType = 'navidrome';
let dir;

before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/api/sync') {
      res.writeHead(404);
      return res.end();
    }
    // Two pages, so paging is exercised.
    const page = Number(u.searchParams.get('page') || 1);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      provider_type: providerType,
      tracks: page === 1 ? TRACKS.slice(0, 2) : TRACKS.slice(2),
      has_more: page === 1,
      next_page: page + 1,
    }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
  dir = mkdtempSync(join(tmpdir(), 'audiomuse-import-'));
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

let dbCount = 0;
function makeDb({ userVersion = 16 } = {}) {
  const path = join(dir, `library-${dbCount++}.db`);
  const db = new Database(path);
  db.exec(`
    CREATE TABLE tracks (
      id               TEXT PRIMARY KEY,
      title            TEXT,
      artist           TEXT,
      album            TEXT,
      year             INTEGER,
      genres           TEXT,
      genre            TEXT GENERATED ALWAYS AS (json_extract(genres, '$[0]')) VIRTUAL,
      moods            TEXT,
      energy           TEXT CHECK (energy IN ('low','medium','high') OR energy IS NULL),
      source           TEXT,
      tagger_version   INTEGER,
      tagged_at        TEXT,
      bpm              REAL,
      musical_key      TEXT,
      analysis_version INTEGER
    );
  `);
  db.pragma(`user_version = ${userVersion}`);
  db.prepare(`INSERT INTO tracks (id, title, artist, genres, moods, tagger_version)
              VALUES ('tagged', 'One', 'A', '["Shoegaze"]', '["calm"]', 3)`).run();
  db.prepare(`INSERT INTO tracks (id, title, artist) VALUES ('bare', 'Two', 'B')`).run();
  db.close();
  return path;
}

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [IMPORT, ...args], (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

function rows(path) {
  const db = new Database(path, { readonly: true });
  const out = Object.fromEntries(
    db.prepare('SELECT * FROM tracks').all().map((r) => [r.id, r]),
  );
  db.close();
  return out;
}

test('dry run reports matches and writes nothing', async () => {
  const path = makeDb();
  const before = rows(path);
  const r = await run(['--audiomuse-url', url, '--library-db', path, '--dry-run']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /would update existing: 2/);
  assert.match(r.stdout, /would add as new:\s+1/);
  assert.match(r.stdout, /no usable signal:\s+1/);
  assert.deepEqual(rows(path), before);
});

test('fill-gaps import keeps existing tags and inserts unseen tracks', async () => {
  const path = makeDb();
  const r = await run(['--audiomuse-url', url, '--library-db', path]);
  assert.equal(r.code, 0, r.stderr);
  const t = rows(path);

  // Already tagged: moods and genre untouched, empty bpm/key filled.
  assert.equal(t.tagged.moods, '["calm"]');
  assert.equal(t.tagged.genre, 'Shoegaze');
  assert.equal(t.tagged.bpm, 120.5);
  assert.equal(t.tagged.musical_key, '8A');

  // Bare row: everything filled, genre via the genres array.
  assert.equal(t.bare.moods, '["calm"]');
  assert.equal(t.bare.energy, 'low');
  assert.equal(t.bare.genres, '["jazz"]');
  assert.equal(t.bare.genre, 'jazz');
  assert.equal(t.bare.source, 'manual');
  assert.equal(t.bare.tagger_version, 3);

  // Unseen track inserted; silent one skipped.
  assert.equal(t.new.title, 'Three');
  assert.equal(t.new.musical_key, '2B');
  assert.equal(t.new.genre, 'electronic');
  assert.equal(t.new.analysis_version, null);
  assert.equal(t.silent, undefined);
});

test('--overwrite replaces moods but still only fills an empty genre', async () => {
  const path = makeDb();
  const r = await run(['--audiomuse-url', url, '--library-db', path, '--overwrite']);
  assert.equal(r.code, 0, r.stderr);
  const t = rows(path);
  assert.equal(t.tagged.moods, '["celebratory"]');
  assert.equal(t.tagged.energy, 'high');
  assert.equal(t.tagged.genre, 'Shoegaze');
});

test('refuses a schema older than v16', async () => {
  const path = makeDb({ userVersion: 15 });
  const r = await run(['--audiomuse-url', url, '--library-db', path]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /schema is v15, need >= v16/);
});

test('refuses an AudioMuse that is not on navidrome', async () => {
  const path = makeDb();
  providerType = 'jellyfin';
  try {
    const r = await run(['--audiomuse-url', url, '--library-db', path]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /configured for 'jellyfin', not navidrome/);
  } finally {
    providerType = 'navidrome';
  }
});

test('missing library.db is a clear error', async () => {
  const r = await run(['--audiomuse-url', url, '--library-db', join(dir, 'nope.db')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /library\.db not found/);
});
