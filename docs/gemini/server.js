require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const SYSTEM_PROMPT = 'Tu esi semināra dalībnieks. Runā TIKAI kad tevi uzrunā vārdā - Toms vai Džeminai. Ja runā cits dalībnieks vai aģents - klusē un nereaģē.';

// ── Konfigurācija — mainīt šeit ────────────────────────────────────
// Kombinācija 1: const API_VERSION = 'v1alpha'; const MODEL = 'models/gemini-2.0-flash-exp';
// Kombinācija 2: const API_VERSION = 'v1alpha'; const MODEL = 'models/gemini-2.0-flash-live-001';
// Kombinācija 3: const API_VERSION = 'v1beta';  const MODEL = 'models/gemini-2.0-flash-live-001';
const API_VERSION = 'v1alpha';
const MODEL       = 'models/gemini-2.5-flash-native-audio-latest';
// ──────────────────────────────────────────────────────────────────

const GEMINI_WS_URL =
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${API_VERSION}.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

console.log(`[Gemini] Konfigurācija: ${API_VERSION} | ${MODEL}`);

wss.on('connection', (clientWs, req) => {
  // Iegūst voice un instructions no URL parametriem
  const params       = new URL(req.url, 'http://localhost').searchParams;
  const voice        = params.get('voice') || 'Puck';
  const instructions = params.get('instructions') || '';
  console.log('[Gemini] Klients savienojies | voice:', voice);

  if (!GEMINI_API_KEY) {
    clientWs.send(JSON.stringify({ error: 'GEMINI_API_KEY nav konfigurēts .env failā' }));
    clientWs.close();
    return;
  }

  // Savienojas ar Google Gemini Live API
  console.log('[Gemini] Savienojas uz:', GEMINI_WS_URL.replace(/key=[^&]+/, 'key=***'));
  const geminiWs = new WebSocket(GEMINI_WS_URL);
  let geminiReady = false;
  const buffer = [];
  const messageLog = [];

  geminiWs.on('open', () => {
    console.log('[Gemini] Savienots ar Google Gemini Live API — sūta setup');

    const setup = {
      setup: {
        model: MODEL,
        systemInstruction: {
          parts: [{ text: instructions ? `${SYSTEM_PROMPT}\n\n${instructions}` : SYSTEM_PROMPT }]
        },
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice }
            }
          }
        }
      }
    };

    console.log('[Gemini] Setup:', JSON.stringify(setup));
    geminiWs.send(JSON.stringify(setup));

    geminiReady = true;
    buffer.forEach(msg => geminiWs.send(msg));
    buffer.length = 0;
  });

  // Google → klients (ar logging)
  geminiWs.on('message', (data) => {
    try {
      const text = data.toString();
      const parsed = JSON.parse(text);
      messageLog.push(parsed);
      if (messageLog.length > 20) messageLog.shift();

      // Izdrukā katru ziņojumu (bez audio datiem lai nepiepildītu konsoli)
      const logSafe = JSON.parse(text);
      if (logSafe?.serverContent?.modelTurn?.parts) {
        logSafe.serverContent.modelTurn.parts = logSafe.serverContent.modelTurn.parts.map(p =>
          p.inlineData ? { ...p, inlineData: { mimeType: p.inlineData.mimeType, data: `[${p.inlineData.data?.length || 0} chars]` } } : p
        );
      }
      console.log('[Gemini] ← Google:', JSON.stringify(logSafe));
    } catch {
      console.log('[Gemini] ← Google (binary):', data.length, 'bytes');
    }
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data.toString());
  });

  geminiWs.on('error', (err) => {
    console.error('[Gemini] Google WS kļūda:', err.message);
    console.error('[Gemini] Kļūdas detaļas:', err);
    if (clientWs.readyState === WebSocket.OPEN)
      clientWs.send(JSON.stringify({ error: err.message }));
  });

  geminiWs.on('close', (code, reason) => {
    const reasonStr = reason.toString();
    console.log('[Gemini] Google WS aizvērts — kods:', code, '| iemesls:', reasonStr || '(nav)');
    if (messageLog.length) {
      console.log('[Gemini] Pēdējie', messageLog.length, 'saņemtie ziņojumi pirms aizvēršanas:');
      messageLog.forEach((m, i) => console.log(`  [${i + 1}]`, JSON.stringify(m)));
    } else {
      console.log('[Gemini] Nav saņemts neviens ziņojums pirms aizvēršanas');
    }
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  // Klients → Google
  clientWs.on('message', (data) => {
    if (geminiReady && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(data);
    } else {
      buffer.push(data);
    }
  });

  clientWs.on('close', () => {
    console.log('[Gemini] Klients atvienojies');
    if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
  });

  clientWs.on('error', (err) => console.error('[Gemini] Klienta WS kļūda:', err.message));
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Gemini darbojas: http://localhost:${PORT}`);
});

// Izdrukā pieejamos Gemini modeļus
fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`)
  .then(r => r.json())
  .then(data => {
    if (data.error) {
      console.error('[Gemini] Modeļu saraksts — kļūda:', data.error.message);
      return;
    }
    console.log('[Gemini] Pieejamie modeļi:');
    (data.models || []).forEach(m => console.log(' ', m.name));
  })
  .catch(err => console.error('[Gemini] Modeļu saraksts — fetch kļūda:', err.message));
