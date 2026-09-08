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
    font TEXT NOT NULL DEFAULT 'atkinson-hyperlegible',
    font_size TEXT NOT NULL DEFAULT 'medium',
    colour_scheme TEXT NOT NULL DEFAULT 'cream-navy',
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

function newId() {
  return crypto.randomBytes(9).toString('base64url');
}

// Only http(s) image URLs are ever stored or rendered — blocks javascript:,
// data:, file:, etc. from sneaking into a card via the image field.
function isSafeImageUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return true; // optional field
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateCards(cards) {
  if (!Array.isArray(cards) || cards.length !== 9) {
    return 'cards must be an array of exactly 9 items';
  }
  for (const [i, card] of cards.entries()) {
    if (!card || typeof card !== 'object') return `card ${i} is invalid`;
    if (typeof card.text !== 'string') return `card ${i} is missing text`;
    if (card.text.length > 500) return `card ${i} text is too long`;
    if (!isSafeImageUrl(card.image_url)) return `card ${i} has an invalid image URL (only http/https allowed)`;
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
app.post('/api/tutors', (req, res) => {
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
  const { title = '', instructions = '', font, font_size, colour_scheme, cards } = req.body || {};
  const error = validateCards(cards);
  if (error) return res.status(400).json({ error });

  const id = newId();
  db.prepare(
    `INSERT INTO sets (id, tutor_token, title, instructions, font, font_size, colour_scheme, cards)
     VALUES (@id, @tutor_token, @title, @instructions,
       COALESCE(@font, 'atkinson-hyperlegible'),
       COALESCE(@font_size, 'medium'),
       COALESCE(@colour_scheme, 'cream-navy'),
       @cards)`
  ).run({
    id,
    tutor_token: req.tutorToken,
    title,
    instructions,
    font: font || null,
    font_size: font_size || null,
    colour_scheme: colour_scheme || null,
    cards: JSON.stringify(cards),
  });

  res.status(201).json({ id });
});

app.put('/api/sets/:id', requireTutor, (req, res) => {
  const existing = db.prepare('SELECT tutor_token FROM sets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'set not found' });
  if (existing.tutor_token !== req.tutorToken) return res.status(403).json({ error: 'not your set' });

  const { title = '', instructions = '', font, font_size, colour_scheme, cards } = req.body || {};
  const error = validateCards(cards);
  if (error) return res.status(400).json({ error });

  db.prepare(
    `UPDATE sets SET title = @title, instructions = @instructions,
       font = COALESCE(@font, font),
       font_size = COALESCE(@font_size, font_size),
       colour_scheme = COALESCE(@colour_scheme, colour_scheme),
       cards = @cards,
       updated_at = datetime('now')
     WHERE id = @id`
  ).run({
    id: req.params.id,
    title,
    instructions,
    font: font || null,
    font_size: font_size || null,
    colour_scheme: colour_scheme || null,
    cards: JSON.stringify(cards),
  });

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
    font: row.font,
    font_size: row.font_size,
    colour_scheme: row.colour_scheme,
    cards: JSON.parse(row.cards),
  });
});

app.post('/api/sets/:id/results', (req, res) => {
  const set = db.prepare('SELECT id FROM sets WHERE id = ?').get(req.params.id);
  if (!set) return res.status(404).json({ error: 'set not found' });

  const { student_name, arrangement } = req.body || {};
  if (!arrangement || typeof arrangement !== 'object') {
    return res.status(400).json({ error: 'arrangement is required' });
  }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Diamond Nine running at http://localhost:${PORT}`);
});
