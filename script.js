const EMPTY_SLOT = '— —';

let waitingQueue = [];       // array of { name, photo }
let courtPlayers = [null, null, null, null]; // each null or { name, photo }
let matchHistory = [];       // array of { players:[{name,score,photo} x4], team1Total, team2Total, time }
let recentlyFinished = [];   // array of { name, photo }
let pendingPhoto = null;     // data URL for the photo about to be added
let matchStartTime = null;   // timestamp (ms) the current match's timer started, or null if not running
let matchTimerInterval = null; // setInterval handle for the live ticking display
let lastAppliedUpdatedAt = 0;  // guards against ever applying a snapshot older than what we already have

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
--------------------------------------------------------- */
function forceResync() {
  if (!roomRef) return;
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
}

function initMultiplayer() {
  if (isHost) {
    if (!roomId) {
      roomId = generateRoomId();
      // Keep the room id in the URL so refreshing the host page resumes
      // the same room instead of spinning up a brand new one.
      const newUrl = `${window.location.pathname}?room=${roomId}`;
      window.history.replaceState({}, '', newUrl);
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

    roomRef = db.ref(`rooms/${roomId}`);
    roomRef.on(
      'value',
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          applyState(data);
        } else {
          showToast('Waiting for the host to start the session…');
        }
      },
      (err) => {
        console.error('Firebase listener error:', err);
        showToast('Could not connect to this room — check the link', true);
      }
    );

    setupConnectionWatchdog();
  }
}

function renderRoomBar() {
  qrToggleBtn.hidden = false;
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

// HOST -> FIREBASE: pushes the entire app state to rooms/{roomId}.
// Called at the end of every action that mutates state.
function syncStateToFirebase() {
  if (!isHost || !roomRef) return;

  // Stamped and recorded BEFORE the write goes out, optimistically, so that
  // if a poll or listener event for this same ref lands in the gap before
  // the write is acknowledged, it can never look "newer" than this and
  // revert what the user just did.
  const updatedAt = Date.now();
  lastAppliedUpdatedAt = updatedAt;

  roomRef
    .set({
      waitingQueue,
      courtPlayers,
      scores: getCurrentScores(),
      matchHistory,
      recentlyFinished,
      matchStartTime,
      updatedAt,
    })
    .catch((err) => {
      console.error('Firebase sync failed:', err);
      showToast('Could not sync to viewers — check Firebase config', true);
    });
}

// FIREBASE -> UI: rebuilds local state + re-renders from a Firebase
// snapshot. Runs on both Host and Viewer whenever rooms/{roomId} changes,
// and also whenever forceResync() pulls a fresh snapshot after a
// reconnect/tab-restore/poll.
//
// GUARDED: every write stamps `updatedAt: Date.now()`. If an incoming
// snapshot's `updatedAt` is older than the newest one we've already
// applied, it's ignored outright. Without this, a stale read (from the
// periodic poll, a lingering second tab on the same room, or a listener
// catching up after being throttled) could silently overwrite a fresh
// save/reset with old data — which is exactly what was happening before
// this guard existed.
function applyState(state) {
  const incomingUpdatedAt = typeof state.updatedAt === 'number' ? state.updatedAt : 0;
  if (incomingUpdatedAt < lastAppliedUpdatedAt) {
    console.warn(
      `Ignoring stale room snapshot (updatedAt ${incomingUpdatedAt} is older than ${lastAppliedUpdatedAt})`
    );
    return;
  }
  lastAppliedUpdatedAt = incomingUpdatedAt;

  waitingQueue = Array.isArray(state.waitingQueue) ? state.waitingQueue : [];

  courtPlayers = Array.isArray(state.courtPlayers) ? state.courtPlayers.slice(0, 4) : [];
  while (courtPlayers.length < 4) courtPlayers.push(null);

  matchHistory = Array.isArray(state.matchHistory) ? state.matchHistory : [];
  recentlyFinished = Array.isArray(state.recentlyFinished) ? state.recentlyFinished : [];

  renderQueue();
  renderCourt();

  const scores = Array.isArray(state.scores) ? state.scores : [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    document.getElementById(`score${i}`).textContent = scores[i] || 0;
  }

  renderRecentlyFinished();
  renderHistory();

  // Match timer: derived from a shared timestamp so it stays correct across
  // refreshes and shows the same live count for the host and any viewers.
  matchStartTime = typeof state.matchStartTime === 'number' ? state.matchStartTime : null;
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
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

/* ---------------------------------------------------------
   Photo picker (used when adding a new player)
--------------------------------------------------------- */
function handlePhotoSelected() {
  const file = photoInput.files && photoInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    pendingPhoto = e.target.result;
    photoPreview.src = pendingPhoto;
    photoPreview.classList.add('has-photo');
    photoPickerIcon.style.display = 'none';
  };
  reader.readAsDataURL(file);
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
  syncStateToFirebase(); // MULTIPLAYER
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
    const item = document.createElement('div');
    item.className = 'history-item';

    const [p0, p1, p2, p3] = match.players;

    let winner = null;
    if (match.team1Total > match.team2Total) winner = 1;
    else if (match.team2Total > match.team1Total) winner = 2;

    const content = document.createElement('div');
    content.className = 'history-content';

    const main = document.createElement('div');
    main.className = 'history-main';

    const team1Line = document.createElement('div');
    team1Line.className = 'history-line' + (winner === 1 ? ' winner-line' : '');
    team1Line.textContent = `${winner === 1 ? '\uD83C\uDFC6 ' : ''}${p0.name} (${p0.score}) & ${p1.name} (${p1.score}) [${match.team1Total}]`;

    const vsLine = document.createElement('div');
    vsLine.className = 'history-vs';
    vsLine.textContent = winner ? 'VS' : '\uD83E\uDD1D VS';

    const team2Line = document.createElement('div');
    team2Line.className = 'history-line' + (winner === 2 ? ' winner-line' : '');
    team2Line.textContent = `${winner === 2 ? '\uD83C\uDFC6 ' : ''}${p2.name} (${p2.score}) & ${p3.name} (${p3.score}) [${match.team2Total}]`;

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
