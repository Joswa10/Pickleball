let queue = [];
let court = [];
let history = [];

// DOM Elements
const nameInput = document.getElementById('nameInput');
const addBtn = document.getElementById('addBtn');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');
const fillCourtBtn = document.getElementById('fillCourtBtn');
const saveBtn = document.getElementById('saveBtn');
const historyList = document.getElementById('historyList');
const finishedContainer = document.getElementById('finishedContainer');

// Actions
addBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (name) {
    queue.push(name);
    nameInput.value = '';
    updateQueueUI();
  }
});

function updateQueueUI() {
  queueList.innerHTML = queue.map((p, i) => `<li>${i + 1}. ${p}</li>`).join('');
  queueCount.textContent = `${queue.length} player${queue.length === 1 ? '' : 's'}`;
}

document.getElementById('clearQueueBtn').addEventListener('click', () => {
  queue = [];
  updateQueueUI();
});

document.getElementById('removeBtn').addEventListener('click', () => {
  queue.pop();
  updateQueueUI();
});

document.getElementById('shuffleBtn').addEventListener('click', () => {
  queue.sort(() => Math.random() - 0.5);
  updateQueueUI();
});

fillCourtBtn.addEventListener('click', () => {
  while (court.length < 4 && queue.length > 0) {
    court.push(queue.shift());
  }
  updateQueueUI();
  updateCourtUI();
});

function updateCourtUI() {
  for (let i = 0; i < 4; i++) {
    const slot = document.getElementById(`slot${i}`);
    const nameEl = slot.querySelector('.player-name');
    const inputEl = slot.querySelector('input');
    
    if (court[i]) {
      nameEl.textContent = court[i];
      inputEl.disabled = false;
    } else {
      nameEl.textContent = '— —';
      inputEl.value = 0;
      inputEl.disabled = true;
    }
  }
  saveBtn.disabled = court.length < 4;
}

document.getElementById('resetCourtBtn').addEventListener('click', () => {
  queue.push(...court);
  court = [];
  updateQueueUI();
  updateCourtUI();
});

saveBtn.addEventListener('click', () => {
  const p0 = parseInt(document.getElementById('slot0').querySelector('input').value) || 0;
  const p1 = parseInt(document.getElementById('slot1').querySelector('input').value) || 0;
  const p2 = parseInt(document.getElementById('slot2').querySelector('input').value) || 0;
  const p3 = parseInt(document.getElementById('slot3').querySelector('input').value) || 0;

  const t1 = p0 + p1;
  const t2 = p2 + p3;

  let winner = "🤝 Match Ended in a Tie!";
  if (t1 > t2) winner = `🏆 Winner: Team 1 (${court[0]} & ${court[1]})`;
  if (t2 > t1) winner = `🏆 Winner: Team 2 (${court[2]} & ${court[3]})`;

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const log = `<div class="history-item">
    <b>[${now}] ${winner}</b><br>
    Score: T1 (${t1}) vs T2 (${t2})<br>
    <small>T1: ${court[0]} (${p0}), ${court[1]} (${p1})<br>
    T2: ${court[2]} (${p2}), ${court[3]} (${p3})</small>
  </div>`;

  historyList.innerHTML = log + historyList.innerHTML;

  addFinishedGroup([...court]);
  court = [];
  updateCourtUI();
});

function addFinishedGroup(group) {
  const row = document.createElement('div');
  row.className = 'requeue-row';
  row.innerHTML = `<span>${group.join(', ')}</span> <button class="btn-primary">Re-Queue All</button>`;
  row.querySelector('button').addEventListener('click', () => {
    queue.push(...group);
    updateQueueUI();
    row.remove();
  });
  finishedContainer.prepend(row);
}

document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  historyList.innerHTML = '';
});