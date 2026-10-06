# Diamond Nine — Spec

## What this is

A lightweight web app that lets an online tutor set up a diamond nine card sort task and share it with a student via a link. The student ranks the cards; the tutor gets the result.

## Why a diamond nine (pedagogical rationale)

A diamond nine is a ranking activity: nine items (statements, causes, values, images) are arranged into a diamond — one at the top (most important/agreed with), two below it, three across the middle, two below that, one at the bottom (least important). Unlike a simple list, the forced shape means only one item can be "most important" and the middle row has three roughly-equal slots, which pushes people to make and defend genuinely difficult calls rather than produce a flat ranking with no real thought behind it.

It's used across PSHE, RE, and other values-based or evaluative subjects because it:
- Forces evaluation and justification, not just recall — the student has to decide *why* one thing outranks another
- Surfaces personal values and assumptions the student may not have articulated before
- Works well for paired/group debate — disagreement about the middle row is often where the real discussion happens
- Gives a visual, shareable artifact of someone's reasoning at a point in time

Known failure mode: it gets stale with overuse, so this tool should be quick to reconfigure with new content rather than encouraging one template reused indefinitely.

## Users

- **Tutor**: creates card sets, configures appearance/accessibility options, generates a shareable link, reviews submitted results, can save sets for reuse.
- **Student**: opens a link, no login. Reads instructions/title, drags nine cards into the diamond, can rearrange freely until happy, then submits.

## Tutor-side features

- Dashboard listing the tutor's saved sets
- Create/edit a set:
  - Title — optional, not forced. Tutors running this live may not want one
    on screen at all; if left blank, the student view shows no title rather
    than a generic placeholder standing in for it.
  - Instructions text (the prompt/question framing the sort)
  - Nine cards, text only, up to 50 characters each - measured directly
    against the rendered card size (2026-09-30), not guessed: pool cards
    wrap at ~27 characters per line before it looks bad, and a placed
    diamond card (fixed-size, 5-line clamp) only has room for ~50-64
    characters depending on word length before text gets cut off. Images
    were considered and deliberately dropped (2026-09-30 decision, do not
    re-add without discussion): they don't suit the sticky-note visual
    design, and aren't typically used in real diamond nine tasks anyway.
- Generate a shareable link per set
- Save sets for reuse across students/sessions
- View submitted results per link (which student, if named, and their final arrangement)
- **QR code for a live session's link** (2026-10-06): a "Show QR code"
  button next to the live session's student link opens a dedicated page
  (`qr.html`) in a new tab/window - just the Diamond Nine brand, the
  task's title, and one large scannable code, meant to be put up on a
  projector so a whole room can scan it at once rather than everyone
  typing a URL. The QR image itself is rendered server-side
  (`GET /api/qr`, using the `qrcode` package) rather than client-side,
  deliberately restricted to links on this app's own origin - without
  that check it would double as a free, open "turn any text into a QR
  code" image service for anyone who found the endpoint, for no benefit
  to this app. Rate-limited the same way the other unauthenticated
  endpoints already are.

## Diamond geometry (locked rule — do not re-litigate)

The 1-2-3-2-1 rows must be tightly packed and centered so the overall shape
reads unambiguously as a diamond/rhombus. Only a narrow gutter (a few
pixels — much smaller than a card) separates cards within a row and between
rows. Never implement this as a fixed 5-column grid with implicit blank
cells at the non-slot positions (e.g. the middle column on rows 2 and 4) —
that renders as card-sized holes in the shape, makes it look like a square
tipped on its side rather than a diamond, and makes people wonder whether
those gaps are meant to be filled. Build each row as its own centered group
of exactly as many cards as that row has (1, 2, 3, 2, 1), stacked with a
narrow row gutter — not a rigid grid with empty placeholder cells.

## Student-side features

- Open via link, no account needed
- See title + instructions
- Nine cards, draggable, snapping into the diamond's nine positions (1-2-3-2-1)
- Freely rearrange before submitting — no penalty for changing their mind
- Subtle animation on drag/drop/snap for a satisfying feel, without being distracting
- Explicit "Submit" action — the arrangement isn't final until they choose to send it
- Accessible by default: keyboard-operable drag-and-drop (not mouse/touch-only), screen-reader-friendly labelling, sufficient contrast and touch-target sizing throughout

## Accessibility (non-negotiable, not a nice-to-have)

