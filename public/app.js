// This whole file is wrapped in an IIFE (Immediately Invoked Function
// Expression) - the `(function () { ... })()` pattern. Everything declared
// inside only exists inside this function, so it can't collide with
// variables from other scripts on the page. This is the "module pattern",
// commonly used before JavaScript had real modules (import/export).
(function () {
  'use strict'; // opts into stricter JS rules (catches common mistakes, e.g. typo'd variable names creating globals)

  // Fallback content shown when this page is opened without a real task
  // link (no ?set=... in the URL) - e.g. when just poking at index.html
  // directly during development. See boot() near the bottom.
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
  // Each row is its own tightly-packed group (see buildSlots) so the shape
  // reads as an actual diamond, not a grid with card-sized holes in it.
  const ROW_SIZES = [1, 2, 3, 2, 1];

  // Stable per-card colors (by card id) so a card keeps its color as it
  // moves between the pool and the diamond.
  const CARD_COLORS = ['coral', 'yellow', 'teal', 'violet'];

  // matchMedia lets JS ask the browser about a CSS media query. Some users
  // set "reduce motion" in their OS accessibility settings because
  // animation makes them dizzy/uncomfortable - we check that once up front
  // and skip animations later wherever this is true (see render()).
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Grab every DOM element we'll need once, up front, rather than
  // re-querying document.getElementById() every time we use them. These
  // ids all come from index.html.
  const diamondEl = document.getElementById('diamond');
  const poolEl = document.getElementById('pool');
  const submitBtn = document.getElementById('submit-btn');
  const resetBtn = document.getElementById('reset-btn');
  const submitHint = document.getElementById('submit-hint');
  const titleEl = document.getElementById('set-title');
  const instructionsEl = document.getElementById('set-instructions');
  const liveRegionEl = document.getElementById('live-region');
  const confirmModal = document.getElementById('confirm-modal');
  const confirmList = document.getElementById('confirm-list');
  const confirmBack = document.getElementById('confirm-back');
  const confirmSend = document.getElementById('confirm-send');
  const confirmNameInput = document.getElementById('confirm-name-input');
  const confirmReview = document.getElementById('confirm-review');
  const confirmSuccess = document.getElementById('confirm-success');
  const confirmError = document.getElementById('confirm-error');
  const confirmCloseBtn = document.getElementById('confirm-close-btn');

  // --- Application state ---
  //
  // Everything below is "the model": plain data describing what's true
  // right now. The DOM (what's on screen) is never treated as the source
  // of truth - it's always rebuilt from this state by render(). This is a
  // common pattern (sometimes called "unidirectional data flow"): change
  // the data, then re-render, rather than reaching into the DOM by hand to
  // move things around. It means there's only ever one place that has to
  // agree with reality.

  let cards = DEMO_CARDS; // replaced with real cards from the server in boot(), if a task link was opened
  let setId = new URLSearchParams(location.search).get('set'); // the ?set=... value from the URL, or null in demo mode

  // slotAssignment[i] = cardId currently in diamond slot i, or null
  let slotAssignment = new Array(9).fill(null);
  // ids of cards still sitting in the pool
  let pool = [];

  // The card currently "picked up" via click/tap/keyboard (not mouse-dragged).
  // Choosing any other card or an empty slot places it there.
  let pickedUpCardId = null;
  // After a keyboard/tap-triggered move, render() should refocus this card.
  let pendingFocusCardId = null;
  // The card just moved into a slot by the current moveCard() call, so its
  // freshly-created element can swallow the "born under the cursor" enter
  // event once (see makeCardEl's mouseenter handling) instead of magnifying.
  let justMovedCardId = null;
  // Set right before moveCard() for a mouse-drag release: that card's FLIP
  // settle animation is skipped entirely (see render()). The card already
  // visually followed the cursor for the whole drag; animating a second
  // "glide into place" afterwards read as the card flying off and
  // snapping back, which didn't make sense on top of a drag that just
  // ended under the user's own hand.
  let dragDroppedCardId = null;

  // Resets the model back to "nothing placed yet" - used both on first
  // load and when the student clicks Reset.
  function initState() {
    slotAssignment = new Array(9).fill(null);
    pool = cards.map((c) => c.id);
  }

  // Small helper: look up a card object by its id. Used constantly because
  // the state above stores card *ids* (strings), not full card objects -
  // that keeps slotAssignment/pool simple to reason about (just an array
  // of ids) and avoids duplicating each card's text/color info everywhere.
  function cardById(id) {
    return cards.find((c) => c.id === id);
  }

  // Screen readers announce changes to an ARIA "live region" automatically,
  // without needing focus to move there. We clear the text first and set
  // it again on the next animation frame - if we just overwrote the same
  // message twice in a row, some screen readers won't notice the second
  // one changed, so the clear-then-set forces it to register as new.
  function announce(message) {
    liveRegionEl.textContent = '';
    requestAnimationFrame(() => {
      liveRegionEl.textContent = message;
    });
  }

  // Builds the empty diamond grid of drop-target <div>s, once, from
  // ROW_SIZES. This only runs at startup (see boot()) - after that, slots
  // are reused and just get cards added/removed from inside them by
  // render().
  function buildSlots() {
    diamondEl.innerHTML = '';
    let i = 0;
    ROW_SIZES.forEach((size) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'diamond-row';
      for (let c = 0; c < size; c += 1) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.slotIndex = String(i); // dataset.slotIndex becomes the HTML attribute data-slot-index
        slot.setAttribute('role', 'button'); // tells assistive tech this div behaves like a button
        slot.setAttribute('aria-label', `Empty position ${i + 1} of 9`);
        rowEl.appendChild(slot);
        i += 1;
      }
      diamondEl.appendChild(rowEl);
    });
  }

  // Picks a card's color deterministically from its position in the
  // original `cards` array (not from where it currently sits), so a card
  // keeps the same color forever no matter how many times it's moved.
  function cardColor(cardId) {
    const index = cards.findIndex((c) => c.id === cardId);
    return CARD_COLORS[index % CARD_COLORS.length]; // % cycles back to 0 once we run past the last color
  }

  // Builds one card <div> from scratch. This is called for *every* card,
  // *every* time render() runs - cards are never reused/moved as existing
  // DOM nodes, they're thrown away and recreated. That's simpler to reason
  // about than tracking "did this card's element already exist, and if so
  // where", at the cost of a little extra DOM work (cheap for 9 elements).
  function makeCardEl(card) {
    const el = document.createElement('div');
    el.className = `card card-${cardColor(card.id)}`;
    el.dataset.cardId = card.id; // lets us find "the element for this card id" later via a CSS attribute selector
    el.tabIndex = 0; // makes the div focusable/tabbable, like a real button
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', card.text); // what a screen reader announces when this card gets focus
    const textEl = document.createElement('span');
    textEl.className = 'card-text';
    textEl.textContent = card.text;
    el.appendChild(textEl);
    if (card.id === pickedUpCardId) el.classList.add('picked-up');
    // Cards with longer text keep the base font size when magnified rather
    // than growing it - at the larger size, 23+ characters no longer wraps
    // legibly in the magnified width, so the extra width is used for
    // wrapping instead of for bigger text. See the .long-text CSS rule.
    if (card.text.length >= 23) el.classList.add('long-text');
    // Magnify-on-hover is driven from mouseenter/leave rather than CSS
    // :hover, because a freshly dropped card sits right under the cursor -
    // and browsers re-run hit-testing after a DOM mutation and fire a
    // mouseenter for whatever now sits under an unmoved cursor, so even a
    // JS listener sees an "enter" the instant the card is born. We want
    // that specific first enter (right after a drop) to do nothing, and
    // only a later, real enter (mouse actually left and came back) to
    // magnify - so the just-moved card is marked to swallow exactly one
    // enter event before behaving normally.
    //
    // `suppressNextEnter` is a *closure* variable: it's declared here, and
    // the two event listener functions below both "close over" it,
    // meaning they can read and change this one shared variable even
    // after makeCardEl() has finished running. Each call to makeCardEl
    // creates its own fresh copy, so every card element gets its own
    // independent flag.
    let suppressNextEnter = card.id === justMovedCardId;
    el.addEventListener('mouseenter', () => {
      if (!el.closest('.slot')) return; // only diamond cards magnify, not pool cards
      if (suppressNextEnter) {
        suppressNextEnter = false; // only swallow it once - the next real enter magnifies normally
        return;
      }
      el.classList.add('magnify');
    });
    el.addEventListener('mouseleave', () => {
      el.classList.remove('magnify');
    });
    return el;
  }

  // render() is the heart of the whole app: it throws away every card
  // element currently on screen and rebuilds them from the current state
  // (slotAssignment + pool). Nothing else is allowed to directly move a
  // card's DOM element around - whenever the model changes, something
  // calls render() and this function is the only place that touches the
  // DOM to reflect it.
  //
  // On top of that, it also runs a "FLIP" animation (First, Last, Invert,
  // Play) so cards visibly glide to their new spot instead of just
  // teleporting there. The idea: record where every card *was* (First),
  // let the browser instantly rebuild everything in its *final* layout
  // (Last), then for each card, immediately transform it back to where it
  // used to be (Invert - so visually nothing has moved yet), and finally
  // animate that transform away to zero (Play) - which makes it glide from
  // old position to new.
  function render() {
    // --- First: record where every currently-on-screen card is ---
    const existingRects = new Map();
    document.querySelectorAll('.card').forEach((el) => {
      existingRects.set(el.dataset.cardId, el.getBoundingClientRect());
    });

    // --- Last: wipe out the old DOM and rebuild it from state ---
    document.querySelectorAll('.slot').forEach((slot) => {
      slot.innerHTML = '';
      slot.classList.remove('drop-target');
    });
    poolEl.innerHTML = '';
    poolEl.classList.remove('drop-target');

    slotAssignment.forEach((cardId, i) => {
      const slot = diamondEl.querySelector(`[data-slot-index="${i}"]`);
      if (!cardId) {
        slot.tabIndex = 0; // an empty slot is itself a focusable/tabbable target
        slot.setAttribute('aria-label', `Empty position ${i + 1} of 9`);
        return;
      }
      slot.tabIndex = -1; // once a slot holds a card, focus goes to the card instead, not the slot behind it
      slot.appendChild(makeCardEl(cardById(cardId)));
    });

    pool.forEach((cardId) => {
      poolEl.appendChild(makeCardEl(cardById(cardId)));
    });

    // These two "just happened" markers only apply to the render() call
    // right after they were set - clear them now so a later, unrelated
    // render() doesn't accidentally reuse stale values.
    justMovedCardId = null;
    const skipAnimationCardId = dragDroppedCardId;
    dragDroppedCardId = null;

    // --- Invert + Play: for any card whose position changed, animate
    // from its old rect to its new one. ---
    // A card just released from a mouse drag is skipped entirely - it
    // already visually followed the cursor for the whole drag, so a
    // second "glide into place" after release just reads as an
    // unexplained extra motion.
    document.querySelectorAll('.card').forEach((el) => {
      if (el.dataset.cardId === skipAnimationCardId) return;
      const before = existingRects.get(el.dataset.cardId);
      if (!before) return; // a brand new card (e.g. first load) has no "before" position to animate from
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (dx === 0 && dy === 0) return; // didn't actually move, nothing to animate
      if (prefersReducedMotion) return; // snap instantly, no motion
      // Invert: jump the card back to where it used to be, with no
      // transition, so this happens instantly and invisibly to the user.
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // Play: on the *next* animation frame (so the browser has had a
      // chance to actually paint the "invert" position first), turn the
      // transition back on and remove the transform. The browser then
      // animates smoothly from the inverted position back to zero offset
      // - i.e. to its real, final position.
      requestAnimationFrame(() => {
        // Plain ease-out, no overshoot - the card should arrive and stop,
        // not fly past its target and correct back (that read as the
        // "flies left then snaps back" motion users found confusing).
        el.style.transition = 'transform 0.2s ease-out';
        el.style.transform = '';
      });
    });

    updateSubmitState();
    attachDragHandlers(); // every card element is brand new, so it needs its drag listener attached again

    if (pendingFocusCardId) {
      const el = document.querySelector(`.card[data-card-id="${pendingFocusCardId}"]`);
      if (el) el.focus();
      pendingFocusCardId = null;
    }
  }

  // Enables/disables the Submit and Reset buttons and updates the "N of 9
  // placed" hint text, based purely on how many cards are still in the pool.
  function updateSubmitState() {
    const placed = 9 - pool.length;
    const allPlaced = placed === 9;
    submitBtn.disabled = !allPlaced;
    resetBtn.disabled = placed === 0;
    submitHint.textContent = allPlaced
      ? 'All 9 placed — ready to submit.'
      : `${placed} of 9 placed.`;
  }

  // indexOf returns -1 if the card isn't in any slot (i.e. it's in the pool).
  function slotIndexOf(cardId) {
    return slotAssignment.indexOf(cardId);
  }

  // moveCard is the single place that actually changes where a card lives
  // in the model. Every interaction style - mouse drag, tap-to-place,
  // keyboard - eventually calls this with the card being moved and its
  // destination (either a slot index 0-8, or the string 'pool').
  //
  // Moving a card into an already-occupied slot swaps the two cards,
  // rather than rejecting the move or silently losing the displaced one -
  // that's what "displaced" tracks below.
  function moveCard(cardId, target) {
    const fromSlot = slotIndexOf(cardId); // -1 if the card is currently in the pool
    const fromPool = pool.includes(cardId);

    let displaced = null;
    if (target === 'pool') {
      displaced = null; // pool has no fixed capacity, no swap needed
    } else {
      displaced = slotAssignment[target];
      if (displaced === cardId) {
        dragDroppedCardId = null; // no render() coming, so nothing will consume this
        return; // dropped on itself - nothing actually changes, so don't even re-render
      }
    }

    // Remove the card from wherever it currently is...
    if (fromSlot !== -1) slotAssignment[fromSlot] = null;
    if (fromPool) pool = pool.filter((id) => id !== cardId);

    // ...then put it (and, if there was one, the card it displaced) into
    // their new homes.
    if (target === 'pool') {
      pool.push(cardId);
    } else {
      slotAssignment[target] = cardId;
      if (displaced) {
        if (fromSlot !== -1) {
          // Both cards were in slots: the displaced one takes over the
          // moved card's old slot, so it's a clean swap rather than the
          // displaced card vanishing.
          slotAssignment[fromSlot] = displaced;
        } else {
          // The moved card came from the pool, so there's no "old slot"
          // to send the displaced card back to - it goes to the pool instead.
          pool.push(displaced);
        }
      }
    }

    justMovedCardId = target !== 'pool' ? cardId : null;
    render(); // state has changed, so re-render to reflect it (and animate the change)
  }

  // --- Pick up / place: shared by click, tap, and keyboard ---
  //
  // This is the accessible alternative to dragging: activate a card to pick
  // it up, then activate any other card (to swap) or empty slot to place it.
  // Activating the picked-up card again cancels the pickup.

  // Toggles a body-level class so CSS can highlight every valid drop
  // target at once while something is picked up (see the .picking rules
  // in style.css) - simpler than adding/removing a highlight class on
  // every slot individually.
  function setPicking(on) {
    document.body.classList.toggle('picking', on);
  }

  function releasePickup(message) {
    pickedUpCardId = null;
    document.querySelectorAll('.card').forEach((el) => el.classList.remove('picked-up'));
    setPicking(false);
    if (message) announce(message);
  }

  // Called whenever a card is "activated" (clicked, tapped, or Enter/Space
  // pressed while it has focus). What happens depends on whether something
  // is already picked up:
  //  - nothing picked up yet -> pick this card up
  //  - this exact card is already picked up -> put it back down, unchanged
  //  - a *different* card is picked up -> swap the two
  function handleActivateCard(cardId) {
    if (!pickedUpCardId) {
      pickedUpCardId = cardId;
      document.querySelectorAll('.card').forEach((el) => {
        // toggle's second argument forces it on/off rather than flipping -
        // here it adds the class only to the matching card and removes it
        // from every other one, in a single pass.
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
    pendingFocusCardId = saved; // after the re-render, put keyboard focus back on the card that moved
    moveCard(saved, target);
    announce(`Placed "${pickedText}", swapped with "${targetText}".`);
  }

  // Called when an *empty* slot is activated while a card is picked up.
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

  // Builds an ordered list of every focusable thing on the board (every
  // pool card, then each of the 9 diamond positions - a card if occupied,
  // otherwise the empty slot itself). Arrow-key navigation just moves
  // forward/backward through this list, wrapping around at the ends.
  function getFocusableItems() {
    const items = [];
    poolEl.querySelectorAll('.card').forEach((el) => items.push(el));
    for (let i = 0; i < 9; i += 1) {
      const slotEl = diamondEl.querySelector(`[data-slot-index="${i}"]`);
      const cardEl = slotEl.querySelector('.card');
      items.push(cardEl || slotEl); // the card if there is one, otherwise the empty slot
    }
    return items;
  }

  function onKeyDown(e) {
    const cardEl = e.target.closest('.card');
    const slotEl = !cardEl ? e.target.closest('.slot') : null;
    if (!cardEl && !slotEl) return; // key event from something else entirely - ignore
    const currentEl = cardEl || slotEl;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault(); // stop the browser's own default scrolling/behavior for arrow keys
      const items = getFocusableItems();
      const idx = items.indexOf(currentEl);
      // The `% items.length` wraps back to the start once we go past the last item.
      if (idx !== -1) items[(idx + 1) % items.length].focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = getFocusableItems();
      const idx = items.indexOf(currentEl);
      // Adding items.length before the modulo avoids a negative index when idx is 0.
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
  // further becomes a drag. This is what lets the exact same "click" also
  // work as the tap-to-place interaction above, without needing separate
  // code paths for mouse vs touch: Pointer Events (pointerdown/move/up)
  // unify mouse, touch, and pen input into one API.

  const DRAG_THRESHOLD = 6; // pixels of movement before a press counts as a drag, not a tap
  let dragState = null; // holds everything we need to track while a press is in progress; null when nothing is happening

  // Every freshly-created card element needs its own pointerdown listener,
  // since render() throws old elements away and makes new ones each time.
  function attachDragHandlers() {
    document.querySelectorAll('.card').forEach((el) => {
      el.addEventListener('pointerdown', onPointerDown);
    });
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return; // ignore right-click/middle-click, only respond to the primary button
    const el = e.currentTarget;
    // Pointer capture makes sure this same element keeps receiving
    // pointermove/pointerup events even if the cursor moves off it during
    // the drag - without this, dragging fast could "lose" the element.
    el.setPointerCapture(e.pointerId);
    dragState = {
      el,
      cardId: el.dataset.cardId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      dragging: false, // becomes true only once the pointer has moved past DRAG_THRESHOLD
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  // Switches a card over from "sitting in normal document flow" to
  // "following the cursor" - this only runs once, the moment a press
  // crosses the drag threshold (see onPointerMove below).
  function beginDrag(e) {
    const { el } = dragState;
    // If this card was magnified (mouse hovering it before the drag
    // started), strip that first - otherwise the rect below captures the
    // magnified box's size/position and locks it into the dragged card's
    // inline style, producing a wildly oversized/misshapen drag element.
    el.classList.remove('magnify');
    const rect = el.getBoundingClientRect(); // the card's current on-screen position/size, before we touch its styles
    dragState.dragging = true;
    // Remember exactly where inside the card the user grabbed it, so the
    // card doesn't jump to have its top-left corner under the cursor -
    // it keeps the same grab point as you move it.
    dragState.offsetX = e.clientX - rect.left;
    dragState.offsetY = e.clientY - rect.top;
    el.classList.add('dragging');
    // Switching to position:fixed takes the card out of normal layout so it
    // can be placed anywhere on screen by raw pixel coordinates, following
    // the cursor freely instead of being constrained by its parent container.
    el.style.position = 'fixed';
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    // Diamond cards are sized with CSS height:100% (of their slot). Once
    // position becomes fixed, that percentage resolves against the
    // viewport instead - pinning height explicitly, like width already is,
    // is what keeps a dragged diamond card from stretching into a huge
    // rectangle.
    el.style.height = `${rect.height}px`;
    el.style.zIndex = '60'; // make sure the dragged card renders above everything else
  }

  function onPointerMove(e) {
    if (!dragState) return; // no press currently in progress
    if (!dragState.dragging) {
      // Still deciding whether this is a tap or a drag: measure how far
      // the pointer has moved from where the press started.
      const dx = e.clientX - dragState.startClientX;
      const dy = e.clientY - dragState.startClientY;
      // Math.hypot computes the straight-line distance (Pythagoras) from
      // the two offsets, regardless of direction.
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // hasn't moved far enough yet - still just a press
      beginDrag(e);
    }
    // Move the card so the same point on it stays under the cursor.
    dragState.el.style.left = `${e.clientX - dragState.offsetX}px`;
    dragState.el.style.top = `${e.clientY - dragState.offsetY}px`;

    // Highlight whichever slot/pool the cursor is currently over, so the
    // user can see where the card would land if released right now.
    document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
    const dropZone = findDropZone(e.clientX, e.clientY);
    if (dropZone) dropZone.classList.add('drop-target');
  }

  function onPointerUp(e) {
    if (!dragState) return;
    const { el, cardId, dragging } = dragState;

    // The press is over either way (tap or drag) - stop listening for
    // further movement/release until the next pointerdown starts a new one.
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));

    if (!dragging) {
      // The pointer never moved past the threshold, so this was a tap, not
      // a drag - hand off to the same pick-up/place logic keyboard uses.
      dragState = null;
      handleActivateCard(cardId);
      return;
    }

    const dropZone = findDropZone(e.clientX, e.clientY);
    // Undo everything beginDrag() did, back to normal in-flow styling,
    // regardless of whether the drop succeeds - render() (called below via
    // moveCard) will rebuild this card fresh anyway if it moves, but if
    // there's no valid drop zone we need it to look normal again too.
    el.classList.remove('dragging');
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.width = '';
    el.style.height = '';
    el.style.zIndex = '';
    dragState = null;

    if (!dropZone) {
      render(); // released somewhere invalid (e.g. off the board) - re-render to snap back to its last real position
      return;
    }

    dragDroppedCardId = cardId; // tells render()'s FLIP logic to skip animating this particular card
    if (dropZone.classList.contains('pool')) {
      moveCard(cardId, 'pool');
    } else {
      moveCard(cardId, Number(dropZone.dataset.slotIndex));
    }
  }

  // elementsFromPoint returns every element stacked at that pixel
  // coordinate, front to back - we want whichever one of those is a slot
  // or the pool container, ignoring things like the card being dragged
  // itself (which is also technically "at" that point).
  function findDropZone(x, y) {
    const els = document.elementsFromPoint(x, y);
    return els.find((n) => n.classList.contains('slot') || n.id === 'pool') || null;
  }

  // Clicking directly on an empty slot's own area (not a card inside it)
  // places a picked-up card there — the tap/click counterpart to Enter.
  // This is attached once to the whole diamond container rather than to
  // each slot individually (a technique called "event delegation" - the
  // click bubbles up to a single listener, which checks what was actually
  // clicked via e.target).
  diamondEl.addEventListener('click', (e) => {
    const slotEl = e.target.closest('.slot');
    // e.target === slotEl (rather than just "inside a slot") makes sure
    // this only fires for clicks on the slot's own empty background, not
    // clicks that bubbled up from a card sitting inside it (a card click
    // is already handled separately via the drag/pointerup logic above).
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
    confirmNameInput.value = '';
    confirmError.hidden = true;
    confirmReview.hidden = false;
    confirmSuccess.hidden = true;
    confirmModal.hidden = false;
    confirmNameInput.focus();
    document.addEventListener('keydown', onModalKeyDown);
  }

  function closeConfirmModal() {
    confirmModal.hidden = true;
    document.removeEventListener('keydown', onModalKeyDown);
    submitBtn.focus(); // return focus to where the user's attention was before the modal opened
  }

  function showConfirmError(message) {
    confirmError.textContent = message;
    confirmError.hidden = false;
  }

  function showConfirmSuccess(message) {
    confirmReview.hidden = true;
    confirmSuccess.hidden = false;
    if (message) confirmSuccess.querySelector('.modal-subtitle').textContent = message;
    confirmCloseBtn.focus();
  }

  // A separate keydown listener just for while the modal is open, so
  // Escape closes the modal without also triggering the board's own
  // Escape handling (cancelling a pickup) underneath it.
  function onModalKeyDown(e) {
    if (e.key === 'Escape') closeConfirmModal();
  }

  submitBtn.addEventListener('click', () => {
    if (submitBtn.disabled) return;
    openConfirmModal();
  });

  resetBtn.addEventListener('click', () => {
    if (resetBtn.disabled) return;
    releasePickup();
    pendingFocusCardId = null;
    initState();
    render();
    announce('Board reset. All cards moved back to the pool.');
  });

  confirmBack.addEventListener('click', closeConfirmModal);
  confirmCloseBtn.addEventListener('click', closeConfirmModal);

  // `async` marks this function as one that can use `await` inside it -
  // await pauses execution at that line until the awaited Promise
  // (fetch's network request, here) finishes, without blocking the rest
  // of the page/browser while it waits.
  confirmSend.addEventListener('click', async () => {
    const arrangement = {};
    slotAssignment.forEach((cardId, i) => {
      arrangement[i] = cardId;
    });
    confirmError.hidden = true;

    if (!setId) {
      // Demo mode: there's no real task to submit to, so just show what
      // *would* have been sent, in the console, for development/testing.
      console.log('Demo mode (no ?set= in URL) — final arrangement:', arrangement);
      showConfirmSuccess('Demo mode: nothing was actually saved (see the browser console for the arrangement).');
      return;
    }

    const studentName = confirmNameInput.value.trim() || undefined;
    confirmSend.disabled = true; // prevent double-submitting while the request is in flight
    let res;
    try {
      res = await fetch(`/api/sets/${setId}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_name: studentName, arrangement }),
      });
    } catch (err) {
      // fetch only throws for network-level failures (offline, DNS, etc) -
      // an HTTP error status like 404 or 500 does NOT throw, it's still a
      // normal (but not "ok") response, handled below instead.
      confirmSend.disabled = false;
      showConfirmError('Could not reach the server. Check your connection and try again.');
      return;
    }
    confirmSend.disabled = false;

    if (res.ok) {
      showConfirmSuccess();
    } else {
      const body = await res.json().catch(() => ({})); // if the error response isn't valid JSON, fall back to an empty object rather than throwing
      showConfirmError(`Could not submit: ${body.error || res.statusText}`);
    }
  });

  // --- Boot ---
  //
  // This is where everything actually starts. Functions above only define
  // *how* to do things; nothing happens until boot() runs at the very
  // bottom of the file.

  async function boot() {
    buildSlots();
    if (setId) {
      // A real task link was opened - try to load its cards/title/
      // instructions from the server, replacing the DEMO_CARDS fallback.
      try {
        const res = await fetch(`/api/sets/${setId}`);
        if (res.ok) {
          const data = await res.json();
          // The server only sends back {text} per card (see server.js) -
          // we generate fresh local ids here since the ones used
          // everywhere else in this file (slotAssignment, pool, etc.) just
          // need to be unique strings, not anything meaningful server-side.
          cards = data.cards.map((c, i) => ({ id: `card-${i}`, text: c.text }));
          // A task title is optional for the tutor to set - if they left it
          // blank, don't show a fake title in its place, just omit it.
          if (data.title && data.title.trim()) {
            titleEl.textContent = data.title;
            titleEl.hidden = false;
          } else {
            titleEl.hidden = true;
          }
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
