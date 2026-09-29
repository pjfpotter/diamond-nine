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
