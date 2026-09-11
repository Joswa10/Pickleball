// State Management
let waitingQueue = [];
let matchHistory = [];
let recentlyFinished = [];

// DOM Elements
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

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  addBtn.addEventListener('click', addPlayerToQueue);
  nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addPlayerToQueue();
  });

  removeBtn.addEventListener('click', removeLastPlayer);
  clearQueueBtn.addEventListener('click', clearQueue);

  fillCourtBtn.addEventListener('click', fillCourt);
  resetCourtBtn.addEventListener('click', resetCourt);
  shuffleBtn.addEventListener('click', shuffleQueue);
  saveBtn.addEventListener('click', saveMatch);

  clearHistoryBtn.addEventListener('click', clearHistory);
});

// Score Control Handler
function adjustScore(slotIndex, delta) {
  const scoreElement = document.getElementById(`score${slotIndex}`);
  if (!scoreElement) return;

  let currentScore = parseInt(scoreElement.textContent, 10) || 0;
  currentScore = Math.max(0, currentScore + delta);
  scoreElement.textContent = currentScore;
}

// Queue Management Functions
function addPlayerToQueue() {
  const name = nameInput.value.trim();
  if (!name) return;

  waitingQueue.push(name);
  nameInput.value = '';
  renderQueue();
}

function removeLastPlayer() {
  if (waitingQueue.length > 0) {
    waitingQueue.pop();
    renderQueue();
  }
}

function clearQueue() {
  waitingQueue = [];
  renderQueue();
}

function renderQueue() {
  queueList.innerHTML = '';
  waitingQueue.forEach((player, index) => {
    const li = document.createElement('li');
    li.textContent = `${index + 1}. ${player}`;
    queueList.appendChild(li);
  });
  queueCount.textContent = `${waitingQueue.length} player${waitingQueue.length !== 1 ? 's' : ''}`;
}

function shuffleQueue() {
  for (let i = waitingQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [waitingQueue[i], waitingQueue[j]] = [waitingQueue[j], waitingQueue[i]];
  }
  renderQueue();
}

// Court Functions
function fillCourt() {
  if (waitingQueue.length < 4) {
    alert('You need at least 4 players in the waiting queue to fill the court!');
    return;
  }

  for (let i = 0; i < 4; i++) {
    const playerName = waitingQueue.shift();
    const slot = document.getElementById(`slot${i}`);
    slot.querySelector('.player-name').textContent = playerName;
    document.getElementById(`score${i}`).textContent = '0';
  }

  renderQueue();
  saveBtn.disabled = false;
}

function resetCourt() {
  for (let i = 0; i < 4; i++) {
    const slot = document.getElementById(`slot${i}`);
    const nameSpan = slot.querySelector('.player-name');
    
    if (nameSpan.textContent !== '— —') {
      waitingQueue.unshift(nameSpan.textContent);
      nameSpan.textContent = '— —';
    }
    document.getElementById(`score${i}`).textContent = '0';
  }

  renderQueue();
  saveBtn.disabled = true;
}

// Match Handling & History
function saveMatch() {
  const p0 = document.querySelector('#slot0 .player-name').textContent;
  const p1 = document.querySelector('#slot1 .player-name').textContent;
  const p2 = document.querySelector('#slot2 .player-name').textContent;
  const p3 = document.querySelector('#slot3 .player-name').textContent;

  if (p0 === '— —' || p1 === '— —' || p2 === '— —' || p3 === '— —') {
    alert('Please fill all court slots before saving the match.');
    return;
  }

  const s0 = parseInt(document.getElementById('score0').textContent, 10) || 0;
  const s1 = parseInt(document.getElementById('score1').textContent, 10) || 0;
  const s2 = parseInt(document.getElementById('score2').textContent, 10) || 0;
  const s3 = parseInt(document.getElementById('score3').textContent, 10) || 0;

  const team1Score = s0 + s1;
  const team2Score = s2 + s3;

  const matchRecord = {
    team1: [p0, p1],
    team2: [p2, p3],
    team1Score,
    team2Score,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };

  matchHistory.unshift(matchRecord);
  recentlyFinished = [p0, p1, p2, p3];

  renderHistory();
  renderRecentlyFinished();

  for (let i = 0; i < 4; i++) {
    document.querySelector(`#slot${i} .player-name`).textContent = '— —';
    document.getElementById(`score${i}`).textContent = '0';
  }

  saveBtn.disabled = true;
}

function renderRecentlyFinished() {
  finishedContainer.innerHTML = '';
  if (recentlyFinished.length === 0) return;

  recentlyFinished.forEach(player => {
    const row = document.createElement('div');
    row.className = 'requeue-row';
    row.innerHTML = `
      <span>${player}</span>
      <button class="btn-primary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="requeuePlayer('${player}')">+ Requeue</button>
    `;
    finishedContainer.appendChild(row);
  });
}

function requeuePlayer(name) {
  waitingQueue.push(name);
  recentlyFinished = recentlyFinished.filter(p => p !== name);
  renderQueue();
  renderRecentlyFinished();
}

function renderHistory() {
  historyList.innerHTML = '';
  matchHistory.forEach((match) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    
    const team1Text = match.team1.join(' & ');
    const team2Text = match.team2.join(' & ');
    
    item.innerHTML = `
      <strong>${team1Text}</strong> (${match.team1Score}) vs 
      <strong>${team2Text}</strong> (${match.team2Score})
      <span style="float: right; color: #666; font-size: 0.75rem;">${match.time}</span>
    `;
    historyList.appendChild(item);
  });
}

function clearHistory() {
  matchHistory = [];
  renderHistory();
}
