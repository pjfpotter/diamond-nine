// STAGE 3 + the "visible live dragging" stretch goal: real task data,
// presence, tutor moderation (Reset/End), and relaying in-progress drag
// positions so everyone can see a card moving before it's dropped, not
// just after. See spec.md's "Live collaborative mode" section for the
// full design of both.
//
// A live session's room id is just the task's own id (see tutor.js's
// showShareBlock) - one task, one room, kept simple rather than minting
// and tracking a separate session id. This file treats `room.id` (the
// PartyKit room id from the URL) as that task id directly.
//
// This server talks back to the existing Express app over plain HTTP for
// three things it deliberately does NOT reimplement itself: loading the
// task's real cards/title/instructions, checking whether a given tutor
// token is genuinely valid before honouring a Reset/End request, and
// saving the session's final arrangement as an ordinary result row. All
// three already exist and are already tested - there's no reason for this
// file to keep its own copy of that logic.
//
// NOTE: this hardcodes the Express app's local dev address. Once this is
// actually deployed (PartyKit's servers, talking to wherever the real
// Express app ends up hosted), this needs to become a real configured
// URL instead - flagged here deliberately rather than solved now, since
// it depends on hosting decisions not yet made.
const API_BASE = 'http://localhost:3000';

// Cost-abuse defenses. A Durable Object is billed by connection-time and
// message volume, so the two shapes worth defending against are: a single
// legitimate link going viral (capped by MAX_CONNECTIONS_PER_ROOM below),
// and something cheaper and sneakier - spinning up endless *different*
// rooms, each a fresh billable Durable Object, by hitting made-up room
// ids. The second one used to be free to do here, because an unrecognised
// room id silently got a working demo board (see the old FALLBACK_CARDS,
// removed) rather than being refused. See spec.md's cost-defense notes.
const MAX_CONNECTIONS_PER_ROOM = 50; // generously above any real class size
const MESSAGE_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 30; // well above legitimate traffic (drag-move self-throttles to ~20/s client-side) - this is the server not trusting that self-throttling, since a non-browser client could ignore it entirely

export default class Server {
  constructor(room) {
    this.room = room;
    this.title = '';
    this.instructions = '';
    this.cards = [];
    this.slotAssignment = new Array(9).fill(null);
    this.pool = [];
    this.ended = false;
    // connection id -> display name (or '' if they skipped naming
    // themselves). This only ever lives in memory for as long as the room
    // does - nothing here is the persistent record of who took part; that
    // happens once, at End session, as a single row in the real results
    // table (see endSession()).
    this.presentNames = new Map();
    // cardId -> the connection id currently dragging it. This is a soft
    // claim, not a real lock: it only drives a dimmed visual on everyone
    // else's screen (see live.js), never blocks a move from actually
    // happening. A real lock would risk a card stuck permanently claimed
    // by a connection that dropped mid-drag (no matching drag-end ever
    // arrives) - correctness still comes entirely from handleMove()'s
    // existing last-write-wins behaviour regardless of who's "claimed"
    // what, so there's nothing for a hard lock to actually protect.
    this.draggedBy = new Map();
    // connection id -> timestamps of its recent messages, for the
    // per-connection message rate limit (see allowMessage below).
    this.messageTimestamps = new Map();
    // Loaded lazily on the first connection rather than in the
    // constructor, because loading real task data is asynchronous (an
    // HTTP call) and a constructor can't be awaited. See ensureLoaded().
    this.loadPromise = null;
    // Set once ensureLoaded() has actually confirmed this room id
    // corresponds to a real saved task. A room that never becomes valid
    // refuses every connection (see onConnect) - no fallback demo board
    // for an unrecognised id. That used to exist for local ad-hoc testing
    // convenience, but it also meant any made-up room id got a fully
    // working, billable room for free; create a real test task instead
    // (the tutor flow already makes this quick) rather than typing a
    // random room name into the URL.
    this.validRoom = false;
  }

