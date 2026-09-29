(function () {
  'use strict';

  const TOKEN_KEY = 'diamond9_tutor_token';

  const appEl = document.getElementById('app');
  const navEl = document.getElementById('tutor-nav');
  const liveRegionEl = document.getElementById('live-region');

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

  function announce(message) {
    liveRegionEl.textContent = '';
    requestAnimationFrame(() => {
      liveRegionEl.textContent = message;
    });
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = getToken();
    if (token) headers['X-Tutor-Token'] = token;
    return fetch(path, Object.assign({}, opts, { headers }));
  }

  function mount(tpl) {
    appEl.innerHTML = '';
    appEl.appendChild(tpl.content.cloneNode(true));
  }

  function showNav(show) {
    navEl.hidden = !show;
  }

  function dashboardLink() {
    return `${location.origin}${location.pathname}?token=${encodeURIComponent(getToken())}`;
  }

  function formatDate(sqliteDatetime) {
    const iso = String(sqliteDatetime).replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? sqliteDatetime : d.toLocaleString();
  }

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

  function renderWelcome() {
    mount(document.getElementById('tpl-welcome'));
    showNav(false);
    document.getElementById('create-space-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
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
      location.hash = '#/save-link';
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
    let timer = null;

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

      clearTimeout(timer);
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      const res = await api(`/api/sets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        li.remove();
        announce(`Deleted "${title}".`);
        if (!document.querySelector('.task-item')) {
          document.getElementById('dashboard-empty').hidden = false;
        }
      } else {
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
    if (res.status === 401) return clearTokenAndGoWelcome();
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
      li.innerHTML = `
        <div>
          <div class="task-item-title"></div>
          <div class="task-item-meta"></div>
        </div>
        <div class="task-item-actions">
          <a href="#/edit/${encodeURIComponent(set.id)}">Edit</a>
          <a href="#/results/${encodeURIComponent(set.id)}">Results</a>
          <button type="button" class="secondary delete-task-btn">Delete</button>
        </div>
      `;
      li.querySelector('.task-item-title').textContent = title;
      li.querySelector('.task-item-meta').textContent = `Updated ${formatDate(set.updated_at)}`;
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

  async function renderEditor(existingId) {
    mount(document.getElementById('tpl-editor'));
    showNav(true);
    document.getElementById('editor-heading').textContent = existingId ? 'Edit task' : 'New task';

    const cardFieldsEl = document.getElementById('card-fields');
    const cardInputs = [];
    for (let i = 0; i < 9; i += 1) {
      const row = document.createElement('div');
      row.className = 'card-field-row';
      row.innerHTML = `
        <span class="card-field-number">${i + 1}.</span>
        <input type="text" class="card-field-text" placeholder="Card text" maxlength="500" aria-label="Card ${i + 1} text" required />
        <input type="text" class="card-field-image" placeholder="Image URL (optional)" aria-label="Card ${i + 1} image URL (optional)" />
      `;
      cardFieldsEl.appendChild(row);
      cardInputs.push({
        text: row.querySelector('.card-field-text'),
        image: row.querySelector('.card-field-image'),
      });
    }

    let currentId = existingId || null;

    if (existingId) {
      const res = await fetch(`/api/sets/${existingId}`);
      if (res.ok) {
        const data = await res.json();
        document.getElementById('field-title').value = data.title || '';
        document.getElementById('field-instructions').value = data.instructions || '';
        document.getElementById('field-font').value = data.font || 'lexend';
        document.getElementById('field-font-size').value = data.font_size || 'medium';
        document.getElementById('field-colour-scheme').value = data.colour_scheme || 'cream-navy';
        data.cards.forEach((c, i) => {
          if (cardInputs[i]) {
            cardInputs[i].text.value = c.text || '';
            cardInputs[i].image.value = c.image_url || '';
          }
        });
        showShareBlock(currentId);
      }
    }

    document.getElementById('task-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('editor-error');
      const statusEl = document.getElementById('editor-status');
      errorEl.hidden = true;

      const cards = cardInputs.map((c) => ({
        text: c.text.value.trim(),
        image_url: c.image.value.trim(),
      }));
      if (cards.some((c) => !c.text)) {
        errorEl.textContent = 'Every card needs text.';
        errorEl.hidden = false;
        return;
      }

      const payload = {
        title: document.getElementById('field-title').value.trim(),
        instructions: document.getElementById('field-instructions').value.trim(),
        font: document.getElementById('field-font').value,
        font_size: document.getElementById('field-font-size').value,
        colour_scheme: document.getElementById('field-colour-scheme').value,
        cards,
      };

      statusEl.textContent = 'Saving…';
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
        const data = await res.json();
        currentId = data.id;
        history.replaceState(null, '', `#/edit/${currentId}`);
        document.getElementById('editor-heading').textContent = 'Edit task';
      }
      statusEl.textContent = 'Saved.';
      announce('Task saved.');
      showShareBlock(currentId);
    });
  }

  function showShareBlock(id) {
    const block = document.getElementById('share-block');
    block.hidden = false;
    const link = `${location.origin}/index.html?set=${id}`;
    document.getElementById('share-link-input').value = link;
    document.getElementById('copy-share-link-btn').onclick = (e) => copyToClipboard(link, e.currentTarget);
    document.getElementById('view-results-link').href = `#/results/${id}`;
  }

  async function renderResults(id) {
    mount(document.getElementById('tpl-results'));
    showNav(true);

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
        const cardId = r.arrangement[String(i)];
        const li = document.createElement('li');
        if (cardId) {
          const idx = Number(String(cardId).split('-')[1]);
          li.textContent = setData.cards[idx] ? setData.cards[idx].text : '(unknown card)';
        } else {
          li.textContent = '(empty)';
        }
        ol.appendChild(li);
      }
      card.appendChild(ol);
      listEl.appendChild(card);
    });
  }

  // --- Router ---

  function route() {
    const hash = location.hash || '#/';
    const token = getToken();

    if (!token) return renderWelcome();
    if (hash === '#/save-link') return renderSaveLink();
    if (hash === '#/new') return renderEditor(null);

    const editMatch = hash.match(/^#\/edit\/(.+)$/);
    if (editMatch) return renderEditor(decodeURIComponent(editMatch[1]));

    const resultsMatch = hash.match(/^#\/results\/(.+)$/);
    if (resultsMatch) return renderResults(decodeURIComponent(resultsMatch[1]));

    return renderDashboard();
  }

  window.addEventListener('hashchange', route);

  function boot() {
    const params = new URLSearchParams(location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      setToken(urlToken);
      // Strip the token from the visible URL so it isn't left in browser
      // history or accidentally shared if the tab URL gets copied.
      history.replaceState(null, '', location.pathname + (location.hash || ''));
    }
    route();
  }

  boot();
})();