- Full keyboard operability for the drag-and-drop interaction (this is the hard part and shapes the tech choice — needs a library or pattern that supports keyboard reordering, not just pointer-based dragging)
- WCAG AA at minimum as the working target
- Clear focus states, sensible tab order, ARIA labelling on cards and drop zones
- Per-task font/size/colour-scheme customization was tried and removed
  (2026-09-30 decision, do not re-add without discussion): the controls
  didn't visibly do anything for two of the three settings, and the large
  font size broke the fixed diamond layout. The app now ships one fixed,
  already-accessible look (Lexend, the cream/navy Sticky Canvas palette) —
  accessibility comes from that single design being good, not from tutor
  configuration.

## Out of scope for v1

- Analytics/reporting beyond viewing one student's result at a time
- Images on cards at all (dropped entirely, see Tutor-side features above)
- Live collaborative mode (see its own section below) — in progress on the `live-collaborative-mode` branch, not folded into the async model above

## Live collaborative mode (in progress — see `live-collaborative-mode` branch)

Small groups are a common real session shape, and the pedagogical value of a
diamond nine (disagreement in the middle row) depends on students seeing and
reacting to each other live — which for a remote tutor means real-time sync,
not just async solo submissions. This is deliberately scoped small enough to
actually finish rather than open-ended "multiplayer".

### Decided

- **Shared state, not personal state.** The same board model that exists
  today (slot assignment + pool) held server-side per session and broadcast
  to everyone connected, instead of living only in one browser.
- **Last-write-wins, full stop.** No operational-transform/CRDT merge logic.
  Two people move at once, the later message received wins. This falls out
  for free from the chosen transport (see below): a room processes incoming
  messages one at a time, in arrival order, so there's no real concurrency
  to coordinate — the second move simply overwrites the first in the room's
  in-memory state, no special-case code needed.
- **Presence is a name list, not live cursors/avatars.** Highest visual
  payoff, lowest functional necessity, meaningful extra work — cut from v1.
- **Tutor moderation is two controls**: Reset board, End session (freeze the
  board). Not per-student locking, not kick, not granular controls.
- **Reconnection just refetches current state.** No resumable session state
  machine — a dropped student rejoins and sees wherever the board currently
  is.
- **Transport: PartyKit** (2026-10-06 decision), not a hand-rolled WebSocket
  server. Rejected a raw hand-rolled WebSocket server because it would mean
  building, ourselves, several things that have nothing to do with this
  app's actual feature: reconnect/retry logic for every dropped connection,
  a way for multiple server processes to pass messages to each other
  (needed the moment there's more than one server instance for
  reliability), and the deploy/scaling complexity of a stateful server
  instead of a normal stateless one. PartyKit runs on Cloudflare's Durable
  Objects infrastructure (Cloudflare acquired PartyKit in 2024, so this
  isn't two competing backends, it's one engine with a friendlier API) and
  absorbs all of that: app code is just "on message, update shared state,
  broadcast." Chose PartyKit's own free tier over using Cloudflare Workers
  directly, since Durable Objects require Cloudflare's $5/month Workers
  Paid plan with no free option — PartyKit avoids that recurring cost while
  validating the feature. Revisit direct Durable Objects only if PartyKit's
  free tier is ever actually outgrown; migrating later is a smaller step
  than it looks, since it's the same underlying platform.
- **A live session is started from an existing task, not a new concept.**
  The tutor's dashboard/editor gets a "Start live session" action on a
  saved task. This mints a short-lived PartyKit room, seeded once from that
  task's existing title/instructions/cards (fetched from the normal
  `/api/sets/:id` endpoint — the room does not get its own copy of the
  SQLite data model). The tutor is given a separate shareable *live* link
  (distinct from the existing async student link) that points students at
  that specific room.
- **Student join flow**: open the live link → optional display name prompt
  (same pattern as the existing post-submit name field) → connects to the
  room → receives the current shared state → can drag cards, with every
  move broadcast to the room and reflected on everyone else's screen.
- **End-of-session persistence**: ending a live session writes exactly
  *one* row to the existing `results` table — there is one shared final
  arrangement, not one per student, since the whole point is that it was
  built together. `student_name` holds a comma-joined list of whoever was
  present (or a generic "Live group session" label if nobody gave a name),
  reusing the existing results schema rather than adding a new table for
  this. Flagged here as the simplest option, open to revisiting once this
  is actually in front of a tutor.
- **Test with simulated concurrent clients before real students ever see
  it**: multiple headless browser contexts driving simultaneous
  interactions (same card grabbed at once, drop-at-the-same-instant, a
  dropped connection mid-drag) against the real PartyKit room, asserting
  the board always converges to a sane state. This is the actual defense
  against live bugs, not hoping it doesn't happen.

