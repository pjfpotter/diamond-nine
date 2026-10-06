// Live, shared-board version of app.js. See that file's own comments for
// the parts that are identical in spirit (the FLIP animation, keyboard
// navigation, drag/tap handling) - this file's comments mostly focus on
// what's *different* about running over a network instead of locally.
(function () {
  'use strict';

  const ROW_SIZES = [1, 2, 3, 2, 1];
  const CARD_COLORS = ['coral', 'yellow', 'teal', 'violet'];
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const diamondEl = document.getElementById('diamond');
  const poolEl = document.getElementById('pool');
  const liveRegionEl = document.getElementById('live-region');
  const statusEl = document.getElementById('live-status');
  const titleEl = document.getElementById('set-title');
  const instructionsEl = document.getElementById('set-instructions');
  const presenceEl = document.getElementById('presence-line');
  const joinFormEl = document.getElementById('join-name-form');
  const hostControlsEl = document.getElementById('host-controls');
  const endedBannerEl = document.getElementById('ended-banner');
  const resetBtn = document.getElementById('reset-board-btn');
  const endBtn = document.getElementById('end-session-btn');

  // The room to join - everyone who opens this page with the same
  // ?room=... in the URL ends up on the same shared board. Defaults to a
  // fixed name so two tabs opened with no query string at all still land
  // in the same place, which is convenient for manual testing. In real
  // use, this is a task's own id (see tutor.js's showShareBlock) - one
  // task, one room.
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room') || 'demo-room';
  // Only present on the link the tutor opens for themselves (see
  // tutor.js) - its presence is what shows the Reset/End controls. The
  // server independently re-checks this token is genuinely valid before
  // honouring a reset/end request, so a made-up token here just means the
  // controls show but don't actually do anything - see party/server.js's
  // verifyTutor.
  const tutorToken = params.get('token') || null;
  let isEnded = false;

  // --- Shared state ---
  //
  // Unlike app.js, none of this is ever changed directly by this file in
  // response to a drag/tap/keypress. It only ever gets overwritten
  // wholesale when a 'state' message arrives from the server (see
  // handleServerMessage below). This is the core difference from the
  // solo version: here, the server's copy is the only one that's ever
  // really "true", and this browser just displays whatever it was most
  // recently told.
  let cards = [];
  let slotAssignment = new Array(9).fill(null);
  let pool = [];

  // These, by contrast, stay exactly as they were in app.js: they're
  // purely local interaction state (which card *this* user has clicked to
  // pick up, mid-interaction) - not something that needs to be shared
  // with anyone else, since nobody else can see "you're thinking about
  // moving this card" until you actually drop it somewhere.
  let pickedUpCardId = null;
  let pendingFocusCardId = null;
  let justMovedCardId = null;
  let dragDroppedCardId = null;

  // --- Visible live dragging (stretch goal) ---
  //
  // cardId -> the name of whoever (someone else) is currently dragging
  // it, purely so the real card can show a dimmed "someone else has this"
  // state - never blocks this user from grabbing it anyway (see
  // spec.md: a soft claim, not a lock).
  const remoteClaims = new Map();
  // cardId -> the ghost <div> currently following a remote drag.
  const remoteGhosts = new Map();

  function cardById(id) {
    return cards.find((c) => c.id === id);
  }

  function announce(message) {
    liveRegionEl.textContent = '';
    requestAnimationFrame(() => {
      liveRegionEl.textContent = message;
    });
  }

  function buildSlots() {
    diamondEl.innerHTML = '';
    let i = 0;
    ROW_SIZES.forEach((size) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'diamond-row';
      for (let c = 0; c < size; c += 1) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.slotIndex = String(i);
        slot.setAttribute('role', 'button');
        slot.setAttribute('aria-label', `Empty position ${i + 1} of 9`);
        rowEl.appendChild(slot);
        i += 1;
      }
      diamondEl.appendChild(rowEl);
    });
  }

  function cardColor(cardId) {
    const index = cards.findIndex((c) => c.id === cardId);
    return CARD_COLORS[index % CARD_COLORS.length];
  }

  function makeCardEl(card) {
    const el = document.createElement('div');
    el.className = `card card-${cardColor(card.id)}`;
    el.dataset.cardId = card.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', card.text);
    const textEl = document.createElement('span');
    textEl.className = 'card-text';
    textEl.textContent = card.text;
    el.appendChild(textEl);
    if (card.id === pickedUpCardId) el.classList.add('picked-up');
    if (card.text.length >= 23) el.classList.add('long-text');
    if (remoteClaims.has(card.id)) el.classList.add('remote-claimed');

    let suppressNextEnter = card.id === justMovedCardId;
    el.addEventListener('mouseenter', () => {
      if (!el.closest('.slot')) return;
      if (suppressNextEnter) {
        suppressNextEnter = false;
        return;
      }
      el.classList.add('magnify');
    });
    el.addEventListener('mouseleave', () => {
      el.classList.remove('magnify');
    });
    return el;
  }

  function render() {
    const existingRects = new Map();
    document.querySelectorAll('.card').forEach((el) => {
      existingRects.set(el.dataset.cardId, el.getBoundingClientRect());
    });

    document.querySelectorAll('.slot').forEach((slot) => {
      slot.innerHTML = '';
      slot.classList.remove('drop-target');
    });
    poolEl.innerHTML = '';
    poolEl.classList.remove('drop-target');

    slotAssignment.forEach((cardId, i) => {
      const slot = diamondEl.querySelector(`[data-slot-index="${i}"]`);
      if (!cardId) {
        slot.tabIndex = 0;
        slot.setAttribute('aria-label', `Empty position ${i + 1} of 9`);
        return;
      }
      slot.tabIndex = -1;
      slot.appendChild(makeCardEl(cardById(cardId)));
    });

    pool.forEach((cardId) => {
      poolEl.appendChild(makeCardEl(cardById(cardId)));
    });

    justMovedCardId = null;
    const skipAnimationCardId = dragDroppedCardId;
    dragDroppedCardId = null;

    // Same universal FLIP animation as app.js - and deliberately so. It
    // doesn't know or care whether a card's position changed because
    // *this* user dragged it, or because the server just told us someone
    // else did - it just animates whatever moved. That's what makes
    // another student's move visibly glide into place on your screen for
    // free, with no extra code needed to special-case "remote" moves.
    document.querySelectorAll('.card').forEach((el) => {
      if (el.dataset.cardId === skipAnimationCardId) return;
      const before = existingRects.get(el.dataset.cardId);
      if (!before) return;
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (dx === 0 && dy === 0) return;
      if (prefersReducedMotion) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.2s ease-out';
        el.style.transform = '';
      });
    });

    attachDragHandlers();

    if (pendingFocusCardId) {
      const el = document.querySelector(`.card[data-card-id="${pendingFocusCardId}"]`);
      if (el) el.focus();
      pendingFocusCardId = null;
    }
  }

  function slotIndexOf(cardId) {
    return slotAssignment.indexOf(cardId);
  }

  // The one real behavioural difference from app.js's moveCard(): this
  // function does not touch slotAssignment/pool, and does not call
  // render() itself. It only sends a request to the server - the actual
  // state change (and the resulting re-render, for every connected
  // browser at once) happens when the server's broadcast comes back in
  // handleServerMessage(). This is what makes last-write-wins work: this
  // browser never assumes its own move succeeded until the server
  // confirms it by broadcasting the new state.
  function requestMove(cardId, target) {
    if (isEnded) return; // board is frozen once the host has ended the session
    dragDroppedCardId = null; // only the drag-release path sets this, see onPointerUp
    justMovedCardId = target !== 'pool' ? cardId : null;
    send({ type: 'move', cardId, target });
  }

  // --- Pick up / place: identical logic to app.js, swapping moveCard()
  // for requestMove() ---

  function setPicking(on) {
    document.body.classList.toggle('picking', on);
  }

  function releasePickup(message) {
    pickedUpCardId = null;
    document.querySelectorAll('.card').forEach((el) => el.classList.remove('picked-up'));
    setPicking(false);
    if (message) announce(message);
  }

  function handleActivateCard(cardId) {
    if (isEnded) return;
    if (!pickedUpCardId) {
      pickedUpCardId = cardId;
      document.querySelectorAll('.card').forEach((el) => {
        el.classList.toggle('picked-up', el.dataset.cardId === cardId);
      });
      setPicking(true);
      announce(`Picked up "${cardById(cardId).text}". Choose another card to swap with it, or an empty position, then press Enter. Press Escape to cancel.`);
      return;
    }
    if (pickedUpCardId === cardId) {
      releasePickup('Put back down. Nothing moved.');
      return;
    }
    const saved = pickedUpCardId;
    const pickedText = cardById(saved).text;
    const targetText = cardById(cardId).text;
    const targetSlot = slotIndexOf(cardId);
    const target = targetSlot !== -1 ? targetSlot : 'pool';
    pickedUpCardId = null;
    setPicking(false);
    pendingFocusCardId = saved;
    requestMove(saved, target);
    announce(`Placed "${pickedText}", swapped with "${targetText}".`);
  }

  function handleActivateSlot(slotIndex) {
    if (isEnded) return;
    if (!pickedUpCardId) {
      announce('Empty position. Pick up a card first, then choose a position to place it.');
      return;
    }
    const saved = pickedUpCardId;
    const text = cardById(saved).text;
    pickedUpCardId = null;
    setPicking(false);
    pendingFocusCardId = saved;
    requestMove(saved, slotIndex);
    announce(`Placed "${text}" in position ${slotIndex + 1} of 9.`);
  }

  // --- Keyboard navigation: identical to app.js ---

  function getFocusableItems() {
    const items = [];
    poolEl.querySelectorAll('.card').forEach((el) => items.push(el));
    for (let i = 0; i < 9; i += 1) {
      const slotEl = diamondEl.querySelector(`[data-slot-index="${i}"]`);
      const cardEl = slotEl.querySelector('.card');
      items.push(cardEl || slotEl);
    }
    return items;
  }

  function onKeyDown(e) {
    const cardEl = e.target.closest('.card');
    const slotEl = !cardEl ? e.target.closest('.slot') : null;
    if (!cardEl && !slotEl) return;
    const currentEl = cardEl || slotEl;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const items = getFocusableItems();
      const idx = items.indexOf(currentEl);
      if (idx !== -1) items[(idx + 1) % items.length].focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = getFocusableItems();
      const idx = items.indexOf(currentEl);
      if (idx !== -1) items[(idx - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (cardEl) handleActivateCard(cardEl.dataset.cardId);
      else handleActivateSlot(Number(slotEl.dataset.slotIndex));
    } else if (e.key === 'Escape' && pickedUpCardId) {
      e.preventDefault();
      releasePickup('Cancelled. Card stays where it was.');
    }
  }

  // --- Pointer-based drag (mouse) with tap-to-place fallback: identical
  // to app.js, swapping moveCard() for requestMove() ---

  const DRAG_THRESHOLD = 6;
  let dragState = null;

  function attachDragHandlers() {
    document.querySelectorAll('.card').forEach((el) => {
      el.addEventListener('pointerdown', onPointerDown);
    });
  }

  function onPointerDown(e) {
    if (isEnded) return;
    if (e.button !== undefined && e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    dragState = {
      el,
      cardId: el.dataset.cardId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      dragging: false,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function beginDrag(e) {
    const { el } = dragState;
    el.classList.remove('magnify');
    const rect = el.getBoundingClientRect();
    dragState.dragging = true;
    dragState.offsetX = e.clientX - rect.left;
    dragState.offsetY = e.clientY - rect.top;
    dragState.lastDragMoveSent = 0;
    el.classList.add('dragging');
    el.style.position = 'fixed';
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    el.style.zIndex = '60';
    send({ type: 'drag-start', cardId: dragState.cardId });
  }

  // Converts a pixel position into a percentage of .layout's own bounding
  // box, and back again. Raw pixels aren't meaningful across different
  // browsers/screens - someone's cursor at x=900 on a 1920px-wide monitor
  // is nowhere near x=900 on a 1366px laptop. Percentages of the same
  // reference element are what let a position mean the same *visual* spot
  // regardless of window size. See spec.md's stretch-goal section.
  function toLayoutPct(leftPx, topPx) {
    const layoutRect = document.querySelector('.layout').getBoundingClientRect();
    return {
      xPct: (leftPx - layoutRect.left) / layoutRect.width,
      yPct: (topPx - layoutRect.top) / layoutRect.height,
    };
  }

  function fromLayoutPct(xPct, yPct) {
    const layoutRect = document.querySelector('.layout').getBoundingClientRect();
    return {
      leftPx: layoutRect.left + xPct * layoutRect.width,
      topPx: layoutRect.top + yPct * layoutRect.height,
    };
  }

  function onPointerMove(e) {
    if (!dragState) return;
    if (!dragState.dragging) {
      const dx = e.clientX - dragState.startClientX;
      const dy = e.clientY - dragState.startClientY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      beginDrag(e);
    }
    const leftPx = e.clientX - dragState.offsetX;
    const topPx = e.clientY - dragState.offsetY;
    dragState.el.style.left = `${leftPx}px`;
    dragState.el.style.top = `${topPx}px`;

    // Throttled to ~20 times a second - raw pointermove can fire well
    // past 60/sec, and broadcasting every single one (times however many
    // people are dragging at once) is wasted room traffic for motion
    // nobody could perceive the difference in anyway.
    const now = performance.now();
    if (now - dragState.lastDragMoveSent >= 50) {
      dragState.lastDragMoveSent = now;
      const { xPct, yPct } = toLayoutPct(leftPx, topPx);
      send({ type: 'drag-move', cardId: dragState.cardId, xPct, yPct });
    }

    document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
    const dropZone = findDropZone(e.clientX, e.clientY);
    if (dropZone) dropZone.classList.add('drop-target');
  }

  function onPointerUp(e) {
    if (!dragState) return;
    const { el, cardId, dragging } = dragState;

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));

    if (!dragging) {
      dragState = null;
      handleActivateCard(cardId);
      return;
    }

    // Sent on every drag release, whether or not it produced a real move
    // (e.g. dropped off-board) - this is what tells everyone else to
    // remove the ghost. A 'move' message (and the 'state' broadcast that
    // follows it) only happens on a *successful* drop, so relying on that
    // alone would leave a stale ghost on-screen forever after an invalid one.
    send({ type: 'drag-end', cardId });

    const dropZone = findDropZone(e.clientX, e.clientY);
    el.classList.remove('dragging');
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.width = '';
    el.style.height = '';
    el.style.zIndex = '';
    dragState = null;

    if (!dropZone) {
      render(); // released somewhere invalid - re-render from the last known server state to snap back
      return;
    }

    dragDroppedCardId = cardId;
    if (dropZone.classList.contains('pool')) {
      requestMove(cardId, 'pool');
    } else {
      requestMove(cardId, Number(dropZone.dataset.slotIndex));
    }
  }

  function findDropZone(x, y) {
    const els = document.elementsFromPoint(x, y);
    return els.find((n) => n.classList.contains('slot') || n.id === 'pool') || null;
  }

  diamondEl.addEventListener('click', (e) => {
    const slotEl = e.target.closest('.slot');
    if (slotEl && e.target === slotEl) {
      handleActivateSlot(Number(slotEl.dataset.slotIndex));
    }
  });

  diamondEl.addEventListener('keydown', onKeyDown);
  poolEl.addEventListener('keydown', onKeyDown);

  // --- Networking ---
  //
  // Plain WebSocket is enough for this build stage - PartyKit's own
  // reconnecting client (partysocket) is a reasonable upgrade later for
  // real-world flakiness (phones locking, WiFi drops), but isn't needed
  // yet to prove the shared-board sync itself works.

  let ws = null;

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function setStatus(connected) {
    if (connected) {
      statusEl.textContent = `Connected — sharing room "${roomId}"`;
      statusEl.classList.add('connected');
      statusEl.classList.remove('disconnected');
    } else {
      statusEl.textContent = 'Disconnected — trying to reconnect…';
      statusEl.classList.add('disconnected');
      statusEl.classList.remove('connected');
    }
  }

  function handleServerMessage(event) {
    const data = JSON.parse(event.data);
    if (data.type === 'state') {
      cards = data.cards;
      slotAssignment = data.slotAssignment;
      pool = data.pool;
      if (data.title && data.title.trim()) {
        titleEl.textContent = data.title;
      }
      instructionsEl.textContent = data.instructions || '';
      render();

      if (data.ended && !isEnded) {
        isEnded = true;
        endedBannerEl.hidden = false;
        hostControlsEl.hidden = true; // nothing left to reset/end once it's over
        releasePickup();
        remoteGhosts.forEach((ghost) => ghost.remove());
        remoteGhosts.clear();
        remoteClaims.clear();
        announce('The host has ended this session. The board is now read-only.');
      }
    } else if (data.type === 'presence') {
      presenceEl.textContent = data.names.length
        ? `${data.names.length} ${data.names.length === 1 ? 'person' : 'people'} here: ${data.names.join(', ')}`
        : 'Waiting for others to join…';
    } else if (data.type === 'drag-start') {
      remoteClaims.set(data.cardId, data.name || '');
      const el = document.querySelector(`.card[data-card-id="${data.cardId}"]`);
      if (el) el.classList.add('remote-claimed');
    } else if (data.type === 'drag-move') {
      showGhost(data.cardId, data.xPct, data.yPct);
    } else if (data.type === 'drag-end') {
      remoteClaims.delete(data.cardId);
      const el = document.querySelector(`.card[data-card-id="${data.cardId}"]`);
      if (el) el.classList.remove('remote-claimed');
      removeGhost(data.cardId);
    }
  }

  // Creates (on first move) or repositions (on every move after) the
  // ghost card for someone else's in-progress drag. This never touches
  // the real card element or the real board state - it's a purely
  // additive overlay, which is what keeps this stretch goal from having
  // to change anything about how the already-tested board sync works.
  function showGhost(cardId, xPct, yPct) {
    let ghost = remoteGhosts.get(cardId);
    if (!ghost) {
      const card = cardById(cardId);
      if (!card) return; // state for this card hasn't loaded yet - ignore until it has
      ghost = document.createElement('div');
      ghost.className = `card card-${cardColor(cardId)} ghost-card`;
      const textEl = document.createElement('span');
      textEl.className = 'card-text';
      textEl.textContent = card.text;
      ghost.appendChild(textEl);
      const nameTag = document.createElement('span');
      nameTag.className = 'ghost-name-tag';
      nameTag.textContent = remoteClaims.get(cardId) || 'Someone';
      ghost.appendChild(nameTag);
      document.body.appendChild(ghost);
      remoteGhosts.set(cardId, ghost);
    }
    const { leftPx, topPx } = fromLayoutPct(xPct, yPct);
    ghost.style.left = `${leftPx}px`;
    ghost.style.top = `${topPx}px`;
  }

  function removeGhost(cardId) {
    const ghost = remoteGhosts.get(cardId);
    if (ghost) {
      ghost.remove();
      remoteGhosts.delete(cardId);
    }
  }

  // --- Joining with an optional display name ---
  //
  // Dragging/placing cards works immediately regardless of whether this
  // form has been submitted yet - a name is purely for the presence list
  // (so people can see who else is here), never a requirement to
  // participate, same "optional, never a login" rule the rest of the app
  // follows for students.
  joinFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('join-name-input').value.trim();
    send({ type: 'join', name });
    joinFormEl.hidden = true;
  });

  // --- Host controls (only meaningful if a tutor token was in the URL -
  // see tutor.js's showShareBlock for where that link comes from) ---

  if (tutorToken) {
    hostControlsEl.hidden = false;
  }

  resetBtn.addEventListener('click', () => {
    send({ type: 'reset', token: tutorToken });
  });

  // End session is one-way and freezes the board for everyone, so it uses
  // the same two-click arm/confirm pattern as tutor.js's delete button,
  // rather than a native confirm() dialog (kept consistent with the rest
  // of this app - see CLAUDE.md on why native dialogs were avoided).
  let endArmed = false;
  let endArmTimer = null;
  endBtn.addEventListener('click', () => {
    if (!endArmed) {
      endArmed = true;
      endBtn.textContent = 'Really submit & end?';
      endBtn.classList.add('danger');
      endArmTimer = setTimeout(() => {
        endArmed = false;
        endBtn.textContent = 'Submit & end session';
        endBtn.classList.remove('danger');
      }, 4000);
      return;
    }
    clearTimeout(endArmTimer);
    send({ type: 'end', token: tutorToken });
  });

  // ws://127.0.0.1:8787 is `wrangler dev`'s local address for this
  // project's Worker. In production this points at the deployed Worker
  // instead - selected by hostname so the same committed code works in
  // both places without an env file the static frontend could read.
  const LIVE_SERVER_HOST = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? '127.0.0.1:8787'
    : 'diamond-nine-live.pjpotter.workers.dev';
  const LIVE_SERVER_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';

  function connect() {
    ws = new WebSocket(`${LIVE_SERVER_PROTOCOL}//${LIVE_SERVER_HOST}/party/${encodeURIComponent(roomId)}`);
    ws.addEventListener('open', () => setStatus(true));
    ws.addEventListener('close', () => {
      setStatus(false);
      // Our own connection just dropped - any ghosts/claims we were
      // tracking came from the room we just lost touch with, and will be
      // re-sent fresh (or not, if those drags already ended) once we're
      // back. Clear them now rather than risk a stale ghost stuck on
      // screen through a reconnect.
      remoteGhosts.forEach((ghost) => ghost.remove());
      remoteGhosts.clear();
      remoteClaims.clear();
      setTimeout(connect, 1000); // simple fixed-delay reconnect attempt
    });
    ws.addEventListener('message', handleServerMessage);
  }

  // --- Boot ---

  buildSlots();
  connect();
})();
