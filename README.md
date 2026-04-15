# AI Connectors Hub

Personīgais uzziņu repozitorijs AI rīku, connectoru un MCP serveru pārvaldībai.

## Saturs

- [PROJECTS.md](./PROJECTS.md) — aktīvo projektu saraksts ar saitēm
- [.env](./.env) — API atslēgas (nav publiskas, lokāli glabājamas)
- `private/` — papildu privāta konfigurācija

---

## AI Rīki un vajadzīgās API atslēgas

Zemāk ir saraksts ar rīkiem, kurus izmantoju, un kur iegūt katras API atslēgu.

### 🤖 LLM Platformas

| Rīks | Kur iegūt API atslēgu | .env mainīgais |
|------|----------------------|----------------|
| **Claude** (Anthropic) | https://console.anthropic.com → API Keys | `ANTHROPIC_API_KEY` |
| **ChatGPT** (OpenAI) | https://platform.openai.com → API Keys | `OPENAI_API_KEY` |
| **Grok** (xAI) | https://console.x.ai → API Keys | `XAI_API_KEY` |

### 🔗 Automatizācija un Connectors

| Rīks | Kur iegūt | .env mainīgais |
|------|-----------|----------------|
| **Make.com** | https://make.com → Profile → API → Generate Token | `MAKE_API_KEY` |
| **Zapier** | https://zapier.com/app/developer → API Keys | `ZAPIER_API_KEY` |

### 📁 Google Workspace (Claude connectors)

Šie jau ir savienoti Claude.ai saskarnē (Gmail, Drive, Calendar) — tur API atslēgas nav vajadzīgas, autorizācija notiek ar Google kontu tieši Claude iestatījumos.

### 🎙️ Balss Aģenti

| Rīks | Kur iegūt | .env mainīgais |
|------|-----------|----------------|
| **ElevenLabs** | https://elevenlabs.io → Profile → API Key | `ELEVENLABS_API_KEY` |
| **Deepgram** (speech-to-text) | https://console.deepgram.com | `DEEPGRAM_API_KEY` |

---

## MCP Serveri (Claude Code / Cowork)

MCP serverus pievieno Claude Desktop vai Claude Code konfigurācijā (`claude_desktop_config.json`).

Noderīgi MCP serveri:
- **GitHub MCP** — repo pārvaldība
- **Google Drive MCP** — failu piekļuve
- **Gmail MCP** — e-pasta automatizācija

Pilns MCP saraksts: https://github.com/modelcontextprotocol/servers

---

## ⚠️ Drošība

- **Nekad** neliec reālas API atslēgas šajā failā vai jebkurā publiskā failā
- Visas atslēgas glabā lokālajā `.env` failā
- `.env` ir pievienots `.gitignore` — tas netiek augšupielādēts GitHub
