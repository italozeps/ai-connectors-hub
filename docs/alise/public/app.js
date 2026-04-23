// Tekošais teksts no seminaras.html (caur postMessage)
let currentTextContext = '';
window.addEventListener('message', (e) => {
  const allowed = [window.location.origin, 'http://localhost:8888', 'null'];
  if (!allowed.includes(e.origin)) return;
  if (e.data?.type === 'currentText') currentTextContext = e.data.value || '';
});

const fileInput = document.getElementById('fileInput');
const fileLabel = document.getElementById('fileLabel');
const fileName = document.getElementById('fileName');
const readBtn = document.getElementById('readBtn');
const status = document.getElementById('status');
const audioPlayer = document.getElementById('audioPlayer');
const downloadBtn = document.getElementById('downloadBtn');

// Faila izvēle
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) {
    fileName.textContent = file.name;
    fileLabel.classList.add('has-file');
    readBtn.disabled = false;
    hideStatus();
    audioPlayer.classList.add('hidden');
    downloadBtn.classList.add('hidden');
  }
});

// Lasīšanas poga
readBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  setStatus('Apstrādā failu...', 'info');
  readBtn.disabled = true;
  readBtn.classList.add('loading');
  readBtn.textContent = '⏳ Apstrādā...';
  audioPlayer.classList.add('hidden');

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/read', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Nezināma kļūda');
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    audioPlayer.src = audioUrl;
    audioPlayer.classList.remove('hidden');
    audioPlayer.play();

    downloadBtn.href = audioUrl;
    downloadBtn.download = `alise-${file.name.replace(/\.[^.]+$/, '')}.mp3`;
    downloadBtn.classList.remove('hidden');

    setStatus('Alise lasa...', 'success');
  } catch (err) {
    setStatus(`Kļūda: ${err.message}`, 'error');
  } finally {
    readBtn.disabled = false;
    readBtn.classList.remove('loading');
    readBtn.textContent = '▶ Lasīt';
  }
});

function setStatus(msg, type) {
  status.textContent = msg;
  status.className = `status ${type}`;
}

function hideStatus() {
  status.className = 'status hidden';
}

// ========== REŽĪMS B: Mikrofons ==========

const tabBtns = document.querySelectorAll('.tab-btn');
const modeA = document.getElementById('modeA');
const modeB = document.getElementById('modeB');
const micBtn = document.getElementById('micBtn');
const micStatus = document.getElementById('micStatus');
const micTranscript = document.getElementById('micTranscript');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.mode === 'a') {
      modeA.classList.remove('hidden');
      modeB.classList.add('hidden');
      stopMic();
    } else {
      modeA.classList.add('hidden');
      modeB.classList.remove('hidden');
    }
  });
});

const WAKE_WORDS = ['alise', 'alice', 'alis'];

let recognition = null;
let micActive = false;
let micState = 'idle'; // idle | listening | question | processing | speaking
let collectQuestion = false;
let micAudio = new Audio();

micBtn.addEventListener('click', () => {
  if (micActive) {
    stopMic();
  } else {
    startMic();
  }
});

function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setMicStatus('Pārlūks neatbalsta mikrofonu. Izmanto Chrome.', 'error');
    return;
  }

  recognition = new SR();
  recognition.lang = 'lv-LV';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = onSpeechResult;

  recognition.onspeechstart = () => {
    if (micState === 'speaking') {
      micAudio.pause();
      micAudio.src = '';
      micState = 'listening';
      setMicStatus('Klausos... (saki "Alise")', 'info');
    }
  };

  recognition.onend = () => {
    if (micActive) recognition.start();
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    setMicStatus(`Mikrofona kļūda: ${e.error}`, 'error');
  };

  micActive = true;
  micState = 'listening';
  recognition.start();

  micBtn.textContent = '◼ Apturēt mikrofonu';
  micBtn.classList.add('mic-on');
  setMicStatus('Klausos... (saki "Alise")', 'info');
  micTranscript.classList.remove('hidden');
  micTranscript.textContent = '';
}

function stopMic() {
  micActive = false;
  micState = 'idle';
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
  micAudio.pause();
  micAudio.src = '';
  micBtn.textContent = '⬤ Aktivizēt mikrofonu';
  micBtn.classList.remove('mic-on');
  setMicStatus('', 'hidden');
  micTranscript.classList.add('hidden');
}

function onSpeechResult(event) {
  let interim = '';
  let final = '';

  for (let i = event.resultIndex; i < event.results.length; i++) {
    const t = event.results[i][0].transcript;
    if (event.results[i].isFinal) {
      final += t + ' ';
    } else {
      interim += t;
    }
  }

  const display = (final || interim).trim();
  micTranscript.textContent = display;

  if (!final) return;

  const text = final.trim().toLowerCase();

  if (micState === 'listening') {
    const afterWake = extractAfterWakeWord(text);
    if (afterWake !== null) {
      const question = afterWake.trim();
      if (question.length > 3) {
        askClaude(question);
      } else {
        collectQuestion = true;
        micState = 'question';
        setMicStatus('Jautā...', 'info');
        micTranscript.textContent = '';
      }
    }
  } else if (micState === 'question') {
    const question = final.trim();
    if (question.length > 3) {
      collectQuestion = false;
      askClaude(question);
    }
  }
}

function extractAfterWakeWord(text) {
  for (const w of WAKE_WORDS) {
    const idx = text.indexOf(w);
    if (idx !== -1) return text.slice(idx + w.length).replace(/^[,\s]+/, '');
  }
  return null;
}

async function askClaude(question) {
  micState = 'processing';
  setMicStatus('Domā...', 'info');
  micTranscript.textContent = question;

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: question, currentText: currentTextContext }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Servera kļūda');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    micAudio.src = url;
    micState = 'speaking';
    setMicStatus('Alise runā...', 'success');
    micAudio.play();

    micAudio.onended = () => {
      micState = 'listening';
      setMicStatus('Klausos... (saki "Alise")', 'info');
      micTranscript.textContent = '';
    };
  } catch (err) {
    setMicStatus(`Kļūda: ${err.message}`, 'error');
    micState = 'listening';
  }
}

function setMicStatus(msg, type) {
  micStatus.textContent = msg;
  micStatus.className = `status ${type}`;
}
