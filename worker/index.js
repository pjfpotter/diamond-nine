// Cloudflare Worker + Durable Object implementation of live collaborative
// mode. This replaces the earlier PartyKit-based party/server.js: PartyKit
// is just a convenience wrapper around this exact same Cloudflare
// infrastructure (Workers + Durable Objects), and its CLI (last published
// 2025-05-21) has no support for the `new_sqlite_classes` migration
// Cloudflare now requires for any *new* Durable Object namespace (policy
// change 2026-07-09), making it impossible to deploy this feature to a
// fresh Cloudflare account through PartyKit at all. Deploying straight to
// Cloudflare via wrangler was always where this was going to end up
// running - this only changes which tool talks to Cloudflare, not where
// the room actually lives. See spec.md's "Live collaborative mode" section.
//
// All game logic below (last-write-wins moves, presence, reset/end,
// drag-position relay, cost-abuse defenses) is carried over unchanged from
// party/server.js - only the lifecycle it's attached to changed, from
// PartyKit's Party.Server shape (onConnect/onMessage/onClose,
// room.broadcast, room.getConnections) to Cloudflare's native Durable
// Object WebSocket API (fetch() handling the upgrade, server.accept(),
// 'message'/'close' event listeners, manual broadcast over tracked
// sessions). Connections are NOT hibernated (no acceptWebSocket/
// Hibernation API) - this keeps the port close to the original PartyKit
// behaviour (plain in-memory state, no serialized attachments to manage)
// and a live session's duration/scale (one classroom, up to an hour) gets
// no real benefit from hibernation's billing optimization anyway.
//
// A live session's room id is the task's own id (see tutor.js's
// showShareBlock) - one task, one room. The Worker's fetch() below parses
// that id straight out of the request URL (`/party/:roomId`) and routes to
// a same-named Durable Object; the Durable Object itself also keeps that
// id (this.roomId) so it can load the right task from the Express app.

const DEFAULT_API_BASE = 'http://localhost:3000';

