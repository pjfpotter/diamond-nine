// STAGE 2: the real diamond-nine board, shared live across every browser
// connected to the same room. See spec.md's "Live collaborative mode"
// section for the full design - this file implements one room's worth of
// shared state: which card sits in which of the 9 diamond slots, and
// which cards are still in the pool.
//
// The key idea carried over from the Stage 1 counter demo: no connected
// browser ever trusts its own guess about what just happened. A browser
// sends "I want to move this card here", the server is the one and only
// place that actually updates the shared state, and then it broadcasts
// the new state to everyone (including whoever just moved a card) - so
// every screen is always showing a copy of what the server says is true,
// never a locally-guessed value. This is also what makes "last write
// wins" work for free: PartyKit delivers one room's messages to this
// class one at a time, in the order they arrive, so if two browsers move
// a card at nearly the same instant, the server simply processes one
// move and then the other - there's no real race to resolve.

// Placeholder cards for this build stage - Stage 3 (per spec.md's build
// order) is what wires this up to a tutor's real saved task instead of a
// fixed demo set.
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

export default class Server {
  constructor(room) {
    this.room = room;
    this.cards = DEMO_CARDS;
    // slotAssignment[i] = cardId currently in diamond slot i, or null -
    // same shape as app.js's own slotAssignment, deliberately, since the
    // two are the same concept (one lives in one browser only, this one
    // lives on the server and is shared by everyone in the room).
    this.slotAssignment = new Array(9).fill(null);
    this.pool = this.cards.map((c) => c.id);
  }

  // Bundles up everything a browser needs to redraw the whole board, in
  // one object - used both for the very first message a new connection
  // gets, and for every broadcast after a move.
  currentState() {
    return {
      type: 'state',
      cards: this.cards,
      slotAssignment: this.slotAssignment,
      pool: this.pool,
    };
  }

  // A new browser tab just opened a connection to this room. Send it the
  // current state immediately, so it can draw the board right away rather
  // than starting blank - this is also exactly what happens on
  // reconnection after a dropped connection (see spec.md: "Reconnection
  // just refetches current state").
  onConnect(connection) {
    connection.send(JSON.stringify(this.currentState()));
  }

  onMessage(message, sender) {
    const data = JSON.parse(message);
    if (data.type === 'move') {
      this.handleMove(data.cardId, data.target);
    }
  }

  // Mirrors app.js's own moveCard() logic closely on purpose - same
  // swap-on-collision behaviour, same shapes of data - just operating on
  // the server's shared copy of the state instead of one browser's local
  // copy. `target` is either a slot index 0-8, or the string 'pool'.
  handleMove(cardId, target) {
    const fromSlot = this.slotAssignment.indexOf(cardId);
    const fromPool = this.pool.includes(cardId);

    let displaced = null;
    if (target === 'pool') {
      displaced = null;
    } else {
      displaced = this.slotAssignment[target];
      if (displaced === cardId) return; // dropped on itself, nothing actually changes
    }

    if (fromSlot !== -1) this.slotAssignment[fromSlot] = null;
    if (fromPool) this.pool = this.pool.filter((id) => id !== cardId);

    if (target === 'pool') {
      this.pool.push(cardId);
    } else {
      this.slotAssignment[target] = cardId;
      if (displaced) {
        if (fromSlot !== -1) {
          this.slotAssignment[fromSlot] = displaced;
        } else {
          this.pool.push(displaced);
        }
      }
    }

    // Broadcast to *every* connected browser, including whichever one
    // triggered this move - see the top-of-file comment on why that's
    // deliberate.
    this.room.broadcast(JSON.stringify(this.currentState()));
  }
}
