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

  removeBtn.addEventListener('click', removeLastPlayer);
  clearQueueBtn.addEventListener('click', clearQueue);

  fillCourtBtn.addEventListener('click', fillCourt);
  resetCourtBtn.addEventListener('click', resetCourt);
  shuffleBtn.addEventListener('click', shuffleQueue);
  saveBtn.addEventListener('click', saveMatch);

  clearHistoryBtn.addEventListener('click', clearHistory);
});

function adjustScore(slotIndex, delta) {
  const scoreElement = document.getElementById(`score${slotIndex}`);
  if (!scoreElement) return;

  let currentScore = parseInt(scoreElement.textContent, 10) || 0;
  currentScore = Math.max(0, currentScore + delta);
  scoreElement.textContent = currentScore;
}

function getCourtPlayers() {
  const players = [];
  for (let i = 0; i < 4; i++) {
    const text = document.querySelector(`#slot${i} .player-name`).textContent.trim();
    if (text !== '— —') {
      players.push(text);
    }
  }
  return players;
}

function addPlayerToQueue() {
  const name = nameInput.value.trim();
  if (!name) return;

  const currentCourt = getCourtPlayers();
  const existsInQueue = waitingQueue.some(p => p.toLowerCase() === name.toLowerCase());
  const existsOnCourt = currentCourt.some(p => p.toLowerCase() === name.toLowerCase());

  if (existsInQueue || existsOnCourt) {
    alert(`"${name}" is already in the queue or on the court!`);
    return;
  }

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

function fillCourt() {
  const activeCourt = getCourtPlayers();
  if (activeCourt.length > 0) {
    alert('The court is currently occupied! Reset or Save the current match before filling.');
    return;
  }

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

  const team1Total = s0 + s1;
  const team2Total = s2 + s3;

  const matchRecord = {
    p0: `${p0} (${s0})`,
    p1: `${p1} (${s1})`,
    p2: `${p2} (${s2})`,
    p3: `${p3} (${s3})`,
    team1Total,
    team2Total,
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
  const currentCourt = getCourtPlayers();
  const existsInQueue = waitingQueue.some(p => p.toLowerCase() === name.toLowerCase());
  const existsOnCourt = currentCourt.some(p => p.toLowerCase() === name.toLowerCase());

  if (existsInQueue || existsOnCourt) {
    alert(`"${name}" is already back in the queue or on the court!`);
    return;
  }

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
    
    const team1Text = `${match.p0} & ${match.p1}`;
    const team2Text = `${match.p2} & ${match.p3}`;
    
    let outcomeHTML = '';
    if (match.team1Total > match.team2Total) {
      outcomeHTML = `🏆 <b>${team1Text}</b> [${match.team1Total}] vs ${team2Text} [${match.team2Total}]`;
    } else if (match.team2Total > match.team1Total) {
      outcomeHTML = `${team1Text} [${match.team1Total}] vs 🏆 <b>${team2Text}</b> [${match.team2Total}]`;
    } else {
      outcomeHTML = `🤝 <b>TIE:</b> ${team1Text} [${match.team1Total}] vs ${team2Text} [${match.team2Total}]`;
    }
    
    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span>${outcomeHTML}</span>
        <span style="color: #556b55; font-size: 0.72rem; font-weight: 600; margin-left: 8px;">${match.time}</span>
      </div>
    `;
    historyList.appendChild(item);
  });
}

function clearHistory() {
  matchHistory = [];
  renderHistory();
}
