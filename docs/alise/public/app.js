console.log("[Alise] app.js loaded");

// ── Language detection ─────────────────────────────────────────────────────────
//  Detects: Armenian (hy), Greek (el), Hebrew (he), Latvian (lv, fallback)
function detectLanguage(text) {
  if (!text || !text.trim()) return "lv";
  // Armenian Unicode block: U+0530–U+058F
  if (/[\u0530-\u058F]/.test(text)) return "hy";
  // Greek Unicode block: U+0370–U+03FF, U+1F00–U+1FFF
  if (/[\u0370-\u03FF\u1F00-\u1FFF]/.test(text)) return "el";
  // Hebrew Unicode block: U+0590–U+05FF
  if (/[\u0590-\u05FF]/.test(text)) return "he";
  return "lv";
}

// ── Tab switching ──────────────────────────────────────────────────────────────
const tabBtns = document.querySelectorAll(".tab-btn");
const modeA   = document.getElementById("modeA");
const modeB   = document.getElementById("modeB");

tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    if (btn.dataset.mode === "a") {
      modeA.classList.remove("hidden");
      modeB.classList.add("hidden");
    } else {
      modeA.classList.add("hidden");
      modeB.classList.remove("hidden");
    }
  });
});

// ── MODE A — File reading via ElevenLabs TTS ───────────────────────────────────
const fileInput   = document.getElementById("fileInput");
const fileNameEl  = document.getElementById("fileName");
const readBtn     = document.getElementById("readBtn");
const statusEl    = document.getElementById("status");
const audioPlayer = document.getElementById("audioPlayer");
const downloadBtn = document.getElementById("downloadBtn");

let currentFile = null;

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  currentFile = file;
  fileNameEl.textContent = file.name;
  document.getElementById("fileLabel").classList.add("has-file");
  readBtn.disabled = false;
  setStatus("File loaded. Press ▶ Read.", "success");
});

readBtn.addEventListener("click", async () => {
  if (!currentFile) {
    setStatus("No file selected.", "error");
    return;
  }
  readBtn.disabled = true;
  readBtn.classList.add("loading");
  setStatus("Sending to ElevenLabs...", "info");
  try {
    // Peek at file text for language detection (TXT only; PDF handled server-side)
    let detectedLang = "lv";
    if (currentFile.type === "text/plain" || currentFile.name.endsWith(".txt")) {
      const sample = await currentFile.slice(0, 500).text();
      detectedLang = detectLanguage(sample);
    }
    const formData = new FormData();
    formData.append("file", currentFile);
    formData.append("lang", detectedLang);
    const res = await fetch("/api/read", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(res.status + " " + err);
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    audioPlayer.src = url;
    audioPlayer.classList.remove("hidden");
    audioPlayer.play();
    downloadBtn.href = url;
    downloadBtn.classList.remove("hidden");
    setStatus("Reading in progress ✅", "success");
  } catch (e) {
    console.error("[Alise] /api/read error:", e);
    setStatus("Error: " + e.message, "error");
  } finally {
    readBtn.disabled = false;
    readBtn.classList.remove("loading");
  }
});

function setStatus(msg, type = "info") {
  statusEl.textContent = msg;
  statusEl.className   = "status " + type;
  statusEl.classList.remove("hidden");
}

// ── MODE B — Microphone agent (state machine) ──────────────────────────────────
//
//  States:  idle → listening → question → processing → speaking → listening
//
//  listening : waiting for wake word "Alise" / "Alice"
//  question  : wake word heard, now collecting the question
//  processing: question sent to /api/ask, waiting for response
//  speaking  : playing ElevenLabs audio; any detected speech pauses playback
//

const micBtn        = document.getElementById("micBtn");
const micStatusEl   = document.getElementById("micStatus");
const micTranscript = document.getElementById("micTranscript");

let recognition   = null;
let micActive     = false;
let restartTimer  = null;
let state         = "idle";
let questionBuf   = "";
let currentAudio  = null;

function setMicStatus(msg) {
  micStatusEl.textContent = msg;
  micStatusEl.classList.remove("hidden");
}

function setTranscript(msg) {
  micTranscript.textContent = msg;
  micTranscript.classList.remove("hidden");
}

micBtn.addEventListener("click", () => {
  if (micActive) stopMic();
  else startMic();
});

function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setMicStatus("Speech recognition not supported. Use Chrome.");
    return;
  }

  // Destroy any existing instance first
  if (recognition) {
    const old = recognition;
    recognition = null;
    old.onstart = null; old.onresult = null; old.onerror = null; old.onend = null;
    try { old.abort(); } catch(e) {}
  }

  micActive = true;
  state = "listening";
  micBtn.textContent = "⏹ Stop microphone";
  micBtn.classList.add("mic-on");
  setMicStatus('Listening... Say "Alise" to activate.');

  const rec = new SR();
  // Use Latvian as primary; Armenian (hy-AM) is detected via script after transcription.
  // Chrome picks the best match when lang is set to a BCP-47 tag; for multilingual
  // support we set Latvian as default and rely on script detection post-recognition.
  rec.lang = "lv-LV";
  rec.continuous = true;
  rec.interimResults = true;

  rec.onstart = () => {
    console.log("[Alise] Mic started, state:", state);
  };

  rec.onresult = onSpeechResult;

  rec.onerror = (e) => {
    console.warn("[Alise] Speech error:", e.error);
    if (e.error === "not-allowed") {
      setMicStatus("Microphone access denied. Allow it in Chrome settings.");
      micActive = false;
      recognition = null;
      micBtn.textContent = "⬤ Activate microphone";
      micBtn.classList.remove("mic-on");
    }
    // aborted/no-speech are harmless
  };

  rec.onend = () => {
    if (rec !== recognition) return; // stale instance, ignore
    if (!micActive) return;          // intentional stop
    console.log("[Alise] Session ended — stopped (press button to restart)");
    recognition = null;
    micActive = false;
    micBtn.textContent = "⬤ Activate microphone";
    micBtn.classList.remove("mic-on");
    setMicStatus('Microphone stopped. Press button to start again.');
  };

  recognition = rec;
  try {
    rec.start();
  } catch(e) {
    console.error("[Alise] start() failed:", e);
    recognition = null;
    micActive = false;
    micBtn.textContent = "⬤ Activate microphone";
    micBtn.classList.remove("mic-on");
    setMicStatus("Could not start: " + e.message);
  }
}

