const EMPTY_SLOT = '— —';

// VERIFICATION: bump this string every time you deploy. Open the console
// (Cmd+Option+J) on BOTH the host and viewer tabs and confirm this exact
// line prints on both before troubleshooting anything else — if one tab
// shows an older/missing build tag, that tab is running stale cached
// code, not the file you think you just pushed.
const BUILD_ID = 'pickle-jam-viewer-history-restored-2026-09-14e';
console.log('%cPickle Jam build:', 'font-weight:bold', BUILD_ID);


// Firebase RTDB internally stores everything as a tree, not real arrays.
// When you write a JS array, the SDK converts it to integer-keyed nodes —
// and when reading it back, it only reconstitutes a real JS array if the
// keys look "array-like" (dense, starting at 0). An array with `null`
// holes (exactly what courtPlayers looks like after every Save/Reset —
// e.g. [null, null, null, null]) can come back as a plain OBJECT instead
// (e.g. {} or {"2": {...}}), not an array. The old code only handled the
// array case, so a Save/Reset could silently fail to round-trip correctly
// depending on which slots were empty. This normalizes either shape into
// a real 4-element array regardless.
function normalizeCourtPlayers(value) {
  const result = [null, null, null, null];
  if (Array.isArray(value)) {
    for (let i = 0; i < 4; i++) result[i] = value[i] ?? null;
  } else if (value && typeof value === 'object') {
    for (let i = 0; i < 4; i++) result[i] = value[i] ?? value[String(i)] ?? null;
  }
  return result;
}

// -----------------------------------------------------------------------
// THE ROOT CAUSE of "sync just stops working" (refresh loses history,
// viewer freezes, etc.):
//
// Firebase treats writing `null` as "delete this key" — including for a
// key nested inside an object inside an array. So a player added WITHOUT
// a photo gets written as `photo: null`, and Firebase silently drops that
// `photo` key from storage entirely. The next time that data comes back
// down through a snapshot, the player object has no `photo` property at
// all — so reading `player.photo` in JS now gives `undefined`, not `null`.
//
// Later, saveMatch() rebuilds each player as
// `{ name: p.name, photo: p.photo, score }` — and if p.photo is that
// `undefined`, the object now explicitly carries `photo: undefined`.
// Firebase's client SDK REJECTS this synchronously, before the write even
// leaves the browser ("values argument contains undefined..."). Because
// it throws synchronously instead of rejecting a promise, the existing
// `.then()/.catch()/.finally()` chain on that update() call never even
// attaches — so `pendingWrites` (see below) gets stuck above 0 forever,
// which makes BOTH the live listener and every future resync poll skip
// applying new data for the rest of the session. That matches every
// symptom reported: history looking frozen, viewers not updating, and a
// refresh appearing to "lose" data that's actually just stuck un-synced.
//
// Fix: run every payload through this before it ever reaches Firebase.
// JSON.stringify already implements exactly the semantics Firebase wants —
// `undefined` inside an object becomes a dropped key, and `undefined`
// inside an array becomes `null` — so a stringify/parse round-trip is a
// simple, thorough way to guarantee no `undefined` can ever sneak into a
// write, regardless of which code path constructed the object.
function sanitizeForFirebase(value) {
  return JSON.parse(JSON.stringify(value));
}

let waitingQueue = [];       // array of { name, photo }
let courtPlayers = [null, null, null, null]; // each null or { name, photo }
let matchHistory = [];       // array of { players:[{name,score,photo} x4], team1Total, team2Total, time }
let recentlyFinished = [];   // array of { name, photo }
let pendingPhoto = null;     // data URL for the photo about to be added
let matchStartTime = null;   // timestamp (ms) the current match's timer started, or null if not running
let matchTimerInterval = null; // setInterval handle for the live ticking display

// Guards against applying a Firebase snapshot that arrived while one of
// OUR OWN writes is still in flight (the JS SDK can briefly deliver a
// partially-merged local echo of a multi-key update() before the real
// server-committed value round-trips back). This is the only staleness
// protection needed: Firebase already guarantees `.on('value')` and
// `.once('value')` deliver each client its own consistent, correctly
// ordered view of a location, so there's no need for (and no safe way to
// build) a manual "is this snapshot newer than the last one?" counter on
// top of that — a previous version of this file tried exactly that with
// a `revision` field, and a single bad/racy value could permanently
// freeze a viewer on a stale snapshot forever, which is the bug that was
// happening in production. Don't reintroduce that pattern.
let pendingWrites = 0; // number of our own writes still in flight to Firebase

const nameInput = document.getElementById('nameInput');
const addBtn = document.getElementById('addBtn');
const removeBtn = document.getElementById('removeBtn');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');

const photoInput = document.getElementById('photoInput');
const photoPreview = document.getElementById('photoPreview');
const photoPickerIcon = document.getElementById('photoPickerIcon');

