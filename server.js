// This is the backend: a small Node.js server using Express (handles HTTP
// requests/routing) and better-sqlite3 (talks to a SQLite database file on
// disk). Unlike app.js/tutor.js, there's no IIFE wrapper here - Node runs
// each file as its own module already, so top-level variables here don't
// leak into other files the way they would in a browser <script> tag.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');

// Allow the database file's location to be overridden via an environment
// variable (handy for tests, so they can point at a throwaway file instead
// of the real one) - falling back to a file next to this script otherwise.
const DB_PATH = process.env.DIAMOND9_DB || path.join(__dirname, 'diamond9.db');
const db = new Database(DB_PATH);
// WAL (Write-Ahead Logging) mode lets reads and writes happen concurrently
// without blocking each other as much as SQLite's default mode - a
// sensible default for a small server handling multiple requests at once.
db.pragma('journal_mode = WAL');

// Creates the three tables if they don't already exist yet (IF NOT
// EXISTS means this is safe to run every time the server starts, not just
// the first time - it won't wipe existing data).
db.exec(`
  CREATE TABLE IF NOT EXISTS tutors (
    token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sets (
    id TEXT PRIMARY KEY,
    tutor_token TEXT NOT NULL REFERENCES tutors(token),
    title TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    cards TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    set_id TEXT NOT NULL REFERENCES sets(id),
    student_name TEXT,
    arrangement TEXT NOT NULL,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
// Note: `cards` and `arrangement` are stored as TEXT, not as their own
// tables - each one is a small, self-contained blob of JSON
// (JSON.stringify'd before saving, JSON.parse'd after reading). For data
// this small and always read/written as a whole unit, a proper relational
// table per card would be more "correct" in theory but pure overhead here.

const app = express();
// Express "middleware" runs on every incoming request, in the order
// they're registered, before it reaches a specific route handler below.
app.use(express.json({ limit: '256kb' })); // parses JSON request bodies into req.body; rejects anything bigger than 256kb outright
app.use(express.static(path.join(__dirname, 'public'))); // serves index.html, tutor.html, app.js, style.css etc. directly as files

// Minimal in-memory per-IP rate limiter (no extra dependency) for the two
// unauthenticated-write endpoints most exposed to spam: minting tutor
// tokens and submitting results. Limits are generous - a school network
// can share one IP across a whole class - this is only meant to stop a
// script flooding thousands of requests, not to police normal use.
//
// This is a "middleware factory": rateLimit() itself isn't middleware, it
// *returns* a middleware function pre-configured with the windowMs/max you
// pass it, so the same logic can be reused with different limits on
// different routes (see its two call sites further down).
function rateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> array of request timestamps
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip;
    // Keep only timestamps from within the current window, then check if
    // that IP has already hit the limit inside it.
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'too many requests, please slow down' });
    }
    recent.push(now);
    hits.set(ip, recent);
    next(); // let the request continue on to the actual route handler
  };
}

// Generates a random URL-safe id string (used for both tutor tokens and
// set/result ids) - crypto.randomBytes is cryptographically secure random
// data, unlike Math.random(), which matters here because tutor tokens are
// effectively passwords: they need to be unguessable.
function newId() {
  return crypto.randomBytes(9).toString('base64url');
}

// Generic bounded-length string check, used for the free-text fields that
// don't have their own dedicated validator. Returns null when the value is
// fine, or an error message string when it isn't - every validate*
// function in this file follows that same convention, which is what lets
// them be chained together with || below (see validateCards's callers):
// the first one that returns a truthy (non-null) message "wins" and short-
// circuits the rest.
function validateTextLength(value, maxLen, label) {
  if (value === undefined || value === null) return null; // an omitted optional field isn't an error
  if (typeof value !== 'string') return `${label} must be text`;
  if (value.length > maxLen) return `${label} must be ${maxLen} characters or fewer`;
  return null;
}

// Cards are stored/returned as exactly {text} - any other attacker-supplied
// fields on a card object are dropped rather than stored or echoed back
// verbatim. (Cards used to also carry an optional image_url; the image
// feature was removed as a deliberate design decision - see spec.md.)
//
// This is "allowlisting": rather than trying to strip out anything
// dangerous from the client's data (a "denylist", which is easy to get
// wrong - you can always forget one dangerous field), we build a brand
// new object containing only the fields we explicitly expect. Whatever
// else the client sent along is simply never copied over.
function sanitizeCards(cards) {
  return cards.map((c) => ({ text: c.text }));
}

// A student's arrangement is a small, fixed-shape object: at most the nine
// slot indices "0".."8", each mapping to null or a short id string. Anything
// else (wrong type, extra keys, oversized values) is rejected rather than
// stored as an opaque blob.
function validateArrangement(arrangement) {
  if (!arrangement || typeof arrangement !== 'object' || Array.isArray(arrangement)) {
    return 'arrangement must be an object';
  }
  const keys = Object.keys(arrangement);
  if (keys.length > 9) return 'arrangement has too many entries';
  for (const key of keys) {
    // Every key must be exactly one digit 0-8 - this regex anchors both
    // ends (^ and $) so e.g. "0extra" or "10" can't sneak through.
    if (!/^[0-8]$/.test(key)) return `arrangement has an invalid position "${key}"`;
    const value = arrangement[key];
    if (value !== null && (typeof value !== 'string' || value.length > 50)) {
      return `arrangement position ${key} has an invalid value`;
    }
  }
  return null;
}

function validateCards(cards) {
  if (!Array.isArray(cards) || cards.length !== 9) {
    return 'cards must be an array of exactly 9 items';
  }
  for (const [i, card] of cards.entries()) {
    if (!card || typeof card !== 'object') return `card ${i} is invalid`;
    if (typeof card.text !== 'string') return `card ${i} is missing text`;
    if (card.text.length > 50) return `card ${i} text is too long`; // measured against the actual rendered card size - see spec.md
  }
  return null;
}

// Express middleware that guards the tutor-only endpoints. A route that
// lists this as a second argument (e.g. `app.get(path, requireTutor, ...)`)
// won't run its own handler at all unless this calls next() - if the
// token is missing or unrecognised, it sends an error response and stops
// there instead.
function requireTutor(req, res, next) {
  const token = req.header('X-Tutor-Token');
  if (!token) return res.status(401).json({ error: 'missing tutor token' });
  const row = db.prepare('SELECT token FROM tutors WHERE token = ?').get(token);
  if (!row) return res.status(401).json({ error: 'unknown tutor token' });
  req.tutorToken = token; // stash it on the request so the actual route handler doesn't need to look it up again
  next();
}
// Note on db.prepare(...).get(...): this is a "prepared statement" with a
// `?` placeholder - better-sqlite3 fills that in safely with the token
// value, rather than us building the SQL string by hand with string
// concatenation. Every query in this file uses placeholders (? or @name)
// the same way, which is what prevents SQL injection: user-supplied data
// is always passed as a parameter, never spliced directly into the SQL text.

// --- Routes ---
//
// Each app.METHOD(path, ...) call below registers one endpoint. Where a
// route needs auth, requireTutor is listed as middleware before the final
// handler function; public/student-facing routes skip it entirely.

// A tutor "logs in" by minting a capability token — no password, no account.
// Whoever holds the token (bookmarked dashboard link) can manage its sets.
app.post('/api/tutors', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), (req, res) => {
  const token = newId();
  db.prepare('INSERT INTO tutors (token) VALUES (?)').run(token);
  res.json({ token });
});

app.get('/api/tutor/sets', requireTutor, (req, res) => {
  const rows = db
    .prepare('SELECT id, title, updated_at FROM sets WHERE tutor_token = ? ORDER BY updated_at DESC')
    .all(req.tutorToken);
  res.json({ sets: rows });
});

app.post('/api/sets', requireTutor, (req, res) => {
  // Destructuring with defaults: if req.body.title is missing, `title`
  // becomes '' automatically, rather than undefined - and `req.body || {}`
  // means this whole line doesn't throw even if the client sent no body
  // at all.
  const { title = '', instructions = '', cards } = req.body || {};
  const error =
    validateTextLength(title, 200, 'title') ||
    validateTextLength(instructions, 1000, 'instructions') ||
    validateCards(cards);
  if (error) return res.status(400).json({ error });

  const id = newId();
  // The `@name` placeholders below are filled in from the object passed
  // to .run() - same safety property as `?` placeholders, just matched by
  // name instead of position, which reads more clearly with this many fields.
  db.prepare(
    `INSERT INTO sets (id, tutor_token, title, instructions, cards)
     VALUES (@id, @tutor_token, @title, @instructions, @cards)`
  ).run({
    id,
    tutor_token: req.tutorToken,
    title,
    instructions,
    cards: JSON.stringify(sanitizeCards(cards)), // sanitize *before* storing, never trust the client's raw JSON
  });

  res.status(201).json({ id }); // 201 Created is the conventional status for "a new resource now exists"
});

app.put('/api/sets/:id', requireTutor, (req, res) => {
  // :id in the route path becomes available as req.params.id.
  const existing = db.prepare('SELECT tutor_token FROM sets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'set not found' });
  // Even though requireTutor already confirmed the token is valid, it
  // doesn't confirm this token owns *this particular* set - a second
  // tutor could otherwise edit someone else's task just by guessing its id.
  if (existing.tutor_token !== req.tutorToken) return res.status(403).json({ error: 'not your set' });

  const { title = '', instructions = '', cards } = req.body || {};
  const error =
    validateTextLength(title, 200, 'title') ||
    validateTextLength(instructions, 1000, 'instructions') ||
    validateCards(cards);
  if (error) return res.status(400).json({ error });

  db.prepare(
    `UPDATE sets SET title = @title, instructions = @instructions,
       cards = @cards,
       updated_at = datetime('now')
     WHERE id = @id`
  ).run({
    id: req.params.id,
    title,
    instructions,
    cards: JSON.stringify(sanitizeCards(cards)),
  });

  res.json({ ok: true });
});

// db.transaction wraps several statements so they either all succeed or
// all roll back together - here, if deleting the results somehow failed,
// we wouldn't want to be left with the set itself already deleted (which
// would orphan any results still referencing it).
const deleteSetAndResults = db.transaction((id) => {
  db.prepare('DELETE FROM results WHERE set_id = ?').run(id);
  db.prepare('DELETE FROM sets WHERE id = ?').run(id);
});

app.delete('/api/sets/:id', requireTutor, (req, res) => {
  const existing = db.prepare('SELECT tutor_token FROM sets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'set not found' });
  if (existing.tutor_token !== req.tutorToken) return res.status(403).json({ error: 'not your set' });

  deleteSetAndResults(req.params.id);
  res.json({ ok: true });
});

// Student-facing: no auth, just the set id from the shared link. Anyone
// with the link can view (but not edit) the task - that's the whole point
// of a shareable link.
app.get('/api/sets/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'set not found' });
  // Deliberately hand-picking which columns to send back, rather than
  // `res.json(row)` directly - this is the same allowlisting idea as
  // sanitizeCards() above, so an internal-only column added to the table
  // later doesn't automatically start leaking to students without anyone
  // noticing.
  res.json({
    id: row.id,
    title: row.title,
    instructions: row.instructions,
    cards: JSON.parse(row.cards),
  });
});

app.post('/api/sets/:id/results', rateLimit({ windowMs: 10 * 60 * 1000, max: 120 }), (req, res) => {
  const set = db.prepare('SELECT id FROM sets WHERE id = ?').get(req.params.id);
  if (!set) return res.status(404).json({ error: 'set not found' });

  const { student_name, arrangement } = req.body || {};
  const arrangementError = validateArrangement(arrangement);
  if (arrangementError) return res.status(400).json({ error: arrangementError });
  if (typeof student_name !== 'undefined' && student_name !== null) {
    if (typeof student_name !== 'string' || student_name.length > 200) {
      return res.status(400).json({ error: 'invalid student_name' });
    }
  }

  const id = newId();
  db.prepare(
    'INSERT INTO results (id, set_id, student_name, arrangement) VALUES (?, ?, ?, ?)'
  ).run(id, req.params.id, student_name || null, JSON.stringify(arrangement));

  res.status(201).json({ id });
});

app.get('/api/sets/:id/results', requireTutor, (req, res) => {
  const set = db.prepare('SELECT tutor_token FROM sets WHERE id = ?').get(req.params.id);
  if (!set) return res.status(404).json({ error: 'set not found' });
  if (set.tutor_token !== req.tutorToken) return res.status(403).json({ error: 'not your set' });

  const rows = db
    .prepare('SELECT id, student_name, arrangement, submitted_at FROM results WHERE set_id = ? ORDER BY submitted_at DESC')
    .all(req.params.id);
  res.json({
    // `...r` spreads all of the row's existing fields into a new object,
    // then `arrangement: ...` immediately after overwrites just that one
    // field with its parsed-from-JSON version - the row from SQLite has
    // arrangement as a raw JSON string, but API consumers want a real object.
    results: rows.map((r) => ({ ...r, arrangement: JSON.parse(r.arrangement) })),
  });
});

// Catch-all error handler: malformed JSON bodies, oversized payloads, and
// any unexpected error all land here. Express's own default handler would
// otherwise return an HTML page with the exception's stack trace and file
// paths - always respond with plain JSON and no internal details instead.
//
// Express recognises this as an *error* handler specifically because it
// takes four arguments (err, req, res, next) instead of the usual three -
// that's not just a style choice, Express inspects the function's arity
// (arguments.length) to decide which middleware are error handlers.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err); // a response already started sending - too late to send a different one
  const status = err.status || err.statusCode || 500;
  if (status === 413) {
    return res.status(413).json({ error: 'request body too large' });
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'malformed JSON body' });
  }
  console.error(err); // log the real error server-side for debugging...
  res.status(status < 500 ? status : 500).json({ error: 'internal server error' }); // ...but never expose its details to the client
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Diamond Nine running at http://localhost:${PORT}`);
});
