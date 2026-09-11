const EMPTY_SLOT = '— —';

let waitingQueue = [];
let matchHistory = [];
let recentlyFinished = [];

const nameInput = document.getElementById('nameInput');
const addBtn = document.getElementById('addBtn');
const removeBtn = document.getElementById('removeBtn');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');

const fillCourtBtn = document.getElementById('fillCourtBtn');
const resetCourtBtn = document.getElementById('resetCourtBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const saveBtn = document.getElementById('saveBtn');

const finishedContainer = document.getElementById('finishedContainer');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

document.addEventListener('DOMContentLoaded', () => {
  addBtn.addEventListener('click', addPlayerToQueue);
  nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addPlayerToQueue();
  });
  nameInput.addEventListener('input', () => nameInput.classList.remove('input-error'));

  removeBtn.addEventListener('click', removeLastPlayer);
  clearQueueBtn.addEventListener('click', clearQueue);

  fillCourtBtn.addEventListener('click', fillCourt);
  resetCourtBtn.addEventListener('click', resetCourt);
  shuffleBtn.addEventListener('click', shuffleQueue);
  saveBtn.addEventListener('click', saveMatch);

  clearHistoryBtn.addEventListener('click', clearHistory);

  renderQueue();
  renderRecentlyFinished();
  renderHistory();
  updateCourtButtons();
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
   Score controls
--------------------------------------------------------- */
function adjustScore(slotIndex, delta) {
  const scoreElement = document.getElementById(`score${slotIndex}`);
  if (!scoreElement) return;

  let currentScore = parseInt(scoreElement.textContent, 10) || 0;
  currentScore = Math.max(0, currentScore + delta);
  scoreElement.textContent = currentScore;
}

/* ---------------------------------------------------------
   Helpers shared across queue / court
--------------------------------------------------------- */
function getCourtPlayers() {
  const players = [];
  for (let i = 0; i < 4; i++) {
    const span = document.querySelector(`#slot${i} .player-name`);
    const text = span ? span.textContent : EMPTY_SLOT;
    players.push(text === EMPTY_SLOT ? null : text);
  }
  return players;
}

function isCourtOccupied() {
  return getCourtPlayers().some((p) => p !== null);
}

function isNameInUse(name) {
  const lower = name.toLowerCase();
  const inQueue = waitingQueue.some((p) => p.toLowerCase() === lower);
  const onCourt = getCourtPlayers().some((p) => p && p.toLowerCase() === lower);
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
  const name = nameInput.value.trim();
  if (!name) return;

  if (isNameInUse(name)) {
    showToast(`"${name}" is already in the queue or on the court`, true);
    nameInput.classList.add('input-error');
    return;
  }

  waitingQueue.push(name);
  nameInput.value = '';
  nameInput.classList.remove('input-error');
  nameInput.focus();
  renderQueue();
}

function removePlayerAt(index) {
  waitingQueue.splice(index, 1);
  renderQueue();
}

function removeLastPlayer() {
  if (waitingQueue.length > 0) {
    waitingQueue.pop();
    renderQueue();
  } else {
    showToast('Queue is already empty', true);
  }
}

function clearQueue() {
  if (waitingQueue.length === 0) return;
  if (!confirm('Clear the entire waiting queue?')) return;
  waitingQueue = [];
  renderQueue();
}

function shuffleQueue() {
  if (waitingQueue.length < 2) return;
  for (let i = waitingQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [waitingQueue[i], waitingQueue[j]] = [waitingQueue[j], waitingQueue[i]];
  }
  renderQueue();
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

      const label = document.createElement('span');
      label.textContent = `${index + 1}. ${player}`;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'queue-del-btn';
      delBtn.textContent = '\u00d7';
      delBtn.setAttribute('aria-label', `Remove ${player}`);
      delBtn.addEventListener('click', () => removePlayerAt(index));

      li.appendChild(label);
      li.appendChild(delBtn);
      queueList.appendChild(li);
    });
  }

  queueCount.textContent = `${waitingQueue.length} player${waitingQueue.length !== 1 ? 's' : ''}`;
}

