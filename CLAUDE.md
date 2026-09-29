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
- Design status (2026-09-29): user feedback is that the mechanics/accessibility
  work is solid but the visual design is weak - this is now explicitly a
  design/UX problem, not an engineering one. Visual north star: Miro's look and
  feel (flat colored blocks, generous canvas whitespace, rounded rectangles,
  light neutral background with saturated accent colors used sparingly, soft
  shadows over borders, friendly rounded sans-serif). Plan: use the `design`
  skill to mock up 2-3 genuinely different board layouts as a visual canvas
  (not hand-edited CSS) for the user to react to, before touching production
  code. `web-design-guidelines` skill (Vercel, installed in this project under
  .agents/skills/) is a review/audit tool for AFTER building, not a generator -
  run it against the real HTML/CSS once a direction is chosen. The user was
  also trying to install Anthropic's `frontend-design` plugin via an install
  card but it had not taken effect as of end of this session - check whether
  it's available before assuming it isn't.
