const EMPTY_SLOT = '— —';

let waitingQueue = [];       // array of { name, photo }
let courtPlayers = [null, null, null, null]; // each null or { name, photo }
let matchHistory = [];       // array of { players:[{name,score,photo} x4], team1Total, team2Total, time }
let recentlyFinished = [];   // array of { name, photo }
let pendingPhoto = null;     // data URL for the photo about to be added

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

const finishedContainer = document.getElementById('finishedContainer');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

const team1Label = document.getElementById('team1Label');
const team2Label = document.getElementById('team2Label');

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

    // Any change under rooms/{roomId} (including the host's own writes)
    // re-renders the UI from the authoritative Firebase copy.
    roomRef.on('value', (snapshot) => {
      const data = snapshot.val();
      if (data) applyState(data);
    });

    renderRoomBar();

    // FIX: only seed Firebase with the (empty) local state if this room
    // doesn't already have data. Previously this always ran immediately,
    // racing against the 'value' listener above — on a host refresh, local
    // vars reset to empty and this write could land first, wiping out the
    // tournament that was already saved in Firebase.
    roomRef.once('value').then((snapshot) => {
      if (!snapshot.exists()) {
        syncStateToFirebase();
      }
    });
  } else {
    if (!roomId) {
      showToast('No room code in this link', true);
      return;
    }

    viewerRoomCode.textContent = roomId;
    viewerBadge.hidden = false;

    roomRef = db.ref(`rooms/${roomId}`);
    roomRef.on('value', (snapshot) => {
      const data = snapshot.val();
      if (data) {
        applyState(data);
      } else {
        showToast('Waiting for the host to start the session…');
      }
    });
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
  roomRef
    .set({
      waitingQueue,
      courtPlayers,
      scores: getCurrentScores(),
      matchHistory,
      recentlyFinished,
      updatedAt: Date.now(),
    })
    .catch((err) => {
      console.error('Firebase sync failed:', err);
      showToast('Could not sync to viewers — check Firebase config', true);
    });
}

// FIREBASE -> UI: rebuilds local state + re-renders from a Firebase
// snapshot. Runs on both Host and Viewer whenever rooms/{roomId} changes.
function applyState(state) {
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
   Score controls
--------------------------------------------------------- */
function adjustScore(slotIndex, delta) {
  if (isViewerMode) return; // MULTIPLAYER: viewers are read-only

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

  const matchRecord = {
    players: courtPlayers.map((p, i) => ({ name: p.name, photo: p.photo, score: scores[i] })),
    team1Total,
    team2Total,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
    time.textContent = match.time;

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
