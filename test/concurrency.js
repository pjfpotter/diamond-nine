// STAGE 4: the concurrency test. See spec.md's "Live collaborative mode"
// section - this is deliberately a real, kept test (run it again before
// any future deploy), not a throwaway script, because concurrency bugs
// are exactly the kind that "it worked when I tried it alone" cannot
// catch. Nobody testing this app solo, one move at a time, would ever
// discover what happens when five people grab the same card at once -
// only genuinely simultaneous requests against the real server can.
//
// This talks to the REAL backend, not a mock of it: the real Express app
// (for creating a task and checking the saved result afterwards) and the
// real `wrangler dev` Worker (for the actual room/concurrency behaviour).
// Both must already be running - see the instructions printed if they're
// not reachable.
//
// Uses only Node's built-in fetch and WebSocket (both standard since
// Node 22) - no new dependency added to the project just to run this.

const EXPRESS_BASE = 'http://localhost:3000';
const WORKER_BASE = 'ws://127.0.0.1:8787';

function fail(message) {
  console.error(`✗ FAIL: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`✓ ${message}`);
}

// Opens one simulated "browser" - a raw WebSocket connection to the given
// room, tracking the most recent state it's been sent. Several of these
// running at once, all talking to the same room, is what stands in for
// "several students' browsers" in this test.
function connectClient(roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WORKER_BASE}/party/${encodeURIComponent(roomId)}`);
    const client = { ws, latestState: null };
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'state') client.latestState = data;
    });
    ws.addEventListener('open', () => resolve(client));
    ws.addEventListener('error', reject);
  });
}

function send(client, data) {
  client.ws.send(JSON.stringify(data));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The one invariant that must hold no matter how chaotically moves were
// fired: every one of the task's 9 cards appears in EXACTLY one place -
// either one slot, or the pool - never zero places (lost) and never two
// or more (duplicated). This is what "the board always converges to a
// sane state" actually means, made checkable.
function checkInvariant(state, allCardIds, label) {
  const seen = [];
  state.slotAssignment.forEach((cardId) => {
    if (cardId) seen.push(cardId);
  });
  seen.push(...state.pool);

  const seenSorted = [...seen].sort();
  const expectedSorted = [...allCardIds].sort();

  const duplicates = seen.filter((id, i) => seen.indexOf(id) !== i);
  const missing = allCardIds.filter((id) => !seen.includes(id));
  const extra = seen.filter((id) => !allCardIds.includes(id));

  if (duplicates.length === 0 && missing.length === 0 && extra.length === 0
      && seen.length === allCardIds.length
      && JSON.stringify(seenSorted) === JSON.stringify(expectedSorted)) {
    ok(`${label}: all 9 cards present exactly once (no duplicates, none lost)`);
    return true;
  }
  fail(`${label}: invariant broken - duplicates=${JSON.stringify(duplicates)} missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);
  console.error('  slotAssignment:', JSON.stringify(state.slotAssignment));
  console.error('  pool:          ', JSON.stringify(state.pool));
  return false;
}

async function main() {
  console.log('Concurrency test - requires both servers already running:');
  console.log('  npx wrangler dev   (in one terminal)');
  console.log('  npm start          (in another)');
  console.log('');

  // --- Set up a real task through the real API ---
  let token;
  let taskId;
  try {
    const tokenRes = await fetch(`${EXPRESS_BASE}/api/tutors`, { method: 'POST' });
    ({ token } = await tokenRes.json());
    const cards = Array.from({ length: 9 }, (_, i) => ({ text: `Concurrency Card ${i}` }));
    const createRes = await fetch(`${EXPRESS_BASE}/api/sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': token },
      body: JSON.stringify({ title: 'Concurrency Test', instructions: 'x', cards }),
    });
    ({ id: taskId } = await createRes.json());
  } catch (err) {
    console.error('Could not reach the Express app at', EXPRESS_BASE);
    console.error('Make sure `npm start` is running, then try again.');
    process.exit(1);
  }
  const allCardIds = Array.from({ length: 9 }, (_, i) => `card-${i}`);
  console.log(`Created test task ${taskId}\n`);

  let clients;
  try {
    clients = await Promise.all(Array.from({ length: 6 }, () => connectClient(taskId)));
  } catch (err) {
    console.error('Could not reach the Worker at', WORKER_BASE);
    console.error('Make sure `npx wrangler dev` is running, then try again.');
    process.exit(1);
  }
  // Wait for everyone's initial state to land before starting.
  await sleep(300);
  ok(`${clients.length} simulated clients connected to the same room`);

  // --- Scenario A: everyone grabs the SAME card at once, for DIFFERENT
  // target slots. Only one of these can possibly "win" - the point is
  // confirming the card doesn't end up duplicated across multiple slots,
  // or vanish, when several clients race to move it simultaneously. ---
  clients.forEach((client, i) => {
    send(client, { type: 'move', cardId: 'card-0', target: i });
  });
  await sleep(400);
  checkInvariant(clients[0].latestState, allCardIds, 'Scenario A (same card, different targets)');

  // --- Scenario B: everyone moves a DIFFERENT card into the SAME target
  // slot at once. Confirms the "displace whatever was already there"
  // swap logic doesn't duplicate or drop a card when several clients
  // race for one spot. ---
  clients.forEach((client, i) => {
    send(client, { type: 'move', cardId: `card-${i + 1}`, target: 3 });
  });
  await sleep(400);
  checkInvariant(clients[0].latestState, allCardIds, 'Scenario B (different cards, same target)');

  // --- Scenario C: a connection drops abruptly mid-interaction (no clean
  // close, no final move - just gone), and everyone else keeps working. ---
  const [droppedClient, ...survivors] = clients;
  send(droppedClient, { type: 'join', name: 'AboutToDrop' });
  await sleep(150);
  droppedClient.ws.close(); // abrupt disconnect, simulating a lost connection mid-drag
  await sleep(200);

  // The remaining clients should still be able to move cards normally.
  send(survivors[0], { type: 'move', cardId: 'card-5', target: 7 });
  await sleep(400);
  const afterDropOk = checkInvariant(survivors[0].latestState, allCardIds, 'Scenario C (after a dropped connection)');
  const placedAfterDrop = survivors[0].latestState.slotAssignment[7] === 'card-5';
  if (placedAfterDrop) {
    ok('Scenario C: a move still works normally after another client dropped mid-session');
  } else {
    fail('Scenario C: move after a dropped connection did not take effect');
  }

  // Clean up remaining connections.
  survivors.forEach((c) => c.ws.close());

  console.log('\nDone.');
  if (process.exitCode === 1) {
    console.log('Some checks FAILED - see above.');
  } else {
    console.log('All concurrency checks passed.');
  }
  // WebSocket's underlying handles don't always let the event loop exit
  // on their own after close() - force a clean exit now that every check
  // has run, rather than leaving the process hanging.
  process.exit(process.exitCode || 0);
}

main();
