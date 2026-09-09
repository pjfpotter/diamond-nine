(function () {
  'use strict';

  const DEMO_CARDS = [
    { id: 'c1', text: 'Everyone should get the same reward regardless of effort' },
    { id: 'c2', text: 'Rules should always be followed, no exceptions' },
    { id: 'c3', text: 'Honesty matters more than sparing someone’s feelings' },
    { id: 'c4', text: 'The needs of the group outweigh the needs of one person' },
    { id: 'c5', text: 'People deserve a second chance after a mistake' },
    { id: 'c6', text: 'Some traditions should change even if they’re old' },
    { id: 'c7', text: 'It’s fair to treat people differently based on need' },
    { id: 'c8', text: 'Freedom of choice matters more than following advice' },
    { id: 'c9', text: 'Standing up for what’s right is worth the cost' },
  ];

  // Diamond shape: rows of 1-2-3-2-1 slots, indexed 0..8 in that order.
  const SLOT_LAYOUT = [
    { row: 1, col: 0 },
    { row: 2, col: 0 }, { row: 2, col: 1 },
    { row: 3, col: 0 }, { row: 3, col: 1 }, { row: 3, col: 2 },
    { row: 4, col: 0 }, { row: 4, col: 1 },
    { row: 5, col: 0 },
  ];

  const diamondEl = document.getElementById('diamond');
  const poolEl = document.getElementById('pool');
  const submitBtn = document.getElementById('submit-btn');
  const submitHint = document.getElementById('submit-hint');
  const titleEl = document.getElementById('set-title');
  const instructionsEl = document.getElementById('set-instructions');
  const liveRegionEl = document.getElementById('live-region');
  const confirmModal = document.getElementById('confirm-modal');
  const confirmList = document.getElementById('confirm-list');
  const confirmBack = document.getElementById('confirm-back');
  const confirmSend = document.getElementById('confirm-send');

  let cards = DEMO_CARDS;
  let setId = new URLSearchParams(location.search).get('set');

  // slotAssignment[i] = cardId currently in diamond slot i, or null
  let slotAssignment = new Array(9).fill(null);
  // ids of cards still sitting in the pool
  let pool = [];

  // The card currently "picked up" via click/tap/keyboard (not mouse-dragged).
  // Choosing any other card or an empty slot places it there.
  let pickedUpCardId = null;
  // After a keyboard/tap-triggered move, render() should refocus this card.
  let pendingFocusCardId = null;

  function initState() {
    slotAssignment = new Array(9).fill(null);
    pool = cards.map((c) => c.id);
  }

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
    SLOT_LAYOUT.forEach((pos, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.slotIndex = String(i);
      slot.dataset.row = String(pos.row);
      slot.dataset.col = String(pos.col);
      slot.setAttribute('role', 'button');
      slot.setAttribute('aria-label', `Empty position ${i + 1} of 9`);
      diamondEl.appendChild(slot);
    });
  }

  function makeCardEl(card) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.cardId = card.id;
    el.tabIndex = 0;
    el.textContent = card.text;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', card.text);
    if (card.id === pickedUpCardId) el.classList.add('picked-up');
    return el;
  }

  // Render places every card element into its current slot/pool container.
  // Positions used for the FLIP animation are captured by the caller before
  // calling render(), then diffed against post-render positions.
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

    // FLIP: for any card whose position changed, animate from old to new.
    document.querySelectorAll('.card').forEach((el) => {
      const before = existingRects.get(el.dataset.cardId);
      if (!before) return;
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (dx === 0 && dy === 0) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.2s ease';
        el.style.transform = '';
      });
    });

    updateSubmitState();
    attachDragHandlers();

    if (pendingFocusCardId) {
      const el = document.querySelector(`.card[data-card-id="${pendingFocusCardId}"]`);
      if (el) el.focus();
      pendingFocusCardId = null;
    }
  }

  function updateSubmitState() {
    const placed = 9 - pool.length;
    const allPlaced = placed === 9;
    submitBtn.disabled = !allPlaced;
    submitHint.textContent = allPlaced
      ? 'All 9 placed — ready to submit.'
      : `${placed} of 9 placed.`;
  }

  function slotIndexOf(cardId) {
    return slotAssignment.indexOf(cardId);
  }

  // Moves `cardId` into target (a slot index or 'pool'), swapping with
  // whatever already occupies that spot back to the card's origin.
  function moveCard(cardId, target) {
    const fromSlot = slotIndexOf(cardId);
    const fromPool = pool.includes(cardId);

    let displaced = null;
    if (target === 'pool') {
      displaced = null; // pool has no fixed capacity, no swap needed
    } else {
      displaced = slotAssignment[target];
      if (displaced === cardId) return; // dropped on itself
    }

    if (fromSlot !== -1) slotAssignment[fromSlot] = null;
    if (fromPool) pool = pool.filter((id) => id !== cardId);

    if (target === 'pool') {
      pool.push(cardId);
    } else {
      slotAssignment[target] = cardId;
      if (displaced) {
        if (fromSlot !== -1) {
          slotAssignment[fromSlot] = displaced;
        } else {
          pool.push(displaced);
        }
      }
    }

    render();
  }

  // --- Pick up / place: shared by click, tap, and keyboard ---
  //
  // This is the accessible alternative to dragging: activate a card to pick
  // it up, then activate any other card (to swap) or empty slot to place it.
  // Activating the picked-up card again cancels the pickup.

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
    moveCard(saved, target);
    announce(`Placed "${pickedText}", swapped with "${targetText}".`);
  }

  function handleActivateSlot(slotIndex) {
    if (!pickedUpCardId) {
      announce('Empty position. Pick up a card first, then choose a position to place it.');
      return;
    }
    const saved = pickedUpCardId;
    const text = cardById(saved).text;
    pickedUpCardId = null;
    setPicking(false);
    pendingFocusCardId = saved;
    moveCard(saved, slotIndex);
    announce(`Placed "${text}" in position ${slotIndex + 1} of 9.`);
  }

  // --- Keyboard navigation: Tab reaches every card/empty slot; arrow keys
  // jump directly between them; Enter/Space activates; Escape cancels. ---

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

  // --- Pointer-based drag (mouse) with a tap-to-place fallback (touch/click) ---
  //
  // A press that never moves past a small threshold is treated as a tap
  // (pick up / place), same as keyboard activation. Only a press that moves
  // further becomes a drag.

  const DRAG_THRESHOLD = 6;
  let dragState = null;

  function attachDragHandlers() {
    document.querySelectorAll('.card').forEach((el) => {
      el.addEventListener('pointerdown', onPointerDown);
    });
  }

  function onPointerDown(e) {
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
    const rect = el.getBoundingClientRect();
    dragState.dragging = true;
    dragState.offsetX = e.clientX - rect.left;
    dragState.offsetY = e.clientY - rect.top;
    el.classList.add('dragging');
    el.style.position = 'fixed';
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.zIndex = '60';
  }

  function onPointerMove(e) {
    if (!dragState) return;
    if (!dragState.dragging) {
      const dx = e.clientX - dragState.startClientX;
      const dy = e.clientY - dragState.startClientY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      beginDrag(e);
    }
    dragState.el.style.left = `${e.clientX - dragState.offsetX}px`;
    dragState.el.style.top = `${e.clientY - dragState.offsetY}px`;

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

    const dropZone = findDropZone(e.clientX, e.clientY);
    el.classList.remove('dragging');
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.width = '';
    el.style.zIndex = '';
    dragState = null;

    if (!dropZone) {
      render(); // snap back
      return;
    }

    if (dropZone.classList.contains('pool')) {
      moveCard(cardId, 'pool');
    } else {
      moveCard(cardId, Number(dropZone.dataset.slotIndex));
    }
  }

  function findDropZone(x, y) {
    const els = document.elementsFromPoint(x, y);
    return els.find((n) => n.classList.contains('slot') || n.id === 'pool') || null;
  }

  // Clicking directly on an empty slot's own area (not a card inside it)
  // places a picked-up card there — the tap/click counterpart to Enter.
  diamondEl.addEventListener('click', (e) => {
    const slotEl = e.target.closest('.slot');
    if (slotEl && e.target === slotEl) {
      handleActivateSlot(Number(slotEl.dataset.slotIndex));
    }
  });

  diamondEl.addEventListener('keydown', onKeyDown);
  poolEl.addEventListener('keydown', onKeyDown);

  // --- Submit, with a confirm-before-sending review step ---

  function openConfirmModal() {
    confirmList.innerHTML = '';
    slotAssignment.forEach((cardId, i) => {
      const li = document.createElement('li');
      li.textContent = cardById(cardId).text;
      confirmList.appendChild(li);
    });
    confirmModal.hidden = false;
    confirmSend.focus();
    document.addEventListener('keydown', onModalKeyDown);
  }

  function closeConfirmModal() {
    confirmModal.hidden = true;
    document.removeEventListener('keydown', onModalKeyDown);
    submitBtn.focus();
  }

  function onModalKeyDown(e) {
    if (e.key === 'Escape') closeConfirmModal();
  }

  submitBtn.addEventListener('click', () => {
    if (submitBtn.disabled) return;
    openConfirmModal();
  });

  confirmBack.addEventListener('click', closeConfirmModal);

  confirmSend.addEventListener('click', async () => {
    const arrangement = {};
    slotAssignment.forEach((cardId, i) => {
      arrangement[i] = cardId;
    });

    if (!setId) {
      console.log('Demo mode (no ?set= in URL) — final arrangement:', arrangement);
      closeConfirmModal();
      alert('Demo mode: no set loaded from the server, so nothing was saved. See console for the arrangement.');
      return;
    }

    const studentName = prompt('Your name (optional):') || undefined;
    const res = await fetch(`/api/sets/${setId}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_name: studentName, arrangement }),
    });
    closeConfirmModal();
    if (res.ok) {
      alert('Submitted, thank you!');
    } else {
      const body = await res.json().catch(() => ({}));
      alert(`Could not submit: ${body.error || res.statusText}`);
    }
  });

  // --- Boot ---

  async function boot() {
    buildSlots();
    if (setId) {
      try {
        const res = await fetch(`/api/sets/${setId}`);
        if (res.ok) {
          const data = await res.json();
          cards = data.cards.map((c, i) => ({ id: `card-${i}`, text: c.text }));
          titleEl.textContent = data.title || 'Diamond Nine';
          if (data.instructions) instructionsEl.textContent = data.instructions;
        } else {
          console.warn('Could not load set, falling back to demo cards');
        }
      } catch (err) {
        console.warn('Could not reach server, falling back to demo cards', err);
      }
    }
    initState();
    render();
  }

  boot();
})();