const fillCourtBtn = document.getElementById('fillCourtBtn');
const resetCourtBtn = document.getElementById('resetCourtBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const saveBtn = document.getElementById('saveBtn');
const playBtn = document.getElementById('playBtn');
const matchTimerDisplay = document.getElementById('matchTimer');

const finishedContainer = document.getElementById('finishedContainer');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

const team1Label = document.getElementById('team1Label');
const team2Label = document.getElementById('team2Label');

const connectionBanner = document.getElementById('connectionBanner');
const syncErrorBanner = document.getElementById('syncErrorBanner');
const syncStatusText = document.getElementById('syncStatusText');
const forceSyncBtn = document.getElementById('forceSyncBtn');

/* ===========================================================
   MULTIPLAYER: Firebase config + Host/Viewer setup
   -----------------------------------------------------------
   Replace the placeholder values below with the config object
   from your Firebase project (Project settings → General →
   "Your apps" → SDK setup and configuration → Config).
=========================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyBdSMWpqMTYbiRcTzkOZjRC9ue2Ta9zrao",
  authDomain: "pickle-resjam.firebaseapp.com",
  databaseURL: "https://pickle-resjam-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pickle-resjam",
  storageBucket: "pickle-resjam.firebasestorage.app",
  messagingSenderId: "712164613268",
  appId: "1:712164613268:web:04cf91dfbcee46ab936881",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const qrToggleBtn = document.getElementById('qrToggleBtn');
const qrModalOverlay = document.getElementById('qrModalOverlay');
const qrModalCloseBtn = document.getElementById('qrModalCloseBtn');
const qrcodeContainer = document.getElementById('qrcodeContainer');
const roomCodeText = document.getElementById('roomCodeText');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const viewerBadge = document.getElementById('viewerBadge');
const viewerRoomCode = document.getElementById('viewerRoomCode');

// MULTIPLAYER: open/close the QR modal from the header icon.
qrToggleBtn.addEventListener('click', () => {
  qrModalOverlay.hidden = false;
});
qrModalCloseBtn.addEventListener('click', () => {
  qrModalOverlay.hidden = true;
});
qrModalOverlay.addEventListener('click', (e) => {
  if (e.target === qrModalOverlay) qrModalOverlay.hidden = true; // click outside the card
});

const urlParams = new URLSearchParams(window.location.search);
const isViewerMode = urlParams.get('mode') === 'viewer';
const isHost = !isViewerMode;
let roomId = urlParams.get('room');
let roomRef = null;

// HOST PERSISTENCE: a very likely real cause of "my history/timer keeps
// getting reset" is nothing to do with syncing at all — it's that the
// host reopened the app WITHOUT the "?room=XXXXXX" URL param (e.g. an
// "Add to Home Screen" icon that was saved before a room existed, a
// bookmark to the bare URL, or the query string getting stripped by
// something in between). With no room id in the URL, the old code always
// treated that as "brand new session" and generated a fresh random room —
// which looks exactly like everything being wiped, even though the old
// room (and all its history) is still sitting untouched in Firebase.
// Mirroring the room id into localStorage means the HOST's browser can
// always find its way back to the same room even if the URL doesn't carry
// it, while a Viewer (who only ever gets a room id from the QR link) is
// unaffected.
const HOST_ROOM_STORAGE_KEY = 'pickleJam:hostRoomId';
if (isHost && !roomId) {
  try {
    const savedRoomId = window.localStorage.getItem(HOST_ROOM_STORAGE_KEY);
    if (savedRoomId) roomId = savedRoomId;
  } catch (err) {
    // Private browsing / storage disabled — fall through and generate a
    // fresh room as before. Not fatal, just loses this particular safety net.
  }
}

// Applied immediately (script runs after the body has parsed) so
// spectator controls are hidden before the first paint, not after.
if (isViewerMode) {
  document.body.classList.add('viewer-mode');
}

function generateRoomId(length = 6) {
  // Avoids ambiguous characters (0/O, 1/I) so codes are easy to read/type.
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < length; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/* ---------------------------------------------------------
   MULTIPLAYER: connection watchdog
   -----------------------------------------------------------
   The live `.on('value', ...)` listener depends on an open
   WebSocket. Backgrounding a tab, letting the phone sleep, or
   Safari restoring a tab from its back-forward cache (bfcache)
   can silently kill that socket — the page never errors, it
   just stops receiving updates and freezes on whatever it last
   saw. A manual refresh doesn't reliably fix this either, since
   a bfcache restore can skip re-running this script entirely.

   forceResync() does a one-time fetch of the current room state
   and applies it immediately, regardless of whether the live
   listener is still healthy. It's called:
     1) whenever Firebase's own connection-state ref flips back
        to "connected" (covers real network drops/reconnects)
     2) on `pageshow` with event.persisted === true (covers
        Safari/bfcache tab restores)
     3) whenever the tab becomes visible again (belt-and-
        suspenders for platforms that don't fire the above)
     4) on an unconditional poll (covers unfocused-but-visible
        windows, which Page Visibility never reports as hidden)
--------------------------------------------------------- */
function forceResync() {
  if (!roomRef) return;
  // If we have a write of our own still in flight, the live listener will
  // deliver its authoritative (server-resolved) result in a moment — skip
  // this manual fetch so it can't momentarily show a snapshot from just
  // before our own change landed.
  if (pendingWrites > 0) return;

  roomRef
    .once('value')
    .then((snapshot) => {
      const data = snapshot.val();
      if (data) applyState(data);
    })
    .catch((err) => {
      console.error('Resync failed:', err);
    });
}

// Shows a persistent (non-auto-dismissing) red banner when a snapshot fails
// to apply. Unlike the toast, this stays up until a snapshot succeeds again,
// so a sync problem can't be missed just because nobody was looking at the
// screen in the 4.5s a toast is visible.
function showSyncError(message) {
  if (!syncErrorBanner) return;
  syncErrorBanner.textContent = `⚠️ ${message}`;
  syncErrorBanner.hidden = false;
}
function hideSyncError() {
  if (!syncErrorBanner) return;
  syncErrorBanner.hidden = true;
}

// Updates the small "Synced Xs ago" line every second so a frozen Live View
// (or a frozen host, after a refresh) is visible at a glance instead of
// silently showing stale data with nothing on screen to indicate that.
function updateSyncIndicator() {
  if (!syncStatusText) return;
  if (lastAppliedAt === null) {
    syncStatusText.textContent = isViewerMode ? 'Waiting for host…' : 'Not synced yet';
    return;
  }
  const secs = Math.floor((Date.now() - lastAppliedAt) / 1000);
  let label;
  if (secs < 2) label = 'Synced just now';
  else if (secs < 60) label = `Synced ${secs}s ago`;
  else label = `Synced ${Math.floor(secs / 60)}m ago`;
  syncStatusText.textContent = label;
  // A viewer that hasn't heard from Firebase in a while despite the 4s poll
  // almost certainly has a real problem (stale cache, dead connection) —
  // flag it visibly rather than quietly showing old data as if it's current.
  if (secs > 15) {
    syncStatusText.classList.add('sync-stale');
  } else {
    syncStatusText.classList.remove('sync-stale');
  }
}

const RESYNC_POLL_MS = 4000;

function setupConnectionWatchdog() {
  // Firebase's built-in "am I connected right now" signal. Fires true on
  // initial connect AND on every reconnect after a drop — that second case
  // is exactly when a stale screen needs a hard refresh of the data.
  firebase
    .database()
    .ref('.info/connected')
    .on('value', (snap) => {
      const connected = snap.val() === true;
      if (connectionBanner) connectionBanner.hidden = connected;
      if (connected) forceResync();
    });

  // Safari (and some other browsers) can restore a tab from bfcache
  // without re-running this script or re-opening the socket. `pageshow`
  // with `persisted: true` is the signal that this just happened.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) forceResync();
  });

  // Re-sync whenever the tab regains visibility (covers tab-switch cases).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') forceResync();
  });

  // HARD FALLBACK: none of the signals above fire when a window is simply
  // unfocused-but-still-visible (e.g. two separate Chrome windows sitting
  // side by side) — the Page Visibility API only reports "hidden" for a
  // minimized/switched-away tab, not an unfocused window. Some browsers
  // still quietly throttle or drop the realtime socket in that state with
  // no event at all to catch. An unconditional poll sidesteps all of that:
  // every few seconds, just ask Firebase for the current truth and apply
  // it. Cheap for an app this size, and makes staleness a non-issue
  // regardless of which window/tab/OS quirk is in play.
  setInterval(forceResync, RESYNC_POLL_MS);

  // Keeps the "Synced Xs ago" text moving even when no new snapshot has
  // arrived — that's exactly the case it exists to reveal.
  setInterval(updateSyncIndicator, 1000);
  updateSyncIndicator();
}