  // Runs once, the first time anyone connects to this room. Tries to load
  // the real task this room is for; a room whose id doesn't match any
  // real task is left invalid, and onConnect refuses every connection to
  // it rather than silently standing up a working board for a made-up id.
  //
  // Several connections can arrive at once (e.g. several students opening
  // the link within the same second) and all call this before the first
  // load has finished - they need to share the *same* in-flight request
  // and all wait for it, rather than each checking a synchronous "already
  // loading" flag and moving on before validRoom has actually been set.
  // That race was real: it caused later-arriving concurrent connections to
  // see loaded-but-not-yet-valid and get wrongly rejected as "unknown
  // session" even though the room was perfectly real.
  ensureLoaded() {
    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }
    return this.loadPromise;
  }

  async load() {
    try {
      const res = await fetch(`${API_BASE}/api/sets/${encodeURIComponent(this.room.id)}`);
      if (res.ok) {
        const data = await res.json();
        this.title = data.title || '';
        this.instructions = data.instructions || '';
        // Same id scheme app.js's boot() uses for the async solo board
        // (`card-${i}`) - kept identical on purpose, since End session
        // saves results through the exact same /results endpoint that
        // code already writes to, and that endpoint's reader (tutor.js's
        // renderResults) expects ids in this shape to look the card back up.
        this.cards = data.cards.map((c, i) => ({ id: `card-${i}`, text: c.text }));
        this.pool = this.cards.map((c) => c.id);
        this.validRoom = true;
      }
    } catch (err) {
      // Leave validRoom false - e.g. the Express app isn't reachable.
    }
  }

  currentState() {
    return {
      type: 'state',
      title: this.title,
      instructions: this.instructions,
      cards: this.cards,
      slotAssignment: this.slotAssignment,
      pool: this.pool,
      ended: this.ended,
    };
  }

  presenceMessage() {
    return {
      type: 'presence',
      names: Array.from(this.presentNames.values()).filter((n) => n.trim()),
    };
  }

  async onConnect(connection) {
    await this.ensureLoaded();
    if (!this.validRoom) {
      // Refuse before doing anything else - cheap rejection, no room
      // state ever gets created for an id nobody ever saved a task under.
      connection.close(4004, 'Unknown session');
      return;
    }

    // PartyKit adds a connection to the room before calling onConnect, so
    // this count already includes the one that just arrived - up to
    // MAX_CONNECTIONS_PER_ROOM are accepted, the next one is refused.
    const activeConnections = [...this.room.getConnections()].length;
    if (activeConnections > MAX_CONNECTIONS_PER_ROOM) {
      connection.close(4029, 'This session is full');
      return;
    }

    connection.send(JSON.stringify(this.currentState()));
    connection.send(JSON.stringify(this.presenceMessage()));
  }

  // Simple fixed-window rate limit, independent of anything the client
  // claims to be doing - a non-browser client ignoring live.js's own
  // throttling entirely is exactly what this guards against.
  allowMessage(connectionId) {
    const now = Date.now();
    const recent = (this.messageTimestamps.get(connectionId) || []).filter(
      (t) => now - t < MESSAGE_WINDOW_MS
    );
    if (recent.length >= MAX_MESSAGES_PER_WINDOW) return false;
    recent.push(now);
    this.messageTimestamps.set(connectionId, recent);
    return true;
  }

  onClose(connection) {
    this.messageTimestamps.delete(connection.id);
    if (this.presentNames.delete(connection.id)) {
      this.room.broadcast(JSON.stringify(this.presenceMessage()));
    }
    // If this connection dropped mid-drag (exactly Stage 4's Scenario C,
    // but for a drag instead of a completed move), nobody will ever send
    // the matching drag-end - release its claims now and tell everyone
    // else to drop the ghost/dimmed state, rather than leaving a card
    // looking permanently claimed by someone who's already gone.
    for (const [cardId, draggerId] of this.draggedBy) {
      if (draggerId === connection.id) {
        this.draggedBy.delete(cardId);
        this.room.broadcast(JSON.stringify({ type: 'drag-end', cardId }));
      }
    }
  }

  async onMessage(message, sender) {
    if (!this.allowMessage(sender.id)) return; // over the rate limit - drop silently, no need to tell a flooding client anything
    const data = JSON.parse(message);
    if (data.type === 'join') {
      this.presentNames.set(sender.id, String(data.name || '').slice(0, 200));
      this.room.broadcast(JSON.stringify(this.presenceMessage()));
    } else if (data.type === 'move') {
      this.handleMove(data.cardId, data.target);
    } else if (data.type === 'reset') {
      if (await this.verifyTutor(data.token)) this.resetBoard();
    } else if (data.type === 'end') {
      if (await this.verifyTutor(data.token)) await this.endSession();
    } else if (data.type === 'drag-start') {
      this.handleDragStart(data.cardId, sender);
    } else if (data.type === 'drag-move') {
      this.handleDragMove(data.cardId, data.xPct, data.yPct, sender);
    } else if (data.type === 'drag-end') {
      this.handleDragEnd(data.cardId, sender);
    }
  }

  // These three are pure relays - this server never validates or stores
  // drag positions as part of the real board state (this.slotAssignment/
  // this.pool are untouched by any of them). They exist purely so other
  // browsers can draw a ghost card; the authoritative move still only
  // ever happens through the existing 'move' message and handleMove().
  handleDragStart(cardId, sender) {
    if (this.ended) return;
    this.draggedBy.set(cardId, sender.id);
    const name = this.presentNames.get(sender.id) || '';
    // Excludes the sender ([sender.id]) - you don't need to see your own
    // ghost, you can already see the real card following your own cursor.
    this.room.broadcast(JSON.stringify({ type: 'drag-start', cardId, name }), [sender.id]);
  }

  handleDragMove(cardId, xPct, yPct, sender) {
    if (this.ended) return;
    this.room.broadcast(
      JSON.stringify({ type: 'drag-move', cardId, xPct, yPct }),
      [sender.id]
    );
  }

  handleDragEnd(cardId, sender) {
    // Only clear the claim if it actually still belongs to this sender -
    // otherwise a stray late drag-end from a previous drag could cancel
    // someone else's claim on the same card.
    if (this.draggedBy.get(cardId) === sender.id) {
      this.draggedBy.delete(cardId);
    }
    this.room.broadcast(JSON.stringify({ type: 'drag-end', cardId }), [sender.id]);
  }

  // Asks the real Express app whether this token actually belongs to a
  // tutor, the same way every other tutor-only action in this app is
  // checked (see server.js's requireTutor). Without this, anyone who
  // guessed or was handed a student link could reset or end the session
  // themselves - this is the one place this file deliberately duplicates
  // a trust decision rather than just hoping the client is well-behaved.
  async verifyTutor(token) {
    if (!token) return false;
    try {
      const res = await fetch(`${API_BASE}/api/tutor/sets`, {
        headers: { 'X-Tutor-Token': token },
      });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  resetBoard() {
    if (this.ended) return;
    this.slotAssignment = new Array(9).fill(null);
    this.pool = this.cards.map((c) => c.id);
    this.room.broadcast(JSON.stringify(this.currentState()));
  }

  async endSession() {
    if (this.ended) return;
    this.ended = true;
    this.room.broadcast(JSON.stringify(this.currentState()));

    // Persist the session's final shared arrangement through the exact
    // same public endpoint a solo student's submission already goes
    // through - it doesn't know or care whether the arrangement came from
    // one student or a live group, it's the same shape either way.
    const arrangement = {};
    this.slotAssignment.forEach((cardId, i) => {
      arrangement[i] = cardId;
    });
    const names = Array.from(this.presentNames.values()).filter((n) => n.trim());
    // The /results endpoint this is about to call caps student_name at
    // 200 characters (same rule the solo async flow already follows) -
    // truncate here too, since a handful of participants with real names
    // easily joins into something longer than that, and fetch() does NOT
    // throw on a 4xx response: an over-length name would otherwise fail
    // this save completely and silently, with nothing anywhere to show
    // for it.
    const studentName = (names.length ? names.join(', ') : 'Live group session').slice(0, 200);

    try {
      const res = await fetch(`${API_BASE}/api/sets/${encodeURIComponent(this.room.id)}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_name: studentName, arrangement }),
      });
      if (!res.ok) {
        // fetch() only rejects on network-level failures, never on an
        // HTTP error status - without this check, a rejected save (e.g. a
        // future validation rule this code doesn't know about) would be
        // indistinguishable from a successful one.
        console.error('Failed to save live session result:', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      // If saving fails (e.g. Express app not reachable), the live
      // session still ended from every connected browser's point of view
      // - there's just no record of it afterwards. Nothing left in this
      // room to retry with once everyone's disconnected, so this is
      // logged and left there rather than failing the end action itself.
      console.error('Failed to save live session result:', err);
    }
  }

  handleMove(cardId, target) {
    if (this.ended) return; // frozen - no further moves once a session has ended
    const fromSlot = this.slotAssignment.indexOf(cardId);
    const fromPool = this.pool.includes(cardId);

    let displaced = null;
    if (target === 'pool') {
      displaced = null;
    } else {
      displaced = this.slotAssignment[target];
      if (displaced === cardId) return;
    }

    if (fromSlot !== -1) this.slotAssignment[fromSlot] = null;
    if (fromPool) this.pool = this.pool.filter((id) => id !== cardId);

    if (target === 'pool') {
      this.pool.push(cardId);
    } else {
      this.slotAssignment[target] = cardId;
      if (displaced) {
        if (fromSlot !== -1) {
          this.slotAssignment[fromSlot] = displaced;
        } else {
          this.pool.push(displaced);
        }
      }
    }

    this.room.broadcast(JSON.stringify(this.currentState()));
  }
}