/* ---------------------------------------------------------
   Court
--------------------------------------------------------- */
function fillCourt() {
  if (isCourtOccupied()) {
    showToast('Court already has players — save or reset the match first', true);
    return;
  }

  if (waitingQueue.length < 4) {
    showToast(`Need ${4 - waitingQueue.length} more player(s) to fill the court`, true);
    return;
  }

  for (let i = 0; i < 4; i++) {
    const playerName = waitingQueue.shift();
    document.querySelector(`#slot${i} .player-name`).textContent = playerName;
    document.getElementById(`score${i}`).textContent = '0';
  }

  renderQueue();
  updateCourtButtons();
}

function resetCourt() {
  if (!isCourtOccupied()) {
    showToast('Court is already empty', true);
    return;
  }

  // Walk slots back-to-front so unshift() restores the original slot order.
  for (let i = 3; i >= 0; i--) {
    const nameSpan = document.querySelector(`#slot${i} .player-name`);
    if (nameSpan.textContent !== EMPTY_SLOT) {
      waitingQueue.unshift(nameSpan.textContent);
      nameSpan.textContent = EMPTY_SLOT;
    }
    document.getElementById(`score${i}`).textContent = '0';
  }

  renderQueue();
  updateCourtButtons();
}

function saveMatch() {
  if (!isCourtOccupied()) {
    showToast('No active match on the court', true);
    return;
  }

  const players = getCourtPlayers();
  if (players.some((p) => p === null)) {
    showToast('Please fill all four court slots before saving', true);
    return;
  }

  const scores = [0, 1, 2, 3].map(
    (i) => parseInt(document.getElementById(`score${i}`).textContent, 10) || 0
  );
  const team1Total = scores[0] + scores[1];
  const team2Total = scores[2] + scores[3];

  const matchRecord = {
    players: players.map((name, i) => ({ name, score: scores[i] })),
    team1Total,
    team2Total,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };

  matchHistory.unshift(matchRecord);
  // Append (never overwrite) so anyone still waiting to be requeued isn't lost.
  recentlyFinished = recentlyFinished.concat(players);

  renderHistory();
  renderRecentlyFinished();

  for (let i = 0; i < 4; i++) {
    document.querySelector(`#slot${i} .player-name`).textContent = EMPTY_SLOT;
    document.getElementById(`score${i}`).textContent = '0';
  }

  updateCourtButtons();
  showToast('Match saved!');
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

    const label = document.createElement('span');
    label.textContent = player;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary small-btn';
    btn.textContent = '+ Requeue';
    btn.addEventListener('click', () => requeuePlayer(index));

    row.appendChild(label);
    row.appendChild(btn);
    finishedContainer.appendChild(row);
  });
}

function requeuePlayer(index) {
  const player = recentlyFinished[index];
  if (!player) return;

  if (isNameInUse(player)) {
    showToast(`"${player}" is already in the queue`, true);
    return;
  }

  recentlyFinished.splice(index, 1);
  waitingQueue.push(player);
  renderQueue();
  renderRecentlyFinished();
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

    const line = document.createElement('div');
    line.className = 'history-line';

    const icon = document.createTextNode(winner ? '\uD83C\uDFC6 ' : '\uD83E\uDD1D ');

    const t1 = document.createElement(winner === 1 ? 'strong' : 'span');
    t1.textContent = `${p0.name} (${p0.score}) & ${p1.name} (${p1.score}) [${match.team1Total}]`;

    const vs = document.createElement('span');
    vs.className = 'vs-label';
    vs.textContent = ' VS ';

    const t2 = document.createElement(winner === 2 ? 'strong' : 'span');
    t2.textContent = `${p2.name} (${p2.score}) & ${p3.name} (${p3.score}) [${match.team2Total}]`;

    line.appendChild(icon);
    line.appendChild(t1);
    line.appendChild(vs);
    line.appendChild(t2);

    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = match.time;

    const row = document.createElement('div');
    row.className = 'history-row';
    row.appendChild(line);
    row.appendChild(time);

    item.appendChild(row);
    historyList.appendChild(item);
  });
}

function clearHistory() {
  if (matchHistory.length === 0) return;
  if (!confirm('Clear match history?')) return;
  matchHistory = [];
  renderHistory();
}