function initMultiplayer() {
  if (isHost) {
    if (!roomId) {
      roomId = generateRoomId();
    }
    // Keep the room id in BOTH the URL (so the address bar/share sheet is
    // correct) AND localStorage (so it survives even if the URL param is
    // ever missing — see the HOST_ROOM_STORAGE_KEY comment above). This
    // runs whether roomId was just generated or was recovered from the
    // URL/localStorage above, so the two always stay in sync.
    const newUrl = `${window.location.pathname}?room=${roomId}`;
    window.history.replaceState({}, '', newUrl);
    try {
      window.localStorage.setItem(HOST_ROOM_STORAGE_KEY, roomId);
    } catch (err) {
      // Private browsing / storage disabled — non-fatal, see above.
    }

    roomRef = db.ref(`rooms/${roomId}`);
    renderRoomBar();

    // Read the room's existing data ONCE, first, and only decide what to
    // do once that finishes. This avoids a race between the live 'on'
    // listener and the one-time "does this room exist yet?" check, which
    // could otherwise wipe Match History / Recently Finished on refresh.
    roomRef
      .once('value')
      .then((snapshot) => {
        const data = snapshot.val();
        if (data) {
          applyState(data); // existing room — resume exactly where it left off
        } else {
          syncStateToFirebase(); // brand-new room — seed it with the current (empty) state
        }

        // Only attach the ongoing listener once the initial load/seed above
        // has resolved, so it can never race that step.
        roomRef.on(
          'value',
          (liveSnapshot) => {
            // Skip while one of our own writes is still in flight — see the
            // comment on `pendingWrites` at the top of this file. Once the
            // write resolves, the very next live event (or the resync poll)
            // will carry the authoritative post-write value.
            if (pendingWrites > 0) return;
            const liveData = liveSnapshot.val();
            if (liveData) applyState(liveData);
          },
          (err) => {
            console.error('Firebase listener error:', err);
            showToast('Lost connection to the room — check Firebase rules/network', true);
          }
        );

        setupConnectionWatchdog();
      })
      .catch((err) => {
        console.error('Failed to load room from Firebase:', err);
        showToast('Could not load saved room data — check Firebase config', true);
      });
  } else {
    if (!roomId) {
      showToast('No room code in this link', true);
      return;
    }

    viewerRoomCode.textContent = roomId;
    viewerBadge.hidden = false;
    if (forceSyncBtn) forceSyncBtn.hidden = false;

    roomRef = db.ref(`rooms/${roomId}`);

    // Same explicit "fetch current snapshot first, then attach the live
    // listener" shape as the host path above, rather than relying on the
    // .on() listener's first invocation to double as the initial load.
    // Functionally similar either way, but this keeps init behavior
    // identical and easy to reason about across both roles.
    roomRef
      .once('value')
      .then((snapshot) => {
        const data = snapshot.val();
        if (data) {
          applyState(data);
        } else {
          showToast('Waiting for the host to start the session…');
        }

        roomRef.on(
          'value',
          (liveSnapshot) => {
            // Viewers never call syncStateToFirebase(), so pendingWrites is
            // always 0 here — every live snapshot Firebase sends is applied
            // immediately, in the order Firebase delivers it.
            if (pendingWrites > 0) return;
            const liveData = liveSnapshot.val();
            if (liveData) applyState(liveData);
          },
          (err) => {
            console.error('Firebase listener error:', err);
            showToast('Could not connect to this room — check the link', true);
          }
        );

        setupConnectionWatchdog();
      })
      .catch((err) => {
        console.error('Failed to load room from Firebase:', err);
        showToast('Could not connect to this room — check the link', true);
      });
  }
}