### Explicitly excluded, even from this scoped version

- Live cursors or per-card "who's dragging this" indicators — out of
  *this* build specifically (now fully spec'd as its own stretch goal
  below, not forgotten, just deliberately not part of Stages 1-4).
- Granular per-card locking, session replay/history, and scaling past a
  handful of concurrent rooms.

### Build order (staged, each stage a working checkpoint)

1. ✅ **Prove the plumbing** (2026-10-06): a throwaway two-browser-tab demo
   (a shared counter) through PartyKit confirmed the local dev loop works,
   with no account needed. Superseded by step 2 below and removed.
2. ✅ **Plain state sync — the real MVP** (2026-10-06): `party/server.js`
   now holds the real shared board (slotAssignment + pool, same shape as
   app.js's own state), and `public/live.html`/`public/live.js` is a full
   networked rebuild of the board UI — same visuals (reuses style.css
   as-is), same interaction model (mouse drag, tap-to-place, full keyboard
   navigation — ported line-for-line, not a stripped-down version).
   A move only broadcasts once a card is *dropped*, no in-progress drag
   streaming (see exclusions above). The browser never applies a move
   locally — it sends a request and only updates once the server
   broadcasts the new state back, which is what makes last-write-wins work
   and is why the existing FLIP animation in render() ends up animating
   *other people's* moves too, for free, with no extra code: it just
   diffs before/after positions regardless of who caused the change.
   Verified with two simulated browser tabs: a move in either one is
   reflected identically in both, and a full keyboard-only pick-up-and-place
   flow was also confirmed working on this page.
   Cards are still a hardcoded demo set at this stage, not yet loaded from
   a real tutor task — that wiring belongs with step 3's tutor controls,
   since starting/ending a session is itself a tutor action.
   Connects via a plain WebSocket to PartyKit's local dev server
   (`ws://127.0.0.1:1999`) — fine for this build stage, but will need
   updating to the real deployed PartyKit URL (and likely PartyKit's own
   reconnecting `partysocket` client, for real-world flakiness) once this
   is actually deployed.
3. ✅ **Tutor controls + presence** (2026-10-06): `live.html` now loads a
   room's real task data (title, instructions, cards) from the existing
   `/api/sets/:id` endpoint, keyed by the task's own id as the room id -
   no separate session-id minting. The tutor's share-block (tutor.js) now
   shows a live-session student link alongside the existing async one,
   plus a separate "host" link carrying their tutor token.
   A host sees Reset board / End session controls (two-click confirm on
   End, matching the app's existing no-native-dialogs convention); a
   student never does, regardless of what's in their URL - the *server*
   independently re-validates the token against the real tutor-auth check
   before honouring either action (verified: a fabricated `?token=` shows
   the controls client-side but a reset request against it is silently
   rejected, board state unchanged). Reset clears the board back to the
   pool; End freezes all further moves everywhere, broadcasts that, and
   saves the final arrangement as one row through the *existing*
   `/api/sets/:id/results` endpoint - `student_name` is whoever joined
   with a name, comma-joined (or "Live group session" if nobody did) -
   confirmed that saved row renders correctly in the tutor's existing
   Results view with no changes needed there.
   Presence is a simple joined-names line, updated on join and on
   disconnect. Verified end to end with two simulated browsers: real task
   data loads correctly, presence updates live, a move in one is reflected
   in the other, Reset and End both work, moves are rejected after End,
   and the saved result is correct.
4. ✅ **Concurrency test pass** (2026-10-06): `test/concurrency.js`, run
   with `npm run test:concurrency` - a real, kept test (not a throwaway
   verification script), since concurrency bugs are exactly the kind
   "it worked when I tried it alone" cannot catch. Connects several raw
   WebSocket clients (Node's own built-in fetch/WebSocket, no new
   dependency) straight to a real PartyKit room and fires genuinely
   simultaneous moves at it: the same card grabbed for different slots at
   once, different cards shoved into the same slot at once, and an abrupt
   disconnect mid-interaction. After each, it checks the one invariant
   that actually matters - every one of the 9 cards appears in exactly one
   place (a slot or the pool), never duplicated, never lost. Sanity-
   checked the checker itself against deliberately broken states
   (a duplicated card, a missing card) to confirm it actually fails when
   it should, not just always passing. All scenarios pass against the
   real backend.

### New moving parts this introduces (be aware of, not blockers)

- **A second deployed service.** The live-sync server lives separately from
  `server.js` (its own `worker/` folder, its own `wrangler.jsonc`, deployed
  with `npx wrangler deploy` to Cloudflare's edge) and runs independently of
  wherever the existing Express app is hosted. The browser talks to *both*:
  the existing Express API for task data, and the Worker/Durable Object room
  for live sync.
- **A Cloudflare account on the $5/month Workers Paid plan**, needed before
  any of this can be deployed (local dev can run without it, but shipping it
  live can't) — Durable Objects have no free tier. This is the one step in
  this feature that's the user's to do, not something done from within a
  coding session.

### Transport migration: PartyKit → raw Cloudflare Workers (2026-10-06)

Deploying to a fresh Cloudflare account failed: `npx partykit deploy` errored
with "Creating new key-value backed Durable Object namespaces is no longer
supported on this account. Please create a namespace using a
`new_sqlite_classes` migration instead." Cloudflare changed policy
2026-07-09 to require SQLite-backed storage for any *new* Durable Object
namespace. Confirmed via the published npm package that `partykit@0.0.115`
(the latest version that exists) was published 2025-05-21 — over a year
before that policy change — and a direct check of its bundled CLI code found
zero support for `new_sqlite_classes` anywhere. This isn't a config problem
or something a newer PartyKit version would fix, because no newer version
exists: deploying through PartyKit's CLI to any Cloudflare account created
(or Durable-Object-namespace-reset) after 2026-07-09 is a dead end.

PartyKit was never a separate backend from Cloudflare — it's a thin
convenience wrapper that was always deploying this same code to Workers +
Durable Objects underneath. So the fix is to stop going through that
now-broken wrapper and deploy directly with `wrangler` (Cloudflare's own,
actively maintained CLI, which does support `new_sqlite_classes`) instead.
Nothing about where this runs, what it costs, or the game logic itself
changes — only the authoring/deploy layer on top of it.

What moved:
- `party/server.js` (PartyKit's `Party.Server` shape) → `worker/index.js`
  (a Worker `fetch()` handler that routes `/party/:roomId` to a same-named
  `Room` Durable Object, plus the `Room` class itself using Cloudflare's
  native WebSocket API). All game logic — last-write-wins moves, presence,
  reset/end, drag-position relay, the rate limit and connection cap — is
  unchanged line-for-line in substance; only the lifecycle names changed
  (`onConnect`/`onMessage`/`onClose` → `fetch()`+event listeners,
  `room.broadcast`/`room.getConnections` → manual iteration over tracked
  sessions). Not using the Hibernation API (`acceptWebSocket`) — this keeps
  the port simple (plain in-memory state, nothing to serialize) and a
  classroom-scale, hour-long session gets no real benefit from hibernation's
  billing optimization.
- `partykit.json` → `wrangler.jsonc`, with an explicit `new_sqlite_classes`
  migration for the `Room` class.
- `partykit` devDependency → `wrangler`. No PartyKit code or client library
  (`partysocket`) remains anywhere in the project.
- Local dev address changed from PartyKit's `ws://127.0.0.1:1999` to
  `wrangler dev`'s default `ws://127.0.0.1:8787`, updated in both
  `public/live.js` and `test/concurrency.js`. The `/party/:roomId` URL path
  itself was kept identical on purpose, to minimize the blast radius of this
  change to just host/port.
- `public/live.js` picks its live-server host by hostname (localhost →
  `127.0.0.1:8787`; anything else → the deployed Worker's `*.workers.dev`
  URL) — the production host is a placeholder until the first real
  `wrangler deploy` gives us the actual subdomain to fill in.

### Stretch goal: visible live dragging (2026-10-06, ✅ built)

Everything above only ever shows a card's *final* position once it's
dropped — exactly what was built and tested in Stages 1-4. This section
specs out the explicitly-excluded extra: seeing *other people's cards
actually move* while they're still dragging them, Figma/Miro-style, not
just teleporting into place after the fact. This is real, separable work
on top of a finished foundation, not a prerequisite for anything above —
nothing in this section should be started before the four stages above
are solid, since this only adds cosmetic polish on top of state sync
that already has to be correct regardless.

**What it actually adds.** While one person has a card mid-drag (mouse
down, moved past the threshold, not yet released), everyone else sees a
translucent "ghost" copy of that card following the dragger's cursor in
real time, labelled with their name if they gave one. The real card
stays exactly where it already was in everyone else's board (in its
slot or the pool) until the drag actually completes — the ghost is a
visual overlay on top of the real board, never a change to the real
board's own rendering, which is what keeps this additive rather than a
rewrite of anything already built and tested.

**New message types** (party/server.js only relays these — it does not
validate or store them as part of the authoritative board state, since
they're purely cosmetic and never affect correctness):
- `drag-start` `{cardId}` — sent once, the moment a local drag crosses
  the existing DRAG_THRESHOLD in app.js/live.js.
- `drag-move` `{cardId, xPct, yPct}` — sent repeatedly while dragging,
  throttled (see below). Positions are percentages of a shared reference
  element's bounding box (e.g. `.layout`), **never raw pixels** — two
  people's screens are different sizes, so a raw pixel coordinate from a
  1920px-wide monitor means something completely different on a 1366px
  laptop. This is the one easy-to-miss detail that would otherwise make
  the ghost render in a visibly wrong spot on anyone with a differently
  sized window.
- `drag-end` `{cardId}` — sent on every pointerup, whether or not the
  drop produced a real move (e.g. dropped off-board) - this is what
  tells everyone else to remove that ghost. Relying only on the
  eventual `state` broadcast to clear it would leave a stale ghost
  on-screen forever after an invalid drop, since no `move` message (and
  therefore no new `state`) follows one.

**Throttling, not every pointermove.** Raw `pointermove` events can fire
well past 60 times a second; broadcasting every one, multiplied across
several simultaneous draggers, is wasteful for no visible benefit.
Throttle `drag-move` sends to roughly 15-20 times a second (e.g. only
send if ≥50ms has passed since the last send for that drag) - smooth
enough to look continuous, far cheaper on the room.

**Who "wins" when two people grab the same card.** This needs a
lightweight claim, not real locking - correctness is still guaranteed
regardless by the existing last-write-wins move logic (already tested in
Stage 4), so this is purely about avoiding a confusing visual fight, not
a new source of truth:
- The server keeps an in-memory `Map<cardId, connectionId>` of
  who's currently dragging what, set on `drag-start` and cleared on
  `drag-end` (and on that connection's `onClose`, same cleanup pattern
  already used for presence).
- `drag-start` broadcasts who now holds the card; every other client
  visually marks that card as "being moved by someone else" (a subtle
  dimmed/outlined state) and should discourage - but not hard-block -
  grabbing it themselves, since hard-blocking risks a card getting
  permanently stuck claimed by someone whose `drag-end` got lost (a
  dropped connection mid-drag - exactly Stage 4's Scenario C). If someone
  grabs it anyway, both drags can be visually shown; whichever `move`
  message the server receives second still simply wins, same as today.

**Rendering.** The ghost is a freshly-created overlay element per remote
drag (styled like the real `.card` but with reduced opacity and a small
name tag), positioned with the percentage coordinates converted back to
pixels against the local browser's own copy of the same reference
element's current bounding box - never reusing or moving the real card
element itself. Removed on `drag-end`, or immediately superseded by the
normal FLIP-animated settle once the real `state` broadcast lands.

**Scope boundary.** This only applies to mouse-drag interactions, which
are the only ones with a continuous in-between position to broadcast in
the first place - keyboard and tap-to-place pick-up/place are
instantaneous (no cursor to follow) and are explicitly untouched by this
stretch goal.

**Suggested build order**, same staged-checkpoint style as the main
feature:
1. Prove the coordinate-normalization idea in isolation (two tabs, one
   moving dot synced by percentage position) before touching real cards
   - this is the one genuinely fiddly new piece, worth isolating first.
2. Wire `drag-start`/`drag-move`/`drag-end` through party/server.js as a
   pure relay, and render real ghost cards in live.js.
3. Add the "being moved by someone else" visual state and the
   claim map, including its cleanup on disconnect.
4. A concurrency-style test extending test/concurrency.js's approach:
   simulate two clients "dragging" the same card (sending interleaved
   `drag-move` for both) and confirm neither ghost ever reflects the
   other's position, and that a dropped connection mid-drag (`drag-start`
   with no matching `drag-end`) doesn't leave a permanently-claimed card.

Still excluded even if this is built: granular per-card locking that
actually prevents a second grab (rejected above, for the dropped-
connection reason given), session replay/history of drag movements, and
anything beyond a handful of concurrent rooms.

**Built as specced**, with two things worth recording:
- The percentage-coordinate design worked exactly as intended once
  verified correctly - an early test comparing raw pixel positions across
  two tabs showed a ~20-35px mismatch, which looked like a real bug but
  turned out to be a *test* artifact: Playwright's multi-step mouse
  interpolation fires several synthetic positions within a few
  milliseconds, faster than the 50ms throttle window, so only an
  early interpolated point (not the true final one) was getting sent. A
  single, non-interpolated final move confirmed an exact pixel match
  between the sender's real position and the receiver's ghost - the
  coordinate math itself was correct all along.
- A real bug *was* found this way too: the ghost's name tag was
  invisible, clipped by the base `.card` rule's `overflow: hidden`
  (meant for clamping long card text) because the tag is deliberately
  positioned just outside the ghost's own box. Fixed with an
  `overflow: visible` override on `.ghost-card` specifically.
- Verified end to end: a remote drag dims the real card and shows a
  tracking ghost with the dragger's name; the ghost disappears and the
  dimming clears on a successful drop, an invalid (off-board) drop, and
  an abrupt mid-drag disconnect; Stage 3 (reset/end) and Stage 4
  (concurrency) were re-run afterward and still pass unchanged.

### Cost-abuse defenses (2026-10-06, ✅ built)

Deploying to a paid Cloudflare Workers plan (Durable Objects bill by
connection-time and message volume) raised an obvious question: what
stops a leaked/viral link, or just a flood of made-up room ids, from
running up a large bill? Cloudflare has no "hard stop spending" switch
for Workers - usage notifications exist and are worth turning on
separately, but the real defense has to be limits this app enforces
itself. Three, all in `party/server.js`:

- **Unknown room ids are refused outright**, not given a working demo
  board. This mattered more than it sounds: a room used to silently fall
  back to a fixed demo card set for any id that didn't match a real task,
  which meant spinning up endless *different* rooms - each a fresh
  billable Durable Object - cost an attacker nothing. Now `ensureLoaded()`
  only marks a room valid once it's confirmed against a real
  `/api/sets/:id`, and `onConnect` closes the connection (code 4004)
  immediately for anything else.
- **A hard cap of 50 concurrent connections per room.** Generously above
  any real class size; connection 51 gets closed (code 4029, "This
  session is full") rather than joining.
- **A per-connection message rate limit** (30/sec), enforced server-side
  regardless of what a client claims to be doing - `live.js`'s own
  20/sec drag-move throttle only restrains a well-behaved browser; this
  is what stops a raw WebSocket client ignoring that entirely.

Found and fixed a real race while verifying the first one: multiple
connections arriving at once (exactly what several students opening a
link within the same second looks like) all called `ensureLoaded()`
before the very first one's fetch had resolved. The old code set a
synchronous "already loading" flag before awaiting, so the later
arrivals saw "loaded" but not yet "valid" and were wrongly rejected as
unknown sessions. Fixed by having every caller await the *same* in-flight
promise instead of racing a boolean flag - re-ran Stage 4's concurrency
test afterward (6 simultaneous connections) to confirm it actually fixed
the race rather than papering over the symptom.

Verified directly against the real PartyKit room (raw WebSocket clients,
no browser needed for this one): an unknown room id was refused with the
correct close code; flooding 100 messages in under a second produced
exactly 30 state broadcasts, then the room worked normally again once
the window cleared; 52 simultaneous connection attempts against the cap
of 50 produced exactly 50 accepted and 2 refused with the correct reason.

### Known issues / later polish (not urgent)

- **Presence line conflates "named" with "present" (2026-10-06).** The
  presence indicator (`public/live.js`'s presence-line, backed by
  `presenceMessage()` in `worker/index.js`) only counts connections that
  typed a display name in the join prompt — anyone who skips that field is
  invisible to it. So "Waiting for others to join…" can show even while
  several anonymous people are already connected and able to drag cards,
  which reads as more confusing than reassuring. Flagged during real
  classroom use; not fixed yet - would mean tracking connection count
  separately from the named-people list (e.g. "3 people here (2 named):
  Alice, Bob" or similar), which touches both the server's presence
  payload shape and the client's rendering of it. Revisit when there's
  time to make this change carefully rather than as a last-minute tweak.

## Tech shape

- Vanilla HTML/CSS/JS, no build step (per CLAUDE.md) — but the accessibility requirement (keyboard drag-and-drop) may push toward using a small, well-tested library rather than hand-rolling it. Flag this as a decision point for the build itself, not pre-decided here.
- No backend framework assumed yet — needs *some* way to persist sets and results (even something as simple as browser storage for a first pass, or a minimal backend later). Decide during planning, not in this spec.
