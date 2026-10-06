# Diamond Nine

A simple web app for online tutors to run a diamond nine card sort task with students.

- 9 cards, arranged by drag-and-drop into a diamond formation (1-2-3-2-1 rows)
- Tutor can set/edit the text on each card and a prompt/question at the top
- Student's final arrangement can be saved or exported (image or simple text list)
- Vanilla HTML/CSS/JS, no build step - keep it dependency-light so it's trivial to host
- Scope decision (2026-09-29): designed for laptop/desktop/large tablet only. A
  traditional single-user diamond nine doesn't work at phone scale, so small
  screens get a "this app works best on a larger screen" message instead of a
  squeezed layout. Revisit only if/when we design a separate mobile-collaborative
  reimagining (multiple students on one sort) - not a current priority.
- Design direction (2026-09-29): visual north star is Miro's look and feel.
  Landed on "Sticky Canvas" - cards as colored sticky notes on a dotted
  canvas, pool and info panel as floating rounded panels, Lexend font. This
  is built and live in public/. `web-design-guidelines` skill (Vercel,
  installed under .agents/skills/) is a review/audit tool for checking
  finished HTML/CSS against best practices, not a generator.
- Product direction (2026-09-30): confirmed with the user -
  - Session model is commonly small groups, not just 1:1 - the pedagogical
    value of a diamond nine (disagreement in the middle row) depends on
    students being able to see and react to each other, which for a remote
    tutor means live sync eventually matters, not just async solo sorting.
  - Live-collaborative (Miro-style: multiple students on one shared board,
    tutor watching/moderating) is real-time infrastructure (sync, presence,
    conflict handling, moderation UI) and is explicitly its own future
    project - not something to bolt onto the current model. Design it
    properly when we get there rather than half-building it now.
  - Immediate next milestone (in progress): tutor accounts and task
    management - sign up (capability-token/link, no password, per the
    earlier decision - see spec.md), dashboard listing saved sets,
    create/edit a task, generate/copy its shareable link, view results.
    Built against the current async single-student-at-a-time model.
  - Students never get accounts. An optional display name (already
    supported server-side via `student_name` on results) is the only
    identity - no login, ever, for students.
- Tutor accounts/dashboard/task CRUD/results milestone above: shipped and
  merged to master (2026-10-06).
- Live-collaborative mode (2026-10-06): now being built on the
  `live-collaborative-mode` branch, with PartyKit chosen as the realtime
  transport (runs on Cloudflare's Durable Objects infrastructure; picked
  for PartyKit's own free tier over paying Cloudflare's $5/month Workers
  plan directly). Full spec, staged build plan, and what's explicitly
  excluded are in spec.md's "Live collaborative mode" section - read that
  before touching this feature, it's a real design, not a placeholder.