function renderRoomBar() {
  qrToggleBtn.hidden = false;
  if (forceSyncBtn) forceSyncBtn.hidden = false;
  roomCodeText.textContent = roomId;

  const viewerUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}&mode=viewer`;

  qrcodeContainer.innerHTML = '';
  // eslint-disable-next-line no-undef
  new QRCode(qrcodeContainer, {
    text: viewerUrl,
    width: 128,
    height: 128,
    colorDark: '#1c2e2a',
    colorLight: '#ffffff',
  });

  copyLinkBtn.addEventListener('click', () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(viewerUrl)
        .then(() => showToast('Viewer link copied!'))
        .catch(() => showToast('Could not copy link', true));
    } else {
      showToast('Copy not supported on this browser', true);
    }
  });
}

// Pulls the four on-screen scores into a plain array for syncing —
// scores live only in the score-val spans, not in courtPlayers.
function getCurrentScores() {
  return [0, 1, 2, 3].map(
    (i) => parseInt(document.getElementById(`score${i}`).textContent, 10) || 0
  );
}

// HOST -> FIREBASE: pushes the entire app state to rooms/{roomId} in a
// single multi-key update. Called at the end of every action that
// mutates state.
function syncStateToFirebase() {
  if (!isHost || !roomRef) return;

  // Build the plain-data part of the payload and strip any `undefined`
  // out of it (see the big comment on sanitizeForFirebase above — this is
  // what actually fixes the "sync freezes forever" bug). ServerValue
  // sentinels below are added AFTER sanitizing, untouched, since they're
  // special objects Firebase itself interprets, not plain data.
  const payload = sanitizeForFirebase({
    waitingQueue,
    courtPlayers,
    // NOTE: Firebase treats `null` object-property values as "delete
    // this key" (and an all-null array collapses away too). Writing an
    // explicit sentinel (0 = "not running") instead of `null` means
    // "no active match" is always a real, present value in the DB
    // rather than an implicit absence that every reader has to guess
    // the meaning of.
    matchStartTime: matchStartTime ?? 0,
    // Human-readable mirror of matchStartTime, purely for glancing at
    // the Firebase console / debug log — applyState() below still
    // derives real behavior from matchStartTime and courtPlayers, not
    // this string, since those are the actual source of truth.
    matchStatus: matchStartTime !== null ? 'in_progress' : 'idle',
    scores: getCurrentScores(),
    matchHistory,
    recentlyFinished,
  });

  pendingWrites++;

  // GUARD: Firebase's SDK can throw SYNCHRONOUSLY (not a rejected promise)
  // when a write is malformed, which would otherwise skip .then/.catch/
  // .finally entirely and leave pendingWrites stuck above 0 forever —
  // freezing all future sync for the rest of the session. The sanitize
  // step above should make that specific failure impossible now, but this
  // try/catch is a second, independent safety net: no future bad value,
  // from any code path, can ever again wedge the app this way.
  let updatePromise;
  try {
    updatePromise = roomRef.update({
      ...payload,
      // Kept purely as a debug counter you can eyeball in the Firebase
      // console's Data tab to confirm writes are actually landing — NOT
      // used to gate whether an incoming snapshot gets applied (see the
      // big comment on `pendingWrites` near the top of this file for why).
      revision: firebase.database.ServerValue.increment(1),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
    });
  } catch (err) {
    console.error('Firebase update() threw synchronously — bad payload:', err, payload);
    showToast(`Save failed — not synced to viewers (${err.message})`, true);
    pendingWrites = Math.max(0, pendingWrites - 1);
    return;
  }

  // SAFETY NET: if this write somehow never resolves or rejects (a genuine
  // network hang, not a rejected promise), this guarantees pendingWrites
  // still gets released after 10s instead of blocking all future sync for
  // the rest of the session. `settled` stops this and the real
  // .finally() below from BOTH decrementing if the promise resolves late
  // (after the timeout already fired) — since multiple writes can be in
  // flight at once, double-decrementing here would incorrectly release
  // some other write's still-pending lock.
  let settled = false;
  const pendingWriteSafetyTimer = setTimeout(() => {
    if (settled) return;
    settled = true;
    console.warn('Firebase write taking unusually long (>10s) — releasing the sync lock as a safety net');
    pendingWrites = Math.max(0, pendingWrites - 1);
  }, 10000);

  updatePromise
    .then(() => {
      // DEBUG: confirms the write actually reached Firebase and what it
      // carried. If matchHistory/recentlyFinished show 0 here right after
      // saveMatch(), the bug is upstream of Firebase (in local state);
      // if they show the right counts here but the viewer still doesn't
      // update, the bug is downstream (rules/listener on the viewer side).
      console.log(
        'Synced to Firebase — matchHistory:', matchHistory.length,
        'recentlyFinished:', recentlyFinished.length
      );
    })
    .catch((err) => {
      console.error('Firebase sync failed:', err);
      // Surface the actual reason (e.g. "PERMISSION_DENIED" from expired
      // test-mode database rules) instead of a generic message — this is
      // exactly the kind of failure that otherwise looks like "nothing's
      // wrong" on the host while nothing actually saves to viewers.
      const reason = err && (err.code || err.message) ? ` (${err.code || err.message})` : '';
      showToast(`Save failed — not synced to viewers${reason}`, true);
    })
    .finally(() => {
      clearTimeout(pendingWriteSafetyTimer);
      if (settled) return;
      settled = true;
      pendingWrites = Math.max(0, pendingWrites - 1);
    });
}

// FIREBASE -> UI: rebuilds local state + re-renders from a Firebase
// snapshot. Runs on both Host and Viewer whenever rooms/{roomId} changes,
// and also whenever forceResync() pulls a fresh snapshot after a
// reconnect/tab-restore/poll. Every snapshot Firebase delivers here is
// applied as-is — see the comment on `pendingWrites` near the top of this
// file for why there's deliberately no additional "is this stale?" check.
// Tracks the last time a Firebase snapshot was SUCCESSFULLY applied, so the
// on-screen sync indicator (see updateSyncIndicator) can show real, honest
// staleness ("Synced 2s ago") instead of everyone just hoping it's working.
let lastAppliedAt = null;

function applyState(state) {
  // DEBUG: confirms whether this client (host or viewer) is actually
  // receiving Firebase snapshots at all, and what they contain. If a
  // Save on the host never logs anything on the viewer's console, the
  // problem is upstream of this function entirely (deploy not live yet,
  // Firebase rules rejecting the write, or the listener never attached)
  // rather than anything in the state-application logic below. Safe to
  // remove once things are confirmed working.
  console.log('Firebase snapshot received:', state);

  // CRITICAL: everything below used to run unguarded. If any single field
  // in a snapshot was ever malformed, the exception would abort this
  // function partway through and the live listener would look "frozen" —
  // every future snapshot (live push AND the 4s poll) would hit the same
  // bad data and fail the same way, with nothing visible except a console
  // error nobody was looking at. This was almost certainly the actual
  // cause of "Save works on the host but Live View never updates, and
  // even refreshing doesn't help": one bad snapshot, then silence forever.
  // Wrapping in try/catch can't fix a malformed record, but it guarantees
  // a single bad field can never again take down the whole sync pipeline,
  // and the error is now shown on screen instead of only in devtools.
  try {
    waitingQueue = Array.isArray(state.waitingQueue) ? state.waitingQueue : [];
    courtPlayers = normalizeCourtPlayers(state.courtPlayers);
    matchHistory = Array.isArray(state.matchHistory) ? state.matchHistory : [];
    recentlyFinished = Array.isArray(state.recentlyFinished) ? state.recentlyFinished : [];

    renderQueue();
    renderCourt();

    const scores = Array.isArray(state.scores) ? state.scores : [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      document.getElementById(`score${i}`).textContent = scores[i] || 0;
    }

    // Visible to Host and Viewer alike — the "sync freezes forever" bug
    // that used to make this look broken on the viewer was a Firebase
    // write-layer issue (see sanitizeForFirebase above), not a visibility
    // one, and that's now fixed regardless of who's looking at the data.
    renderRecentlyFinished();
    renderHistory();

    // Match timer: derived from a shared timestamp so it stays correct across
    // refreshes and shows the same live count for the host and any viewers.
    // 0 (our "not running" sentinel) and missing/non-numeric values both
    // mean "no active match".
    matchStartTime = typeof state.matchStartTime === 'number' && state.matchStartTime > 0
      ? state.matchStartTime
      : null;
    if (matchStartTime !== null) {
      matchTimerDisplay.hidden = false;
      startTimerInterval();
    } else {
      matchTimerDisplay.hidden = true;
      matchTimerDisplay.textContent = '⏱ 00:00';
      stopTimerInterval();
    }

    updateCourtButtons();
    updateTeamLabels();

    lastAppliedAt = Date.now();
    hideSyncError();
  } catch (err) {
    // Surface it ON SCREEN. This is the difference between "it silently
    // breaks and nobody can tell why" and "it breaks, but you can read
    // the exact error off the screen and report it back verbatim."
    console.error('applyState failed on this snapshot:', err, state);
    showSyncError(`Display error: ${err.message}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  addBtn.addEventListener('click', addPlayerToQueue);
  nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addPlayerToQueue();
  });
  nameInput.addEventListener('input', () => nameInput.classList.remove('input-error'));

  photoInput.addEventListener('change', handlePhotoSelected);

  removeBtn.addEventListener('click', removeLastPlayer);
  clearQueueBtn.addEventListener('click', clearQueue);

  fillCourtBtn.addEventListener('click', fillCourt);
  resetCourtBtn.addEventListener('click', resetCourt);
  shuffleBtn.addEventListener('click', shuffleQueue);
  saveBtn.addEventListener('click', saveMatch);
  playBtn.addEventListener('click', startMatch);

  clearHistoryBtn.addEventListener('click', clearHistory);

  // Lets you compare versions on two separate phones with no dev tools:
  // tap the "Synced Xs ago" line on each device and compare the toast.
  // A mismatch here means one device is running stale cached code — the
  // single most common reason "it works on one screen but not the other."
  if (syncStatusText) {
    syncStatusText.addEventListener('click', () => {
      showToast(`Build: ${BUILD_ID}`);
    });
  }

  if (forceSyncBtn) {
    forceSyncBtn.addEventListener('click', () => {
      // Manual, user-triggered escape hatch: pull the current DB state and
      // reapply it right now, regardless of what the live listener or the
      // poll are doing. Gives an immediate, on-demand answer to "is this
      // actually connected?" instead of waiting and hoping.
      if (!roomRef) return;
      forceSyncBtn.classList.add('spinning');
      roomRef
        .once('value')
        .then((snapshot) => {
          const data = snapshot.val();
          if (data) applyState(data);
          showToast('Synced!');
        })
        .catch((err) => {
          showSyncError(`Force sync failed: ${err.code || err.message}`);
        })
        .finally(() => {
          forceSyncBtn.classList.remove('spinning');
        });
    });
  }

  renderQueue();
  renderCourt();
  renderRecentlyFinished();
  renderHistory();
  updateCourtButtons();
  updateTeamLabels();

  // MULTIPLAYER: set up Host (QR + writes) or Viewer (read-only listener).
  initMultiplayer();
});

