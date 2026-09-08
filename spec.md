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
  - Title
  - Instructions text (the prompt/question framing the sort)
  - Nine cards, each with text and an optional image
  - Font choice from a curated list of accessible fonts
  - Font size setting
  - Colour scheme chosen from a curated set of dyslexia-friendly combinations (not a free colour picker — keep choices bounded and pre-vetted)
- Generate a shareable link per set
- Save sets for reuse across students/sessions
- View submitted results per link (which student, if named, and their final arrangement)

## Student-side features

- Open via link, no account needed
- See title + instructions
- Nine cards, draggable, snapping into the diamond's nine positions (1-2-3-2-1)
- Freely rearrange before submitting — no penalty for changing their mind
- Subtle animation on drag/drop/snap for a satisfying feel, without being distracting
- Explicit "Submit" action — the arrangement isn't final until they choose to send it
- Accessible by default: keyboard-operable drag-and-drop (not mouse/touch-only), screen-reader-friendly labelling, respects the tutor's chosen font/size/colour scheme, sufficient contrast and touch-target sizing throughout

## Accessibility (non-negotiable, not a nice-to-have)

- Full keyboard operability for the drag-and-drop interaction (this is the hard part and shapes the tech choice — needs a library or pattern that supports keyboard reordering, not just pointer-based dragging)
- WCAG AA at minimum as the working target
- Dyslexia-friendly colour palettes and font choices, curated rather than freeform
- Adjustable font size
- Clear focus states, sensible tab order, ARIA labelling on cards and drop zones

## Out of scope for v1

- Tutor accounts/auth (start with unauthenticated or a very simple shared-password approach — decide once we're building)
- Analytics/reporting beyond viewing one student's result at a time
- Real-time collaborative sort (this is designed for one student at a time, not simultaneous multi-user)
- Image upload hosting — start with image URL field, revisit if it needs real uploads

## Tech shape

- Vanilla HTML/CSS/JS, no build step (per CLAUDE.md) — but the accessibility requirement (keyboard drag-and-drop) may push toward using a small, well-tested library rather than hand-rolling it. Flag this as a decision point for the build itself, not pre-decided here.
- No backend framework assumed yet — needs *some* way to persist sets and results (even something as simple as browser storage for a first pass, or a minimal backend later). Decide during planning, not in this spec.