const MAX_CONNECTIONS_PER_ROOM = 50; // generously above any real class size
const MESSAGE_WINDOW_MS = 1000;
const MAX_MESSAGES_PER_WINDOW = 30; // well above legitimate traffic (drag-move self-throttles to ~20/s client-side) - this is the server not trusting that self-throttling, since a non-browser client could ignore it entirely

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Matches "/party/:roomId" - the same path shape PartyKit used, kept
    // identical so live.js and test/concurrency.js only need their host
    // and port updated, not their URL scheme.
    const match = url.pathname.match(/^\/party\/([^/]+)\/?$/);
    if (!match) {
      return new Response('Not found', { status: 404 });
    }
    const roomId = decodeURIComponent(match[1]);
    const id = env.ROOMS.idFromName(roomId);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  },
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.apiBase = env.API_BASE || DEFAULT_API_BASE;
    this.roomId = null;
    this.title = '';
    this.instructions = '';
    this.cards = [];
    this.slotAssignment = new Array(9).fill(null);
    this.pool = [];
    this.ended = false;
    // ws -> { id, name }. Each connection gets a random id at accept time
    // (PartyKit gave every connection a stable .id; Cloudflare's raw
    // WebSocket objects don't have one, so this generates and tracks our
    // own, same role as PartyKit's connection.id).
    this.sessions = new Map();
    // cardId -> connection id currently dragging it. Soft claim only, not
    // a lock - see the longer explanation this had in party/server.js.
    // Correctness still comes entirely from handleMove()'s last-write-wins
    // behaviour regardless of who's "claimed" what.
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
    // refuses every connection (see fetch()) - no fallback demo board for
    // an unrecognised id.
    this.validRoom = false;
  }

  // Runs once, the first time anyone connects to this room. Several
  // connections can arrive at once and all call this before the first load
  // has finished - they share the same in-flight promise and all wait for
  // it, rather than each checking a synchronous "already loading" flag and
  // moving on before validRoom has actually been set (that race was real -
  // see party/server.js's history for how it was found and fixed).
  ensureLoaded() {
    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }
    return this.loadPromise;
  }

  async load() {
    try {
      const res = await fetch(`${this.apiBase}/api/sets/${encodeURIComponent(this.roomId)}`);
      if (res.ok) {
        const data = await res.json();
        this.title = data.title || '';
        this.instructions = data.instructions || '';
        // Same id scheme app.js's boot() uses for the async solo board
        // (`card-${i}`) - kept identical on purpose, since End session
        // saves results through the exact same /results endpoint that
        // code already writes to.
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
      names: Array.from(this.sessions.values()).map((s) => s.name).filter((n) => n.trim()),
    };
  }

  // Sends `payload` (already an object, not a string) to every connected
  // session except any ids listed in `excludeIds`. Equivalent to PartyKit's
  // room.broadcast(message, [excludeId]).
  broadcast(payload, excludeIds = []) {
    const json = JSON.stringify(payload);
    for (const [ws, session] of this.sessions) {
      if (excludeIds.includes(session.id)) continue;
      try {
        ws.send(json);
      } catch (err) {
        // A dead socket that hasn't fired 'close' yet - ignore, close
        // handling will clean it up.
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/party\/([^/]+)\/?$/);
    if (this.roomId === null) this.roomId = decodeURIComponent(match[1]);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    await this.ensureLoaded();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (!this.validRoom) {
      // Refuse before doing anything else - cheap rejection, no room
      // state ever gets created for an id nobody ever saved a task under.
      server.accept();
      server.close(4004, 'Unknown session');
      return new Response(null, { status: 101, webSocket: client });
    }

    if (this.sessions.size >= MAX_CONNECTIONS_PER_ROOM) {
      server.accept();
      server.close(4029, 'This session is full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const connectionId = crypto.randomUUID();
    server.accept();
    this.sessions.set(server, { id: connectionId, name: '' });

    server.send(JSON.stringify(this.currentState()));
    server.send(JSON.stringify(this.presenceMessage()));

    server.addEventListener('message', (event) => {
      this.onMessage(event.data, server, connectionId);
    });
    server.addEventListener('close', () => {
      this.onClose(server, connectionId);
    });
    server.addEventListener('error', () => {
      this.onClose(server, connectionId);
    });

    return new Response(null, { status: 101, webSocket: client });
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

  onClose(ws, connectionId) {
    this.messageTimestamps.delete(connectionId);
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (session && session.name.trim()) {
      this.broadcast(this.presenceMessage());
    }
    // If this connection dropped mid-drag, nobody will ever send the
    // matching drag-end - release its claims now and tell everyone else to
    // drop the ghost/dimmed state, rather than leaving a card looking
    // permanently claimed by someone who's already gone.
    for (const [cardId, draggerId] of this.draggedBy) {
      if (draggerId === connectionId) {
        this.draggedBy.delete(cardId);
        this.broadcast({ type: 'drag-end', cardId });
      }
    }
  }

  async onMessage(message, ws, connectionId) {
    if (!this.allowMessage(connectionId)) return; // over the rate limit - drop silently
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      return;
    }
    const sender = { id: connectionId, ws };
    if (data.type === 'join') {
      const session = this.sessions.get(ws);
      if (session) session.name = String(data.name || '').slice(0, 200);
      this.broadcast(this.presenceMessage());
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
  // drag positions as part of the real board state. They exist purely so
  // other browsers can draw a ghost card; the authoritative move still
  // only ever happens through the existing 'move' message and handleMove().
  handleDragStart(cardId, sender) {
    if (this.ended) return;
    this.draggedBy.set(cardId, sender.id);
    const session = this.sessions.get(sender.ws);
    const name = (session && session.name) || '';
    this.broadcast({ type: 'drag-start', cardId, name }, [sender.id]);
  }

  handleDragMove(cardId, xPct, yPct, sender) {
    if (this.ended) return;
    this.broadcast({ type: 'drag-move', cardId, xPct, yPct }, [sender.id]);
  }

  handleDragEnd(cardId, sender) {
    // Only clear the claim if it actually still belongs to this sender -
    // otherwise a stray late drag-end from a previous drag could cancel
    // someone else's claim on the same card.
    if (this.draggedBy.get(cardId) === sender.id) {
      this.draggedBy.delete(cardId);
    }
    this.broadcast({ type: 'drag-end', cardId }, [sender.id]);
  }

  // Asks the real Express app whether this token actually belongs to a
  // tutor, the same way every other tutor-only action in this app is
  // checked (see server.js's requireTutor).
  async verifyTutor(token) {
    if (!token) return false;
    try {
      const res = await fetch(`${this.apiBase}/api/tutor/sets`, {
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
    this.broadcast(this.currentState());
  }

  async endSession() {
    if (this.ended) return;
    this.ended = true;
    this.broadcast(this.currentState());

    // Persist the session's final shared arrangement through the exact
    // same public endpoint a solo student's submission already goes
    // through.
    const arrangement = {};
    this.slotAssignment.forEach((cardId, i) => {
      arrangement[i] = cardId;
    });
    const names = Array.from(this.sessions.values()).map((s) => s.name).filter((n) => n.trim());
    // The /results endpoint caps student_name at 200 characters - truncate
    // here too, since fetch() does NOT throw on a 4xx response: an
    // over-length name would otherwise fail this save completely and
    // silently.
    const studentName = (names.length ? names.join(', ') : 'Live group session').slice(0, 200);

    try {
      const res = await fetch(`${this.apiBase}/api/sets/${encodeURIComponent(this.roomId)}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_name: studentName, arrangement }),
      });
      if (!res.ok) {
        console.error('Failed to save live session result:', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
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

    this.broadcast(this.currentState());
  }
}