/* ---------------------------------------------------------
   Toast — small non-blocking notifications (mobile-friendly,
   replaces jarring alert() popups)
--------------------------------------------------------- */
let toastTimer = null;
function showToast(message, isError = false) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.querySelector('.app-frame').appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast show' + (isError ? ' toast-error' : '');
  clearTimeout(toastTimer);
  // Errors stay up longer (4.5s vs 2.2s) — a sync failure is easy to miss
  // otherwise, and missing it is exactly how this class of bug goes unnoticed.
  toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 4500 : 2200);
}

/* ---------------------------------------------------------
   Photo picker (used when adding a new player)
   -----------------------------------------------------------
   SYNC RELIABILITY: a raw photo straight off a phone camera can easily be
   several MB. Every player photo gets embedded as base64 in THREE places
   (waitingQueue/courtPlayers, every matchHistory entry, and
   recentlyFinished), and the whole state document is pushed to Firebase
   in one update() call — so a session with a few dozen full-size photos
   can turn into a multi-megabyte write. That's a very plausible cause of
   "history/photos stop syncing to viewers after a while": the write gets
   slow, times out on a shaky mobile connection, or bumps into Firebase's
   per-node size limits, and fails silently in the background.
   Downscaling + re-compressing to a small JPEG here (well before the
   image is ever added to state) keeps every stored photo well under
   ~30-50KB regardless of what the camera produced, so this class of
   failure shouldn't happen anymore.
--------------------------------------------------------- */
const PHOTO_MAX_DIMENSION = 160; // px, long edge
const PHOTO_JPEG_QUALITY = 0.72;

