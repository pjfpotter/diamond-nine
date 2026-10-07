// Same IIFE pattern as app.js - see the comment at the top of that file
// for why. This script runs the whole tutor-facing side of the app:
// signing up, the dashboard, creating/editing tasks, and viewing results.
// It's a tiny hand-rolled single-page app: one HTML file (tutor.html)
// holds a handful of <template> elements, and this file swaps which one
// is shown based on the URL's hash (the part after #), rather than
// navigating to separate pages.
(function () {
  'use strict';

  // The key used to store the tutor's auth token in the browser's
  // localStorage, so they stay "logged in" between visits without a
  // password - see the get/set/clear helpers below.
  const TOKEN_KEY = 'diamond9_tutor_token';

  const appEl = document.getElementById('app'); // the single container everything gets rendered into
  const navEl = document.getElementById('tutor-nav');
  const liveRegionEl = document.getElementById('live-region');

  // --- Auth token helpers ---
  //
  // There are no passwords or accounts here (see spec.md) - a tutor
  // "logs in" by having a long random token, generated once by the server
  // and stored in this browser's localStorage. Whoever has the token can
  // manage the tasks it owns; it's effectively a very long, hard-to-guess
  // password that's never typed in, just remembered by the browser (or
  // carried in the dashboard link, see dashboardLink() below).

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function clearTokenAndGoWelcome() {
    localStorage.removeItem(TOKEN_KEY);
    location.hash = '#/';
    route();
  }

  // Same live-region announce pattern as app.js - see that file's comment
  // on announce() for why it clears the text before setting it.
  function announce(message) {
    liveRegionEl.textContent = '';
    requestAnimationFrame(() => {
      liveRegionEl.textContent = message;
    });
  }

  // A thin wrapper around fetch() that automatically attaches the tutor's
  // token as a header on every request, so the rest of this file doesn't
  // have to repeat that logic on every single API call. This is the same
  // idea as an "interceptor" or "middleware" pattern you'll see in bigger
  // HTTP client libraries.
  async function api(path, opts) {
    opts = opts || {};
    // Object.assign merges objects together (later ones win on conflicts) -
    // this starts from a default Content-Type header, then layers in
    // whatever headers the caller passed, without mutating either original object.
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = getToken();
    if (token) headers['X-Tutor-Token'] = token;
    return fetch(path, Object.assign({}, opts, { headers }));
  }

  // Empties out the app container and clones in the content of a
  // <template> tag. <template> elements are inert (their content isn't
  // rendered or run) until explicitly cloned into the live document like
  // this - that's why tutor.html can define several "pages" worth of
  // markup without them all showing at once or conflicting with each other.
  function mount(tpl) {
    appEl.innerHTML = '';
    appEl.appendChild(tpl.content.cloneNode(true)); // true = deep clone (includes all children, not just the template tag itself)
  }

  function showNav(show) {
    navEl.hidden = !show;
  }

  // The tutor's personal dashboard link, with their token baked into the
  // URL as a query parameter - opening this link on any device logs them
  // back in automatically (see boot() at the bottom, which reads ?token=
  // out of the URL on first load).
  function dashboardLink() {
    return `${location.origin}${location.pathname}?token=${encodeURIComponent(getToken())}`;
  }

  // SQLite stores timestamps like "2026-09-30 12:34:56" with no timezone
  // marker - we know the server always writes these in UTC, so we turn it
  // into a proper ISO 8601 string (with a literal "T" instead of the space,
  // and a "Z" for UTC) that the Date constructor understands correctly.
  function formatDate(sqliteDatetime) {
    const iso = String(sqliteDatetime).replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    // If parsing somehow fails, show the raw value rather than "Invalid Date".
    return Number.isNaN(d.getTime()) ? sqliteDatetime : d.toLocaleString();
  }

  // Copies text to the clipboard and gives the button that triggered it
  // brief visual feedback ("Copied!"), then restores its original label.
  // navigator.clipboard.writeText() can reject (e.g. if the page doesn't
  // have clipboard permission), hence the try/catch.
  async function copyToClipboard(text, btnEl) {
    const original = btnEl.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btnEl.textContent = 'Copied!';
    } catch (err) {
      btnEl.textContent = 'Copy failed';
    }
    setTimeout(() => {
      btnEl.textContent = original;
    }, 1500);
  }

  // --- Views ---
  //
  // Each renderX() function below is a "page": it mounts the matching
  // <template>, fills in any dynamic content, and wires up whatever
  // buttons/forms that page needs. They're called by route() further down,
  // based on the current URL hash.

  function renderWelcome() {
    mount(document.getElementById('tpl-welcome'));
    showNav(false); // no dashboard/nav links to show before the tutor has an account
    document.getElementById('create-space-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; // prevent double-clicking while the request is in flight
      const res = await api('/api/tutors', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        btn.disabled = false;
        const errorEl = document.getElementById('welcome-error');
        errorEl.textContent = data.error || 'Could not create your tutor space. Please try again.';
        errorEl.hidden = false;
        return;
      }
      setToken(data.token);
      location.hash = '#/save-link'; // show them their bookmarkable link before dropping them into the dashboard
    });
  }

  function renderSaveLink() {
    mount(document.getElementById('tpl-save-link'));
    showNav(true);
    const input = document.getElementById('dashboard-link-input');
    input.value = dashboardLink();
    document.getElementById('copy-dashboard-link-btn').addEventListener('click', (e) => {
      copyToClipboard(dashboardLink(), e.currentTarget);
    });
    document.getElementById('continue-to-dashboard-btn').addEventListener('click', () => {
      location.hash = '#/dashboard';
    });
  }

  // Deleting is destructive (the task and all its results), so it needs a
  // deliberate second step - but a native confirm() dialog is jarring and
  // inconsistent with the rest of the app, so this is a simple two-click
  // pattern: first click arms it, second click (within a few seconds)
  // actually deletes; anything else re-arms the button back to normal.
  function bindDeleteButton(btn, id, title, li) {
    let armed = false;
    let timer = null; // holds the id returned by setTimeout, so it can be cancelled with clearTimeout

    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Really delete?';
        btn.classList.add('danger');
        timer = setTimeout(() => {
          armed = false;
          btn.textContent = 'Delete';
          btn.classList.remove('danger');
        }, 4000);
        return;
      }

      // Second click within the window: actually delete.
      clearTimeout(timer); // stop the auto-reset timer above from firing after we've already acted
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      const res = await api(`/api/sets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        li.remove(); // remove this task's row from the list entirely
        announce(`Deleted "${title}".`);
        // querySelector returns null if nothing matches - if there's no
        // .task-item left anywhere on the page, the list is now empty.
        if (!document.querySelector('.task-item')) {
          document.getElementById('dashboard-empty').hidden = false;
        }
      } else {
        // Deletion failed server-side - reset the button back to normal
        // rather than leaving it stuck on "Deleting…".
        btn.disabled = false;
        armed = false;
        btn.textContent = 'Delete';
        btn.classList.remove('danger');
      }
    });
  }

  async function renderDashboard() {
    mount(document.getElementById('tpl-dashboard'));
    showNav(true);

    const res = await api('/api/tutor/sets');
    if (res.status === 401) return clearTokenAndGoWelcome(); // token is invalid/expired - back to square one
    const data = await res.json();

    const listEl = document.getElementById('task-list');
    const emptyEl = document.getElementById('dashboard-empty');
    if (!data.sets.length) {
      emptyEl.hidden = false;
    }
    data.sets.forEach((set) => {
      const li = document.createElement('li');
      li.className = 'task-item';
      const title = set.title && set.title.trim() ? set.title : 'Untitled task';
      // innerHTML here is safe because every value we're inserting is a
      // hard-coded literal string, not anything the tutor or student
      // typed - the actual title text is set separately below via
      // .textContent (never via innerHTML), which is what avoids XSS: if
      // someone had typed HTML/script tags into a title, textContent
      // displays it as plain visible text instead of running it.
      li.innerHTML = `
        <div>
          <div class="task-item-title"></div>
          <div class="task-item-meta"></div>
          <button type="button" class="link-btn-inline copy-link-btn">Copy student link</button>
        </div>
        <div class="task-item-actions">
          <a href="#/edit/${encodeURIComponent(set.id)}">Edit</a>
          <a href="#/results/${encodeURIComponent(set.id)}">Results</a>
          <button type="button" class="secondary delete-task-btn">Delete</button>
        </div>
      `;
      li.querySelector('.task-item-title').textContent = title;
      li.querySelector('.task-item-meta').textContent = `Updated ${formatDate(set.updated_at)}`;
      const studentLink = `${location.origin}/index.html?set=${encodeURIComponent(set.id)}`;
      li.querySelector('.copy-link-btn').addEventListener('click', (e) => {
        copyToClipboard(studentLink, e.currentTarget);
      });
      bindDeleteButton(li.querySelector('.delete-task-btn'), set.id, title, li);
      listEl.appendChild(li);
    });

    document.getElementById('new-task-btn').addEventListener('click', () => {
      location.hash = '#/new';
    });
    document.getElementById('show-dashboard-link-btn').addEventListener('click', () => {
      location.hash = '#/save-link';
    });
  }

  // The ready-made task behind the editor's "Start from an example"
  // button. Kept here in the frontend, not seeded into the database: it's
  // just text to pre-fill a form with, so it needs no owner, no id, and
  // nothing on the server.
  const EXAMPLE_TASK = {
    title: 'What makes a good friend?',
    instructions: 'Put the quality you think matters most at the top and the one that matters least at the bottom. Be ready to explain your middle row.',
    cards: [
      'Honesty',
      'Sense of humour',
      'Loyalty',
      'Kindness',
      'Shared interests',
      'Good listener',
      'Reliable',
      'Fun to be with',
      'Popular',
    ],
  };

  // Renders the create/edit form. `existingId` is null for a brand new
  // task, or a task's id string when editing one that already exists -
  // most of this function's logic (loading existing data, wording) branches
  // on that.
  async function renderEditor(existingId) {
    mount(document.getElementById('tpl-editor'));
    showNav(true);
    document.getElementById('editor-heading').textContent = existingId ? 'Edit task' : 'New task';

    const cardFieldsEl = document.getElementById('card-fields');
    const cardInputs = []; // keeps a reference to each card's <input> element, in order, for easy reading later
    for (let i = 0; i < 9; i += 1) {
      const row = document.createElement('div');
      row.className = 'card-field-row';
      row.innerHTML = `
        <span class="card-field-number">${i + 1}.</span>
        <input type="text" class="card-field-text" placeholder="Card text" maxlength="50" aria-label="Card ${i + 1} text" required />
        <span class="char-count card-field-char-count">0 / 50</span>
      `;
      cardFieldsEl.appendChild(row);
      const textInput = row.querySelector('.card-field-text');
      bindCharCount(textInput, row.querySelector('.card-field-char-count'), 50);
      cardInputs.push({
        text: textInput,
      });
    }

    // Live "N / limit" guidance so a tutor can see how much room they have
    // before they hit the server's cap, not just after. This is declared
    // as a nested function (rather than at the top level) because it's
    // only ever used here, inside renderEditor - keeping it local avoids
    // cluttering the rest of the file with something so specific.
    function bindCharCount(inputEl, countEl, limit) {
      const update = () => {
        const len = inputEl.value.length;
        countEl.textContent = `${len} / ${limit}`;
        // toggle's second argument sets the class on/off based on a
        // condition, rather than flipping it - here it turns on a
        // "getting close to the limit" red-text style once past 90%.
        countEl.classList.toggle('char-count-near-limit', len >= limit * 0.9);
      };
      inputEl.addEventListener('input', update); // fires on every keystroke/paste, not just when the field loses focus
      update(); // also run it once immediately, so the counter is correct even before the user types anything
    }
    bindCharCount(document.getElementById('field-title'), document.getElementById('title-char-count'), 200);
    bindCharCount(document.getElementById('field-instructions'), document.getElementById('instructions-char-count'), 1000);

    let currentId = existingId || null;

    // "Start from an example": fills the whole form with a ready-made task
    // so a new tutor can see what a finished one looks like and edit from
    // there. Only offered on a brand-new task - on an existing one it would
    // just be a way to overwrite real work by accident. Nothing is saved
    // until the tutor presses Save, same as if they'd typed it themselves.
    if (!existingId) {
      document.getElementById('example-row').hidden = false;
      document.getElementById('use-example-btn').addEventListener('click', () => {
        const titleEl = document.getElementById('field-title');
        const instructionsEl = document.getElementById('field-instructions');
        const allFields = [titleEl, instructionsEl, ...cardInputs.map((c) => c.text)];
        // If they've already typed something, ask before replacing it.
        const hasText = allFields.some((f) => f.value.trim() !== '');
        if (hasText && !window.confirm('Replace what you have typed with the example?')) return;
        titleEl.value = EXAMPLE_TASK.title;
        instructionsEl.value = EXAMPLE_TASK.instructions;
        EXAMPLE_TASK.cards.forEach((text, i) => {
          cardInputs[i].text.value = text;
        });
        // Same reason as when loading an existing task below: setting
        // .value doesn't fire 'input', so nudge each char counter by hand.
        allFields.forEach((f) => f.dispatchEvent(new Event('input')));
        titleEl.focus();
      });
    }

    if (existingId) {
      // Editing an existing task: fetch its current data and pre-fill the form.
      const res = await fetch(`/api/sets/${existingId}`);
      if (res.ok) {
        const data = await res.json();
        document.getElementById('field-title').value = data.title || '';
        document.getElementById('field-instructions').value = data.instructions || '';
        data.cards.forEach((c, i) => {
          if (cardInputs[i]) {
            cardInputs[i].text.value = c.text || '';
          }
        });
        // Setting .value directly (above) doesn't fire an 'input' event,
        // so the char counters wouldn't know to update themselves -
        // dispatching a synthetic Event('input') tells their listeners
        // "something changed, recalculate", even though no real typing
        // happened.
        document.getElementById('field-title').dispatchEvent(new Event('input'));
        document.getElementById('field-instructions').dispatchEvent(new Event('input'));
        showShareBlock(currentId);
      }
    }

    document.getElementById('task-form').addEventListener('submit', async (e) => {
      e.preventDefault(); // stop the browser's default full-page-reload form submission
      const errorEl = document.getElementById('editor-error');
      const statusEl = document.getElementById('editor-status');
      errorEl.hidden = true;

      const cards = cardInputs.map((c) => ({
        text: c.text.value.trim(),
      }));
      if (cards.some((c) => !c.text)) {
        errorEl.textContent = 'Every card needs text.';
        errorEl.hidden = false;
        return;
      }

      const payload = {
        title: document.getElementById('field-title').value.trim(),
        instructions: document.getElementById('field-instructions').value.trim(),
        cards,
      };

      statusEl.textContent = 'Saving…';
      // Same endpoint shape either way, just PUT (update) vs POST (create)
      // depending on whether this task already has an id.
      const res = currentId
        ? await api(`/api/sets/${currentId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/api/sets', { method: 'POST', body: JSON.stringify(payload) });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorEl.textContent = body.error || 'Could not save. Please try again.';
        errorEl.hidden = false;
        statusEl.textContent = '';
        return;
      }

      if (!currentId) {
        // This was a brand-new task - the server just gave it an id.
        // Update the URL to point at .../edit/<id> without a full page
        // navigation (history.replaceState swaps the URL silently), so
        // reloading the page afterwards keeps editing the same task
        // instead of creating a second one.
        const data = await res.json();
        currentId = data.id;
        history.replaceState(null, '', `#/edit/${currentId}`);
        document.getElementById('editor-heading').textContent = 'Edit task';
        document.getElementById('example-row').hidden = true; // it's a saved task now - same rule as opening an existing one
      }
      statusEl.textContent = 'Saved.';
      announce('Task saved.');
      showShareBlock(currentId);
    });
  }

  // Reveals the "here's your student link" panel at the bottom of the
  // editor, once a task has been saved at least once (so it has an id to
  // build a link from).
  function showShareBlock(id) {
    const block = document.getElementById('share-block');
    block.hidden = false;
    const link = `${location.origin}/index.html?set=${id}`;
    document.getElementById('share-link-input').value = link;
    document.getElementById('copy-share-link-btn').onclick = (e) => copyToClipboard(link, e.currentTarget);
    document.getElementById('view-results-link').href = `#/results/${id}`;

    // The live session reuses the task's own id as its live-room id -
    // one task, one room, kept simple rather than minting a separate id
    // per session. The host link carries the tutor's token so the live
    // page knows to show Reset/End controls; the student link carries no
    // token at all, same "no login, ever" rule as the rest of the app.
    const liveStudentLink = `${location.origin}/live.html?room=${encodeURIComponent(id)}`;
    const liveHostLink = `${liveStudentLink}&token=${encodeURIComponent(getToken())}`;
    document.getElementById('live-student-link-input').value = liveStudentLink;
    document.getElementById('copy-live-link-btn').onclick = (e) => copyToClipboard(liveStudentLink, e.currentTarget);
    document.getElementById('open-live-host-link').href = liveHostLink;

    // Read straight from the title field rather than threading it through
    // as a parameter - showShareBlock always runs on the same editor page
    // this field already lives on, so there's nothing to pass along.
    const title = document.getElementById('field-title').value.trim();
    document.getElementById('show-qr-btn').onclick = () => {
      const qrUrl = `${location.origin}/qr.html?link=${encodeURIComponent(liveStudentLink)}&title=${encodeURIComponent(title)}`;
      window.open(qrUrl, '_blank', 'noopener');
    };
  }

  async function renderResults(id) {
    mount(document.getElementById('tpl-results'));
    showNav(true);

    // Promise.all runs both requests at the same time rather than one
    // after the other, and waits for both to finish before continuing -
    // faster than two separate awaits in sequence, since they don't
    // depend on each other's result.
    const [setRes, resultsRes] = await Promise.all([
      fetch(`/api/sets/${id}`),
      api(`/api/sets/${id}/results`),
    ]);
    if (resultsRes.status === 401) return clearTokenAndGoWelcome();
    if (!setRes.ok || !resultsRes.ok) return;

    const setData = await setRes.json();
    const resultsData = await resultsRes.json();

    document.getElementById('results-heading').textContent =
      setData.title && setData.title.trim() ? `Results — ${setData.title}` : 'Results';

    const listEl = document.getElementById('results-list');
    if (!resultsData.results.length) {
      document.getElementById('results-empty').hidden = false;
      return;
    }

    resultsData.results.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'result-card';

      const header = document.createElement('div');
      header.className = 'result-card-header';
      const name = document.createElement('span');
      name.className = 'result-card-name';
      name.textContent = r.student_name && r.student_name.trim() ? r.student_name : 'Anonymous';
      const time = document.createElement('span');
      time.className = 'result-card-time';
      time.textContent = formatDate(r.submitted_at);
      header.appendChild(name);
      header.appendChild(time);
      card.appendChild(header);

      const ol = document.createElement('ol');
      ol.className = 'result-order';
      for (let i = 0; i < 9; i += 1) {
        // A result's arrangement is stored as {"0": "card-3", "1": null, ...}
        // - object keys are always strings, so we look it up with
        // String(i) even though i itself is a number.
        const cardId = r.arrangement[String(i)];
        const li = document.createElement('li');
        if (cardId) {
          // Card ids from app.js look like "card-3" - splitting on '-' and
          // taking the second half recovers the original array index into
          // setData.cards, which is how we turn the id back into its text.
          const idx = Number(String(cardId).split('-')[1]);
          li.textContent = setData.cards[idx] ? setData.cards[idx].text : '(unknown card)';
        } else {
          li.textContent = '(empty)'; // the student left this position unfilled
        }
        ol.appendChild(li);
      }
      card.appendChild(ol);
      listEl.appendChild(card);
    });
  }

  // --- Router ---
  //
  // This app has no server-rendered pages beyond the one tutor.html file -
  // everything after the # is handled entirely in the browser. route()
  // looks at the current hash and decides which view function to call.
  // Using the URL hash (rather than, say, a plain in-memory variable)
  // means the browser's back/forward buttons and bookmarks/shared links
  // all work naturally, without any extra code.

  function route() {
    const hash = location.hash || '#/';
    const token = getToken();

    if (!token) return renderWelcome(); // not logged in - nothing else matters until they create a tutor space
    if (hash === '#/save-link') return renderSaveLink();
    if (hash === '#/new') return renderEditor(null);

    // .match() against a regular expression: ^#\/edit\/(.+)$ means "the
    // whole string, starting with #/edit/, followed by one-or-more
    // characters" - the parentheses capture that trailing part (the task
    // id) so it can be pulled out as editMatch[1].
    const editMatch = hash.match(/^#\/edit\/(.+)$/);
    if (editMatch) return renderEditor(decodeURIComponent(editMatch[1]));

    const resultsMatch = hash.match(/^#\/results\/(.+)$/);
    if (resultsMatch) return renderResults(decodeURIComponent(resultsMatch[1]));

    return renderDashboard(); // default: logged in, no specific route matched
  }

  // Whenever the URL's hash changes - including via the back/forward
  // buttons, not just our own code setting location.hash - re-run the router.
  window.addEventListener('hashchange', route);

  function boot() {
    const params = new URLSearchParams(location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      // Someone opened their saved dashboard link (?token=...) - log them
      // in using that token instead of whatever (if anything) is already
      // in localStorage.
      setToken(urlToken);
      // Strip the token from the visible URL so it isn't left in browser
      // history or accidentally shared if the tab URL gets copied.
      history.replaceState(null, '', location.pathname + (location.hash || ''));
    }
    route();
  }

  boot();
})();
