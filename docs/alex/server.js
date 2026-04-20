require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const path    = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KE || '';
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';

const SYSTEM_PROMPT = 'Tu esi semināra dalībnieks. Runā TIKAI kad tevi uzrunā vārdā - Alex. Ja runā cits dalībnieks vai aģents - klusē un nereaģē.';

// Izveido īslaicīgu sesijas tokenu priekš pārlūka WebRTC savienojuma
app.post('/api/session', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY nav konfigurēts .env failā' });
  }
  try {
    const { voice = 'alloy', instructions } = req.body;
    const body = { model: MODEL, voice };
    body.instructions = instructions ? `${SYSTEM_PROMPT}\n\n${instructions}` : SYSTEM_PROMPT;

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[Alex] OpenAI sesija:', r.status, err);
      return res.status(r.status).json({ error: err });
    }

    const data = await r.json();
    console.log('[Alex] Sesija izveidota, modelis:', MODEL, 'balss:', voice);
    res.json(data);
  } catch (err) {
    console.error('[Alex] /api/session kļūda:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.ALEX_PORT || 3001;
app.listen(PORT, () => {
  console.log(`Alex darbojas: http://localhost:${PORT}`);
});
