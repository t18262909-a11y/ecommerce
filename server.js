// server.js
// Express API that receives session events from the tracker,
// asks OpenAI whether to show a popup, and returns the decision.

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const OpenAI = require('openai');

const { buildMessages } = require('./promptBuilder');

const {
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
  PORT = 3000,
  ALLOWED_ORIGIN = '*',
  MIN_SESSION_SECONDS = '25',
  SESSION_COOLDOWN_MS = '120000',
} = process.env;

if (!OPENAI_API_KEY) {
  console.error('[fatal] OPENAI_API_KEY is not set. Copy .env.example -> .env and fill it in.');
  process.exit(1);
}

// const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const openai = new OpenAI({
  baseURL: 'https://jo3m4y06rnnwhaz.askbhunte.com/v1',
  apiKey: 'ollama', // API key is required but not used by Ollama
});

const app = express();

// ---- Middleware ----
app.use(express.json({ limit: '100kb' }));

const allowedOrigins = ALLOWED_ORIGIN.split(',').map((o) => o.trim());
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow no-origin (e.g. sendBeacon, curl) and matches
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error(`CORS blocked: ${origin}`));
    },
  })
);

// Rate limit: 60 requests/minute per IP. Tracker sends ~2/min, so plenty of headroom.
app.use(
  '/api/',
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---- In-memory cooldown store ----
// Simple Map<sessionId, lastShownTimestamp>. For production, swap for Redis.
const cooldowns = new Map();

function isInCooldown(sessionId) {
  const last = cooldowns.get(sessionId);
  if (!last) return false;
  return Date.now() - last < Number(SESSION_COOLDOWN_MS);
}

// Periodic cleanup so the Map doesn't grow forever
setInterval(() => {
  const cutoff = Date.now() - Number(SESSION_COOLDOWN_MS) * 2;
  for (const [id, ts] of cooldowns.entries()) {
    if (ts < cutoff) cooldowns.delete(id);
  }
}, 60 * 1000).unref();

// ---- Routes ----

app.get('/health', (_req, res) => {
  res.json({ ok: true, model: OPENAI_MODEL });
});

app.post('/api/session', async (req, res) => {
  try {
    const session = req.body || {};

    // Basic validation
    if (!session.sessionId || typeof session.sessionId !== 'string') {
      return res.status(400).json({ show: false, error: 'Missing sessionId' });
    }

    // Short-circuit: don't waste tokens on very short sessions
    const timeOnSite = Number(session.time_on_site ?? 0);
    if (timeOnSite < Number(MIN_SESSION_SECONDS)) {
      return res.json({ show: false, reason: 'session_too_short' });
    }

    // Short-circuit: don't show on checkout
    if (session.current_page === 'checkout') {
      return res.json({ show: false, reason: 'on_checkout' });
    }

    // Short-circuit: already shown recently for this session
    if (isInCooldown(session.sessionId)) {
      return res.json({ show: false, reason: 'cooldown' });
    }

    // Ask the LLM
    const messages = buildMessages(session);

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.6,
      max_tokens: 120,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn('[warn] LLM returned non-JSON:', raw);
      return res.json({ show: false, reason: 'parse_error' });
    }

    // Normalize response
    if (parsed.show === true && typeof parsed.message === 'string' && parsed.message.trim()) {
      cooldowns.set(session.sessionId, Date.now());
      return res.json({ show: true, message: parsed.message.trim() });
    }

    return res.json({ show: false });
  } catch (err) {
    console.error('[error] /api/session:', err.message);
    // Fail closed — never show a popup on server error
    return res.status(500).json({ show: false, error: 'server_error' });
  }
});

app.listen(PORT, () => {
  console.log(`[ok] Engagement API listening on :${PORT} (model: ${OPENAI_MODEL})`);
});
