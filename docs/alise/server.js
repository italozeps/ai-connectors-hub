require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const multer = require('multer');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

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

// ElevenLabs TTS
async function textToSpeech(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  // Jessica (daudzvalodu) balss ID
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'cgSgspJ2msm6clMCkdW9';

  const languageCode = detectLanguage(text);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        language_code: languageCode,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
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

    // ElevenLabs limits: max ~5000 rakstzīmes vienā pieprasījumā
    const chunk = text.trim().slice(0, 4900);

    const audioBuffer = await textToSpeech(chunk);

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Alise darbojas: http://localhost:${PORT}`);
});
