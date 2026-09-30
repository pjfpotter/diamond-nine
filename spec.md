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
  - Nine cards, text only (up to 500 characters each). Images were
    considered and deliberately dropped (2026-09-30 decision, do not
    re-add without discussion): they don't suit the sticky-note visual
    design, and aren't typically used in real diamond nine tasks anyway.
- Generate a shareable link per set
- Save sets for reuse across students/sessions
- View submitted results per link (which student, if named, and their final arrangement)

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
- Live collaborative mode (see its own section below) — a real future phase, not something to fold into the current async model incidentally

## Live collaborative mode (scoped future phase, not current v1)

Small groups are a common real session shape, and the pedagogical value of a
diamond nine (disagreement in the middle row) depends on students seeing and
reacting to each other live — which for a remote tutor means real-time sync,
not just async solo submissions. This is a genuine future phase, deliberately
scoped small enough to actually finish rather than open-ended "multiplayer":

- **Shared state, not personal state.** The same board model that exists
  today (slot assignment + pool) held server-side per session and broadcast
  to everyone connected, instead of living only in one browser.
- **Last-write-wins, full stop.** No operational-transform/CRDT merge logic.
  Two people move at once, the later timestamp wins. For a low-stakes card
  sort, "someone else already moved it" is a shrug, not a data-loss
  incident — this alone removes the single biggest source of real
  multiplayer complexity.
- **Presence is a name list, not live cursors/avatars.** Highest visual
  payoff, lowest functional necessity, meaningful extra work — cut from v1.
- **Tutor moderation is two controls**: Reset board, End session (freeze the
  board). Not per-student locking, not kick, not granular controls.
- **Reconnection just refetches current state.** No resumable session state
  machine — a dropped student rejoins and sees wherever the board currently
  is.
- **Transport: a managed realtime service** (e.g. Cloudflare Durable
  Objects / PartyKit, or Supabase Realtime/Ably as alternatives) rather than
  a hand-rolled WebSocket server with custom reconnection/heartbeat/presence
  logic — the service absorbs connection lifecycle; app code is just "on
  message, update shared state, broadcast." Cost at this scale is
  effectively $0–10/month, not a real budget line.
- **Test with simulated concurrent clients before real students ever see
  it**: multiple headless browser contexts driving simultaneous
  interactions (same card grabbed at once, drop-at-the-same-instant, a
  dropped connection mid-drag) against the real backend, asserting the
  board always converges to a sane state. This is the actual defense
  against live bugs, not hoping it doesn't happen.
- Explicitly still excluded even from this scoped version: live cursors,
  per-card "who's dragging this" indicators, granular per-card locking,
  session replay/history, and scaling past a handful of concurrent rooms.

## Tech shape

- Vanilla HTML/CSS/JS, no build step (per CLAUDE.md) — but the accessibility requirement (keyboard drag-and-drop) may push toward using a small, well-tested library rather than hand-rolling it. Flag this as a decision point for the build itself, not pre-decided here.
- No backend framework assumed yet — needs *some* way to persist sets and results (even something as simple as browser storage for a first pass, or a minimal backend later). Decide during planning, not in this spec.