function compressImageFile(file, maxDimension, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function handlePhotoSelected() {
  const file = photoInput.files && photoInput.files[0];
  if (!file) return;

  compressImageFile(file, PHOTO_MAX_DIMENSION, PHOTO_JPEG_QUALITY)
    .then((dataUrl) => {
      pendingPhoto = dataUrl;
      photoPreview.src = pendingPhoto;
      photoPreview.classList.add('has-photo');
      photoPickerIcon.style.display = 'none';
    })
    .catch((err) => {
      console.error('Photo processing failed:', err);
      showToast('Could not use that photo — try a different one', true);
      resetPhotoPicker();
    });
}

function resetPhotoPicker() {
  pendingPhoto = null;
  photoInput.value = '';
  photoPreview.src = '';
  photoPreview.classList.remove('has-photo');
  photoPickerIcon.style.display = '';
}

/* ---------------------------------------------------------
   Avatar rendering helper — used everywhere a player photo
   shows up. Falls back to a solid initial box when there's
   no photo, so the "box" shape is always filled.
--------------------------------------------------------- */
function createAvatarElement(player, className) {
  if (player && player.photo) {
    const img = document.createElement('img');
    img.src = player.photo;
    img.alt = player.name || '';
    img.className = className;
    return img;
  }
  const div = document.createElement('div');
  div.className = `${className} avatar-fallback`;
  const initial = player && player.name ? player.name.trim().charAt(0).toUpperCase() : '?';
  div.textContent = initial || '?';
  return div;
}

/* ---------------------------------------------------------
   Match timer — starts when PLAY is pressed, ticks live, and
   its start timestamp is synced through Firebase so a page
   refresh (host or viewer) resumes the correct elapsed time
   instead of restarting from zero.
--------------------------------------------------------- */
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function startTimerInterval() {
  stopTimerInterval();
  const tick = () => {
    if (matchStartTime === null) return;
    matchTimerDisplay.textContent = `⏱ ${formatDuration(Date.now() - matchStartTime)}`;
  };
  tick();
  matchTimerInterval = setInterval(tick, 1000);
}

function stopTimerInterval() {
  if (matchTimerInterval) {
    clearInterval(matchTimerInterval);
    matchTimerInterval = null;
  }
}

function startMatch() {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  if (!isCourtOccupied()) {
    showToast('Fill the court before starting the match', true);
    return;
  }
  if (matchStartTime !== null) return; // already running

  matchStartTime = Date.now();
  matchTimerDisplay.hidden = false;
  startTimerInterval();
  updateCourtButtons();
  showToast('Match started!');
  syncStateToFirebase(); // MULTIPLAYER
}

/* ---------------------------------------------------------
   Score controls
--------------------------------------------------------- */
function adjustScore(slotIndex, delta) {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only
  if (!courtPlayers[slotIndex]) return; // no player in this slot yet — nothing to score

  const scoreElement = document.getElementById(`score${slotIndex}`);
  if (!scoreElement) return;

  let currentScore = parseInt(scoreElement.textContent, 10) || 0;
  currentScore = Math.max(0, currentScore + delta);
  scoreElement.textContent = currentScore;
  updateTeamLabels();
  syncStateToFirebase(); // MULTIPLAYER
}

function updateTeamLabels() {
  const s0 = parseInt(document.getElementById('score0').textContent, 10) || 0;
  const s1 = parseInt(document.getElementById('score1').textContent, 10) || 0;
  const s2 = parseInt(document.getElementById('score2').textContent, 10) || 0;
  const s3 = parseInt(document.getElementById('score3').textContent, 10) || 0;

  if (team1Label) team1Label.textContent = `Team 1 [${s0 + s1}]`;
  if (team2Label) team2Label.textContent = `Team 2 [${s2 + s3}]`;
}

/* ---------------------------------------------------------
   Helpers shared across queue / court
--------------------------------------------------------- */
function isCourtOccupied() {
  return courtPlayers.some((p) => p !== null);
}

function isNameInUse(name) {
  const lower = name.toLowerCase();
  const inQueue = waitingQueue.some((p) => p.name.toLowerCase() === lower);
  const onCourt = courtPlayers.some((p) => p && p.name.toLowerCase() === lower);
  return inQueue || onCourt;
}

function updateCourtButtons() {
  const occupied = isCourtOccupied();
  fillCourtBtn.disabled = occupied;
  saveBtn.disabled = !occupied;
  resetCourtBtn.disabled = !occupied;
  playBtn.disabled = !occupied || matchStartTime !== null;
  updateScoreButtonsLocked();
}

// Disables the +/- buttons for any slot that doesn't have a player yet,
// so scores can't be bumped before someone is actually standing there.
function updateScoreButtonsLocked() {
  for (let i = 0; i < 4; i++) {
    const hasPlayer = !!courtPlayers[i];
    const minusBtn = document.querySelector(`#slot${i} .score-minus`);
    const plusBtn = document.querySelector(`#slot${i} .score-plus`);
    if (minusBtn) minusBtn.disabled = !hasPlayer;
    if (plusBtn) plusBtn.disabled = !hasPlayer;
  }
}

/* ---------------------------------------------------------
   Waiting queue
--------------------------------------------------------- */
function addPlayerToQueue() {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  const name = nameInput.value.trim();
  if (!name) return;

  if (isNameInUse(name)) {
    showToast(`"${name}" is already in the queue or on the court`, true);
    nameInput.classList.add('input-error');
    return;
  }

  waitingQueue.push({ name, photo: pendingPhoto });
  nameInput.value = '';
  nameInput.classList.remove('input-error');
  resetPhotoPicker();
  nameInput.focus();
  renderQueue();
  syncStateToFirebase(); // MULTIPLAYER
}

function removePlayerAt(index) {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  waitingQueue.splice(index, 1);
  renderQueue();
  syncStateToFirebase(); // MULTIPLAYER
}

function removeLastPlayer() {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  if (waitingQueue.length > 0) {
    waitingQueue.pop();
    renderQueue();
    syncStateToFirebase(); // MULTIPLAYER
  } else {
    showToast('Queue is already empty', true);
  }
}

function clearQueue() {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  if (waitingQueue.length === 0) return;
  if (!confirm('Clear the entire waiting queue?')) return;
  waitingQueue = [];
  renderQueue();
  syncStateToFirebase(); // MULTIPLAYER
}

function shuffleQueue() {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  if (waitingQueue.length < 2) return;
  for (let i = waitingQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [waitingQueue[i], waitingQueue[j]] = [waitingQueue[j], waitingQueue[i]];
  }
  renderQueue();
  syncStateToFirebase(); // MULTIPLAYER
}

function renderQueue() {
  queueList.innerHTML = '';

  if (waitingQueue.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-hint';
    empty.textContent = 'No players waiting';
    queueList.appendChild(empty);
  } else {
    waitingQueue.forEach((player, index) => {
      const li = document.createElement('li');
      li.className = 'queue-row';

      const left = document.createElement('div');
      left.className = 'queue-left';

      const avatar = createAvatarElement(player, 'queue-photo');

      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${player.name}`;

      left.appendChild(avatar);
      left.appendChild(label);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'queue-del-btn';
      delBtn.textContent = '\u00d7';
      delBtn.setAttribute('aria-label', `Remove ${player.name}`);
      delBtn.addEventListener('click', () => removePlayerAt(index));

      li.appendChild(left);
      li.appendChild(delBtn);
      queueList.appendChild(li);
    });
  }

  queueCount.textContent = `${waitingQueue.length} player${waitingQueue.length !== 1 ? 's' : ''}`;
}

/* ---------------------------------------------------------
   Court
--------------------------------------------------------- */
function setSlotPlayer(index, player) {
  const nameSpan = document.querySelector(`#slot${index} .player-name`);
  const photoWrap = document.querySelector(`#slot${index} .player-photo-wrap`);
  photoWrap.innerHTML = '';

  if (player) {
    nameSpan.textContent = player.name;
    photoWrap.appendChild(createAvatarElement(player, 'court-photo'));
  } else {
    nameSpan.textContent = EMPTY_SLOT;
  }
}

function renderCourt() {
  for (let i = 0; i < 4; i++) {
    setSlotPlayer(i, courtPlayers[i]);
  }
}

function fillCourt() {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  if (isCourtOccupied()) {
    showToast('Court already has players — save or reset the match first', true);
    return;
  }

  if (waitingQueue.length < 4) {
    showToast(`Need ${4 - waitingQueue.length} more player(s) to fill the court`, true);
    return;
  }

  for (let i = 0; i < 4; i++) {
    courtPlayers[i] = waitingQueue.shift();
  }

  // Safety net: a fresh court should never inherit a running timer.
  matchStartTime = null;
  stopTimerInterval();
  matchTimerDisplay.hidden = true;
  matchTimerDisplay.textContent = '⏱ 00:00';

  renderCourt();
  renderQueue();
  updateCourtButtons();
  updateTeamLabels();
  syncStateToFirebase(); // MULTIPLAYER
}

function resetCourt() {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  if (!isCourtOccupied()) {
    showToast('Court is already empty', true);
    return;
  }

  // Walk slots back-to-front so unshift() restores the original slot order.
  for (let i = 3; i >= 0; i--) {
    if (courtPlayers[i]) {
      waitingQueue.unshift(courtPlayers[i]);
      courtPlayers[i] = null;
    }
    document.getElementById(`score${i}`).textContent = '0';
  }

  // Abandoning the match without saving — clear the timer too.
  matchStartTime = null;
  stopTimerInterval();
  matchTimerDisplay.hidden = true;
  matchTimerDisplay.textContent = '⏱ 00:00';

  renderCourt();
  renderQueue();
  updateCourtButtons();
  updateTeamLabels();
  syncStateToFirebase(); // MULTIPLAYER
}

function saveMatch() {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  if (!isCourtOccupied()) {
    showToast('No active match on the court', true);
    return;
  }

  if (courtPlayers.some((p) => p === null)) {
    showToast('Please fill all four court slots before saving', true);
    return;
  }

  const scores = [0, 1, 2, 3].map(
    (i) => parseInt(document.getElementById(`score${i}`).textContent, 10) || 0
  );
  const team1Total = scores[0] + scores[1];
  const team2Total = scores[2] + scores[3];

  // Duration is only meaningful if PLAY was actually pressed; otherwise
  // there's nothing to clock, so it's omitted from the record.
  const duration = matchStartTime !== null ? formatDuration(Date.now() - matchStartTime) : null;

  const matchRecord = {
    players: courtPlayers.map((p, i) => ({ name: p.name, photo: p.photo, score: scores[i] })),
    team1Total,
    team2Total,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    duration,
  };

  matchHistory.unshift(matchRecord);
  // Cap how many matches we keep. Every entry can carry up to 4 embedded
  // player photos as base64 — left unbounded, this room's Firebase node
  // grows without limit and every load gets slower and more failure-prone.
  // Photos are now compressed to ~30-50KB max each (see
  // compressImageFile/PHOTO_MAX_DIMENSION above), so 200 matches — far
  // more than the 20+ a single session needs — stays a manageable size.
  const MAX_HISTORY = 200;
  if (matchHistory.length > MAX_HISTORY) {
    matchHistory.length = MAX_HISTORY;
  }
  // Append (never overwrite) so anyone still waiting to be requeued isn't lost.
  recentlyFinished = recentlyFinished.concat(
    courtPlayers.map((p) => ({ name: p.name, photo: p.photo }))
  );

  renderHistory();
  renderRecentlyFinished();

  courtPlayers = [null, null, null, null];
  for (let i = 0; i < 4; i++) {
    document.getElementById(`score${i}`).textContent = '0';
  }

  // Match is over — clear the timer for the next one.
  matchStartTime = null;
  stopTimerInterval();
  matchTimerDisplay.hidden = true;
  matchTimerDisplay.textContent = '⏱ 00:00';

  renderCourt();
  updateCourtButtons();
  updateTeamLabels();
  showToast('Match saved!');
  syncStateToFirebase(); // MULTIPLAYER — single update() call carries court
                         // reset, matchHistory, recentlyFinished, and the
                         // cleared timer state to every client together.
}

/* ---------------------------------------------------------
   Recently finished
--------------------------------------------------------- */
function renderRecentlyFinished() {
  finishedContainer.innerHTML = '';

  if (recentlyFinished.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'No finished players yet';
    finishedContainer.appendChild(empty);
    return;
  }

  recentlyFinished.forEach((player, index) => {
    if (!player || !player.name) {
      console.error('Skipping malformed recentlyFinished entry:', player);
      return;
    }

    const row = document.createElement('div');
    row.className = 'requeue-row';

    const left = document.createElement('div');
    left.className = 'requeue-left';
    left.appendChild(createAvatarElement(player, 'finished-photo'));

    const label = document.createElement('span');
    label.textContent = player.name;
    left.appendChild(label);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary small-btn';
    btn.textContent = '+ Requeue';
    btn.addEventListener('click', () => requeuePlayer(index));

    row.appendChild(left);
    row.appendChild(btn);
    finishedContainer.appendChild(row);
  });
}

function requeuePlayer(index) {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  const player = recentlyFinished[index];
  if (!player) return;

  if (isNameInUse(player.name)) {
    showToast(`"${player.name}" is already in the queue`, true);
    return;
  }

  recentlyFinished.splice(index, 1);
  waitingQueue.push(player);
  renderQueue();
  renderRecentlyFinished();
  syncStateToFirebase(); // MULTIPLAYER
}

/* ---------------------------------------------------------
   Match history
--------------------------------------------------------- */
function renderHistory() {
  historyList.innerHTML = '';

  if (matchHistory.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = 'No matches played yet';
    historyList.appendChild(empty);
    return;
  }

  matchHistory.forEach((match) => {
    // Defensive: skip a single malformed record instead of throwing and
    // leaving every match AFTER it in the list unrendered. A record could
    // be malformed if a very old client version wrote a different shape,
    // or a snapshot arrived mid-write.
    if (!match || !Array.isArray(match.players) || match.players.length < 4) {
      console.error('Skipping malformed match history entry:', match);
      return;
    }

    const item = document.createElement('div');
    item.className = 'history-item';

    // Fallback objects so a single missing player field (e.g. an old
    // record saved before "score" existed) can't crash the whole render.
    const [p0, p1, p2, p3] = match.players.map((p) => ({
      name: 'Unknown',
      score: 0,
      ...(p || {}),
    }));

    const team1Total = match.team1Total ?? 0;
    const team2Total = match.team2Total ?? 0;

    let winner = null;
    if (team1Total > team2Total) winner = 1;
    else if (team2Total > team1Total) winner = 2;

    const content = document.createElement('div');
    content.className = 'history-content';

    const main = document.createElement('div');
    main.className = 'history-main';

    const team1Line = document.createElement('div');
    team1Line.className = 'history-line' + (winner === 1 ? ' winner-line' : '');
    team1Line.textContent = `${winner === 1 ? '\uD83C\uDFC6 ' : ''}${p0.name} (${p0.score}) & ${p1.name} (${p1.score}) [${team1Total}]`;

    const vsLine = document.createElement('div');
    vsLine.className = 'history-vs';
    vsLine.textContent = winner ? 'VS' : '\uD83E\uDD1D VS';

    const team2Line = document.createElement('div');
    team2Line.className = 'history-line' + (winner === 2 ? ' winner-line' : '');
    team2Line.textContent = `${winner === 2 ? '\uD83C\uDFC6 ' : ''}${p2.name} (${p2.score}) & ${p3.name} (${p3.score}) [${team2Total}]`;

    main.appendChild(team1Line);
    main.appendChild(vsLine);
    main.appendChild(team2Line);

    // Show the winning team's two photos on the right. On a tie, default
    // to team 1's photos since there's no outright winner to feature.
    const photosWrap = document.createElement('div');
    photosWrap.className = 'history-photos';
    const winningPlayers = winner === 2 ? [p2, p3] : [p0, p1];
    winningPlayers.forEach((p) => {
      photosWrap.appendChild(createAvatarElement(p, 'history-photo'));
    });

    content.appendChild(main);
    content.appendChild(photosWrap);

    const time = document.createElement('div');
    time.className = 'history-time';
    time.textContent = match.duration ? `${match.time} · ${match.duration}` : match.time;

    item.appendChild(content);
    item.appendChild(time);
    historyList.appendChild(item);
  });
}

function clearHistory() {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

  if (matchHistory.length === 0) return;
  if (!confirm('Clear match history?')) return;
  matchHistory = [];
  renderHistory();
  syncStateToFirebase(); // MULTIPLAYER
}
