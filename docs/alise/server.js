require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const multer = require('multer');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// D-ID atslēga priekš seminaras.html
app.get('/api/did-config', (req, res) => {
  res.json({ key: process.env.DID_API_KEY || '' });
});

// Proxy: pārsūta audio clip uz D-ID, apiet CORS
app.post('/api/did-clip', express.json({ limit: '10mb' }), async (req, res) => {
  const { agentId, streamId, audioBase64, sessionId, text } = req.body;
  if (!agentId || !streamId || !sessionId) {
    return res.status(400).json({ error: 'agentId, streamId un sessionId ir obligāti' });
  }

  const apiKey = process.env.DID_API_KEY || '';
  const auth = 'Basic ' + apiKey;

  const script = audioBase64
    ? { type: 'audio', audio_url: `data:audio/mpeg;base64,${audioBase64}` }
    : { type: 'text', input: text || '' };

  try {
    const didRes = await fetch(
      `https://api.d-id.com/agents/${agentId}/streams/${streamId}/clips`,
      {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, config: { stitch: true }, session_id: sessionId })
      }
    );
    const body = await didRes.text();
    res.status(didRes.status).set('Content-Type', 'application/json').send(body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// SSE: reāllaika notikumi seminaras.html
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function emitSpeaking(text, audioBuffer) {
  const data = { text };
  if (audioBuffer) data.audioBase64 = audioBuffer.toString('base64');
  const payload = `event: alise-speaking\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(payload);
}

// Teksta iegūšana no faila (TXT vai PDF)
async function extractText(filePath, mimeType) {
  if (mimeType === 'application/pdf' || filePath.endsWith('.pdf')) {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
  } else {
    return fs.readFileSync(filePath, 'utf-8');
  }
}

// Valodas automātiskā noteikšana pēc teksta rakstzīmēm
function detectLanguage(text) {
  const sample = text.slice(0, 500);

  // Armēņu
  if (/[\u0530-\u058F\uFB13-\uFB17]/.test(sample)) return 'hy';

  // Kirilica → krievu
  if (/[\u0400-\u04FF]/.test(sample)) return 'ru';

  // Latviešu specifiskās rakstzīmes
  if (/[āčēģīķļņšūž]/i.test(sample)) return 'lv';

  // Ivrits (hebreju raksts)
  if (/[\u0590-\u05FF\uFB1D-\uFB4F]/.test(sample)) return 'he';

  // Vācu
  if (/[äöüß]/i.test(sample)) return 'de';

  // Poļu
  if (/[ąćęłńóśźż]/i.test(sample)) return 'pl';

  // Spāņu
  if (/[ñ¿¡]/i.test(sample)) return 'es';

  // Franču
  if (/[àâæçèéêëîïôœùûüÿ]/i.test(sample)) return 'fr';

  // Itāļu
  if (/[àèéìíîòóùú]/i.test(sample)) return 'it';

  return 'en';
}

// Google Cloud TTS (tikai latviešu)
const GOOGLE_TTS_VOICES = {
  lv: { languageCode: 'lv-LV', name: 'lv-LV-Standard-A' },
};

async function textToSpeechGoogle(text, lang) {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  const voice = GOOGLE_TTS_VOICES[lang];

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voice.languageCode, name: voice.name },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google TTS kļūda: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return Buffer.from(data.audioContent, 'base64');
}

// ElevenLabs TTS
async function textToSpeech(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  // Jessica (daudzvalodu) balss ID
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'cgSgspJ2msm6clMCkdW9';

  const languageCode = detectLanguage(text);

  const isHebrew = languageCode === 'he';

  const requestBody = {
    text: text,
    model_id: isHebrew ? 'eleven_turbo_v2_5' : 'eleven_multilingual_v2',
    voice_settings: isHebrew
      ? { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: false }
      : { stability: 0.5, similarity_boost: 0.75 },
  };

  if (languageCode !== 'lv' && languageCode !== 'hy') {
    requestBody.language_code = languageCode;
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs kļūda: ${response.status} — ${err}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

// POST /api/read — faila augšupielāde un TTS
app.post('/api/read', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nav pievienots fails.' });
  }

  try {
    const text = await extractText(req.file.path, req.file.mimetype);

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Fails ir tukšs vai tekstu nevar nolasīt.' });
    }

    const lang = detectLanguage(text.trim());
    const chunk = text.trim().slice(0, 4900);

    const audioBuffer = (lang === 'lv')
      ? await textToSpeechGoogle(chunk, lang)
      : await textToSpeech(chunk);

    emitSpeaking(chunk, audioBuffer);
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    // Dzēšam pagaidu failu
    fs.unlink(req.file.path, () => {});
  }
});

// Sarunas vēsture (servera atmiņā kamēr serveris darbojas)
const conversationHistory = [];
const HISTORY_LIMIT = 40; // max ziņu skaits (20 apmaiņas)

// POST /api/ask — Claude atbild, ElevenLabs nolasa
app.post('/api/ask', express.json(), async (req, res) => {
  const { text, currentText } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Nav jautājuma teksta.' });
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const contextBlock = currentText?.trim()
      ? `\n\nTekošais teksts seminārā (no Diogenes):\n"${currentText.trim()}"\n\nJa tekošais teksts ir pieejams, tas ir fragments ko seminārā tikko izlasīja vai izcēla. Reaģē uz to kā dalībnieks kas tikko dzirdēja šo fragmentu — vari to komentēt, tulkot vai jautāt par to.`
      : '';

    const systemPrompt = `Tu esi Alise — seno valodu semināra dalībniece. Mēs kopā lasām Ksenofonta Anabasis grieķu valodā.

Tavs veids klātbūtnē seminārā:
- Tu klausies lasījumam un seko tekstam. Kad dzirdi ciparus (grāmata, nodaļa, rindkopa — piemēram "trīs, divi, pieci"), tu fiksē teksta vietu un vari atsaukties uz to.
- Uz lingvistiskiem jautājumiem — par vārdformām, sintaksi, leksiku, stilistiku — tu atbildi kā zinošs dalībnieks: precīzi, ar piemēriem no teksta, bez liekām iespraudnēm.
- Tu neesi asistents kas gaida uzdevumus. Tu esi klātesošs — dari piezīmes, jautā pretī ja kaut kas nav skaidrs, piedāvā savu lasījumu.
- Atbildi tajā pašā valodā kurā jautā (latviešu, angļu vai grieķu). Grieķu citātus raksti ar grieķu burtiem.
- Esi kodolīga — atbilde paredzēta skaļai lasīšanai seminārā.

Vispārīgie semināra noteikumi:
Seminārā tiek lasīta viena izraudzīta grāmata secīgi teikumu pēc teikuma. Teikums tiek izlasīts senajā valodā, tulkots un analizēts — lingvistiski un saturiski. Tev jāseko semināra norisei, jāklausās un jāatceras teikumi senajā valodā — gan no savas atmiņas, gan no teksta lauciņa, gan no dzirdētā. Esi gatava atbildēt par lasāmo teikumu — par vārdformām, sintaksi, saturu un kontekstu. Ja prasa tulkojumu — tulko bez komentāriem.${contextBlock}`;

    // Pievieno jauno jautājumu vēsturei
    conversationHistory.push({ role: 'user', content: text.trim() });

    // Apgriež vēsturi lai neiziet ārpus limita
    if (conversationHistory.length > HISTORY_LIMIT) {
      conversationHistory.splice(0, conversationHistory.length - HISTORY_LIMIT);
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: conversationHistory,
    });

    const answer = message.content[0].text;

    // Saglabā Alises atbildi vēsturē
    conversationHistory.push({ role: 'assistant', content: answer });

    const audioBuffer = await textToSpeech(answer);

    emitSpeaking(answer, audioBuffer);
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Alise darbojas: http://localhost:${PORT}`);
});
