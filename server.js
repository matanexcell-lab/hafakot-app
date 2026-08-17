const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const STATE_FILE = '/tmp/state.json';

app.use(express.json());
app.use(express.static('.'));

function getToday() {
  const now = new Date();
  if (now.getHours() < 4) {
    now.setDate(now.getDate() - 1);
  }
  return `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      const today = getToday();
      if (data.date === today) return data;
    }
  } catch(e) {}
  return {
    date: getToday(),
    state: { cig: 0, water: 0 },
    delta: { cig: 0, water: 0 },
    tvSeconds: 0,
    ph: "00", pm: "00", ps: "00"
  };
}

function saveState(data) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(data));
  } catch(e) {}
}

app.get('/api/state', (req, res) => {
  res.json(loadState());
});

app.post('/api/state', (req, res) => {
  const today = getToday();
  const data = { ...req.body, date: today };
  saveState(data);
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});