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

  let cards = DEMO_CARDS;
  let setId = new URLSearchParams(location.search).get('set');

  // slotAssignment[i] = cardId currently in diamond slot i, or null
  let slotAssignment = new Array(9).fill(null);
  // ids of cards still sitting in the pool
  let pool = [];

  function initState() {
    slotAssignment = new Array(9).fill(null);
    pool = cards.map((c) => c.id);
  }

  function cardById(id) {
    return cards.find((c) => c.id === id);
  }

  function buildSlots() {
    diamondEl.innerHTML = '';
    SLOT_LAYOUT.forEach((pos, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.slotIndex = String(i);
      slot.dataset.row = String(pos.row);
      slot.dataset.col = String(pos.col);
      slot.setAttribute('role', 'group');
      slot.setAttribute('aria-label', `Diamond position ${i + 1} of 9`);
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
      if (!cardId) return;
      const slot = diamondEl.querySelector(`[data-slot-index="${i}"]`);
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
  }

  function updateSubmitState() {
    const allPlaced = slotAssignment.every((v) => v !== null);
    submitBtn.disabled = !allPlaced;
    submitHint.textContent = allPlaced
      ? 'Ready to submit.'
      : `Place all 9 cards to enable submitting (${pool.length} remaining).`;
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

  // --- Pointer-based drag (works for mouse and touch) ---

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
    const rect = el.getBoundingClientRect();
    dragState = {
      el,
      cardId: el.dataset.cardId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      startX: rect.left,
      startY: rect.top,
      width: rect.width,
      height: rect.height,
    };
    el.classList.add('dragging');
    el.style.position = 'fixed';
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.zIndex = '10';

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e) {
    if (!dragState) return;
    dragState.el.style.left = `${e.clientX - dragState.offsetX}px`;
    dragState.el.style.top = `${e.clientY - dragState.offsetY}px`;

    document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
    const dropZone = findDropZone(e.clientX, e.clientY);
    if (dropZone) dropZone.classList.add('drop-target');
  }

  function onPointerUp(e) {
    if (!dragState) return;
    const { el, cardId } = dragState;
    const dropZone = findDropZone(e.clientX, e.clientY);

    el.classList.remove('dragging');
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.width = '';
    el.style.zIndex = '';

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
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

  // --- Submit ---

  submitBtn.addEventListener('click', async () => {
    const arrangement = {};
    slotAssignment.forEach((cardId, i) => {
      arrangement[i] = cardId;
    });

    if (!setId) {
      console.log('Demo mode (no ?set= in URL) — final arrangement:', arrangement);
      alert('Demo mode: no set loaded from the server, so nothing was saved. See console for the arrangement.');
      return;
    }

    const studentName = prompt('Your name (optional):') || undefined;
    const res = await fetch(`/api/sets/${setId}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_name: studentName, arrangement }),
    });
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
