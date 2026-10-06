// STAGE 1 THROWAWAY DEMO - see spec.md's "Live collaborative mode" section,
// build order step 1 ("prove the plumbing"). This file is not the real
// diamond-nine sync logic yet - it's the smallest possible thing that
// proves PartyKit actually works end to end (a shared counter, synced
// across however many browser tabs connect to the same room), before any
// app-specific code is written on top of it. Safe to delete once that's
// confirmed and Stage 2 (the real board state) replaces it.
//
// This is a "Party Server": PartyKit creates one of these per room (a
// room = one isolated, independent slice of state - for the real feature
// this will be one live diamond-nine session; here it's just one counter).
// Everyone who connects with the same room id in the URL ends up talking
// to the *same* instance of this class.
export default class Server {
  // `room` is provided by PartyKit itself - it's how this code sends
  // messages out to connected browsers (room.broadcast) and reads the
  // room's own id.
  constructor(room) {
    this.room = room;
    // This lives only in memory, only for as long as the room exists (it
    // resets to 0 the next time everyone disconnects and a fresh room
    // starts) - there's no database involved in this demo at all.
    this.count = 0;
  }

  // Runs once for each new browser tab that connects. We immediately send
  // it the current count, so a tab joining partway through still sees the
  // right number rather than starting blank.
  onConnect(connection) {
    connection.send(JSON.stringify({ type: 'count', value: this.count }));
  }

  // Runs whenever any connected tab sends a message. In this demo there's
  // only one kind of message a tab can send: "increment".
  onMessage(message, sender) {
    const data = JSON.parse(message);
    if (data.type === 'increment') {
      this.count += 1;
      // broadcast() sends to *every* connected tab, including the one
      // that triggered the change - this is deliberate and important: it
      // means every tab's on-screen number comes from the server's one
      // shared value, not from each tab guessing "I clicked, so it must
      // be N+1 now" locally. That's the same principle the real feature
      // relies on for last-write-wins: nobody trusts their own guess,
      // everyone displays whatever the server says actually happened.
      this.room.broadcast(JSON.stringify({ type: 'count', value: this.count }));
    }
  }
}
