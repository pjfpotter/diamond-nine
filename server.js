const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DIAMOND9_DB || path.join(__dirname, 'diamond9.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

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

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Minimal in-memory per-IP rate limiter (no extra dependency) for the two
// unauthenticated-write endpoints most exposed to spam: minting tutor
// tokens and submitting results. Limits are generous - a school network
// can share one IP across a whole class - this is only meant to stop a
// script flooding thousands of requests, not to police normal use.
function rateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> array of request timestamps
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip;
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'too many requests, please slow down' });
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}

function newId() {
  return crypto.randomBytes(9).toString('base64url');
}

// Generic bounded-length string check, used for the free-text fields that
// don't have their own dedicated validator.
function validateTextLength(value, maxLen, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return `${label} must be text`;
  if (value.length > maxLen) return `${label} must be ${maxLen} characters or fewer`;
  return null;
}

// Cards are stored/returned as exactly {text} - any other attacker-supplied
// fields on a card object are dropped rather than stored or echoed back
// verbatim. (Cards used to also carry an optional image_url; the image
// feature was removed as a deliberate design decision - see spec.md.)
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
    if (card.text.length > 50) return `card ${i} text is too long`;
  }
  return null;
}

function requireTutor(req, res, next) {
  const token = req.header('X-Tutor-Token');
  if (!token) return res.status(401).json({ error: 'missing tutor token' });
  const row = db.prepare('SELECT token FROM tutors WHERE token = ?').get(token);
  if (!row) return res.status(401).json({ error: 'unknown tutor token' });
  req.tutorToken = token;
  next();
}

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
  const { title = '', instructions = '', cards } = req.body || {};
  const error =
    validateTextLength(title, 200, 'title') ||
    validateTextLength(instructions, 1000, 'instructions') ||
    validateCards(cards);
  if (error) return res.status(400).json({ error });

  const id = newId();
  db.prepare(
    `INSERT INTO sets (id, tutor_token, title, instructions, cards)
     VALUES (@id, @tutor_token, @title, @instructions, @cards)`
  ).run({
    id,
    tutor_token: req.tutorToken,
    title,
    instructions,
    cards: JSON.stringify(sanitizeCards(cards)),
  });

  res.status(201).json({ id });
});

app.put('/api/sets/:id', requireTutor, (req, res) => {
  const existing = db.prepare('SELECT tutor_token FROM sets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'set not found' });
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

// Student-facing: no auth, just the set id from the shared link.
app.get('/api/sets/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'set not found' });
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
    results: rows.map((r) => ({ ...r, arrangement: JSON.parse(r.arrangement) })),
  });
});

// Catch-all error handler: malformed JSON bodies, oversized payloads, and
// any unexpected error all land here. Express's own default handler would
// otherwise return an HTML page with the exception's stack trace and file
// paths - always respond with plain JSON and no internal details instead.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status === 413) {
    return res.status(413).json({ error: 'request body too large' });
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'malformed JSON body' });
  }
  console.error(err);
  res.status(status < 500 ? status : 500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Diamond Nine running at http://localhost:${PORT}`);
});