function stopMic() {
  micActive = false;
  state = "idle";
  const old = recognition;
  recognition = null;
  if (old) {
    old.onstart = null; old.onresult = null; old.onerror = null; old.onend = null;
    try { old.abort(); } catch(e) {}
  }
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  micBtn.textContent = "⬤ Activate microphone";
  micBtn.classList.remove("mic-on");
  setMicStatus("Microphone stopped.");
  console.log("[Alise] Mic stopped");
}

function onSpeechResult(event) {
  let interim = "";
  let final   = "";

  for (let i = event.resultIndex; i < event.results.length; i++) {
    const t = event.results[i][0].transcript;
    if (event.results[i].isFinal) final   += t + " ";
    else                           interim += t;
  }

  console.log(`[Alise] SpeechResult interim: ${interim.trim()} | final: ${final.trim()} | state: ${state}`);

  const displayText = (final + interim).trim();
  if (displayText) setTranscript(displayText);

  // If Alise is speaking, any detected speech pauses audio immediately
  if (state === "speaking" && displayText.length > 2) {
    if (currentAudio && !currentAudio.paused) {
      currentAudio.pause();
      setMicStatus("Paused — listening to you...");
      console.log("[Alise] Audio paused due to speech detected");
    }
  }

  // Only process final results for state transitions
  if (!final.trim()) return;

  const text  = final.trim();
  const lower = text.toLowerCase();

  console.log("[Alise] Final text:", text);

  if (state === "listening") {
    const wakeDetected = lower.includes("alise") ||
                         lower.includes("alice") ||
                         lower.includes("alis");

    if (wakeDetected) {
      const afterWake = lower
        .replace(/\balis[ea]?\b/gi, "")
        .replace(/[,!?.]+/g, " ")
        .trim();

      if (afterWake.length > 3) {
        // Question already in same breath as wake word
        questionBuf = afterWake;
        askClaude(questionBuf);
      } else {
        state = "question";
        questionBuf = "";
        setMicStatus("Alise heard her name ✅ — ask your question.");
        console.log("[Alise] State → question");
      }
    }

  } else if (state === "question") {
    questionBuf += text + " ";
    askClaude(questionBuf.trim());

  } else if (state === "speaking") {
    // User spoke — resume if paused
    if (currentAudio && currentAudio.paused) {
      currentAudio.play();
      setMicStatus("Resuming...");
    }
  }
}

async function askClaude(question) {
  if (state === "processing") return;

  state = "processing";
  const lang = detectLanguage(question);
  console.log("[Alise] askClaude:", question, "| lang:", lang);
  setMicStatus("Thinking...");
  setTranscript(question);

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: question, lang })
    });

    console.log("[Alise] /api/ask response:", res.status, res.headers.get("content-type"));

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${res.status} ${errText}`);
    }

    const blob     = await res.blob();
    const audioUrl = URL.createObjectURL(blob);

    playResponse(audioUrl);

  } catch (e) {
    console.error("[Alise] askClaude error:", e);
    setMicStatus("Error: " + e.message);
    state = "listening";
    questionBuf = "";
  }
}

function playResponse(audioUrl) {
  state = "speaking";
  setMicStatus("Alise is speaking...");
  console.log("[Alise] State → speaking");

  if (currentAudio) { currentAudio.pause(); currentAudio = null; }

  currentAudio = new Audio(audioUrl);
  currentAudio.play();

  currentAudio.onended = () => {
    console.log("[Alise] Audio ended → listening");
    state        = "listening";
    questionBuf  = "";
    currentAudio = null;
    setMicStatus('Listening... Say "Alise" to activate.');
  };

  currentAudio.onerror = (e) => {
    console.error("[Alise] Audio playback error:", e);
    state = "listening";
    questionBuf = "";
    setMicStatus("Audio error. Listening again...");
  };
}
