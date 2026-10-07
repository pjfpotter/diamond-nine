# What I learned building Diamond Nine

Diamond Nine is a card sort tool for online tutors: nine cards, dragged into a
diamond from "most agree" to "least agree". I built it between 8 September and
7 October 2026, working with Claude Code. Almost every part of it was new to
me. This is a plain-language record of what we built, what went wrong, what I
used for the first time, and what we decided.

## What we built, in order

1. **The student board.** Nine sticky-note cards and a diamond of nine slots.
   Cards can be dragged with a mouse, or picked up and placed by click, tap or
   keyboard.
2. **A proper look.** A "Sticky Canvas" design inspired by Miro: coloured notes
   on a dotted background, floating white panels, the Lexend font.
3. **The tutor side.** Tutors create a private space, write tasks, copy a link
   for students, and see what students submitted.
4. **A security pass.** A deliberate review of every place a user can type
   something in, which found and fixed real problems.
5. **Live sessions.** A whole group sorts one shared board at the same time and
   can see each other's cards moving, with a QR code for joining.
6. **Going public.** A launch video, a README, a sample task, and fixes to make
   the site safe to share.

## Problems we solved

| Problem | What we did |
|---|---|
| The diamond doesn't fit on a phone | Stopped trying. Small screens get a polite "use a bigger screen" message. |
| Drag-and-drop excludes keyboard and touch users | Added pick-up-and-place by click, tap or keyboard as an equal alternative. |
| Long card text overflowed or was cut off | Measured how much text really fits and capped cards at 50 characters. |
| Animations that looked nice but felt wrong | Removed them. Several "polish" effects were built, tried, and taken out. |
| PartyKit, the first tool for live sessions, couldn't deploy to a new Cloudflare account | Replaced it the same day with Cloudflare's own tools, which it was a thin layer over anyway. |
| Five students grabbing the same card at once | Wrote a test that simulates exactly that against the real system, and kept it. |
| A live service that bills by usage could be abused | Added connection caps and message limits before deploying. |
| The rate limits treated every visitor as one person | The site sits behind Render's proxies, so the server saw the proxy's address, not the visitor's. We told it how many proxies to trust (three). |
| The first attempt at measuring that gave "0" | Render's own health check reached the server first. We changed the log to wait for a real visitor. |
| Hovering a text link turned it black on black | A general button style was overriding the link style. Fixed the rule. |
| Making the video on a laptop with no video tools installed | Installed temporary copies of the tools in a scratch folder instead of on the system. |

## Technologies that were new to me

- **HTML, CSS and JavaScript with no framework.** The whole front end is plain
  files with no build step, which keeps it easy to host and to read.
- **Node.js and Express.** The small server that stores tasks and results and
  answers the browser's requests.
- **SQLite.** A database that is just one file on disk. Simple, but see the
  hosting lesson below.
- **Git and GitHub.** Saving work as a history of small, described changes, and
  publishing it.
- **Render.** Hosts the server. Pushing to GitHub triggers a new deploy.
- **Cloudflare Workers and Durable Objects.** Run the live sessions. Each live
  room is its own small always-consistent object that every student connects
  to.
- **WebSockets.** A connection that stays open so the server can push changes
  to every browser instantly, instead of browsers asking repeatedly.
- **Wrangler.** Cloudflare's command-line tool for running and deploying the
  Worker.
- **Environment variables.** Settings that live on the host rather than in the
  code, such as `TRUST_PROXY_HOPS`, so the same code works locally and live.
- **Rate limiting.** Capping how often one visitor can do something, to stop
  scripts flooding the site.
- **Capability links.** A long random link that acts as the password. No
  accounts, no passwords to forget.
- **Hyperframes and text-to-speech.** The launch video is a web page animated
  frame by frame, with a computer-generated narrator.
- **Claude Code.** An AI assistant that reads the project, writes and tests
  changes, and explains them.

## Decisions we made, and why

- **Laptop and tablet only.** A nine-card diamond is unusable at phone size, so
  we chose honesty over a squeezed layout.
- **Students never log in.** An optional name is the only identity. Less
  friction, and no student data to protect.
- **Tutors log in with a private link, not a password.** Simple, but it means
  the link must be kept secret and never published.
- **Accessibility is not optional.** Keyboard and screen-reader use were
  designed in, not added at the end.
- **Design live mode properly before building it.** We wrote a full spec and
  built it in stages, each one a working checkpoint.
- **Cut features that didn't earn their place.** Card images and font and
  colour options were built and then removed.
- **The site's front page is safe to share; my own dashboard link is not.**
- **Be upfront that the hosted copy is a test site.** The free hosting plan
  wipes saved data when it restarts and takes about a minute to wake up, so the
  README says so.
- **The sample task is a button, not stored data.** "Start from an example"
  fills in the form in the browser, so there is nothing on the server to own or
  protect.
- **New tutor spaces are capped at two per hour per network.** A tutor only
  needs one, so the cap is tight.
- **Teaching-level comments in the code.** The code explains itself for someone
  learning, because that someone was me.

## Things I'd tell someone starting out

- **Free hosting forgets.** A database stored as a file disappears when a free
  server restarts. Fine for a demo, not for real classes.
- **"It works on my machine" hides whole classes of bugs.** The proxy problem
  and the five-students-at-once problem only exist on the real, shared system.
- **Measure, don't guess.** The character limit and the proxy count both came
  from checking the real thing, and the first guess would have been wrong.
- **Check before you publish a link.** Asking "is this safe to share?" turned
  up a real weakness before anyone could use it.
- **Removing things is progress.** Some of the best changes were deletions.
- **Write decisions down.** `spec.md` and `CLAUDE.md` record why choices were
  made, which saved re-arguing them later.
- **Small, described changes.** Each commit does one thing and says what, so
  the history reads like a diary of the project.

## What's still open

- Live sessions and the hosted copy are for testing; durable storage would be
  needed before real use.
- The rate-limit counters reset whenever the server restarts.
- There is no limit yet on how many tasks one tutor space can hold.
