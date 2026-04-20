// server.js
// Express API that receives session events from the tracker,
// asks OpenAI whether to show a popup, and returns the decision.

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const OpenAI = require('openai');

const { buildMessages } = require('./promptBuilder');
const { normalizeSession } = require('./normalizeSession');

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


// Support OpenAI or OpenRouter fallback
let openai;
if (OPENAI_API_KEY && OPENAI_API_KEY !== 'openrouter') {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
} else {
  // OpenRouter fallback
  openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || 'openrouter',
  });
}


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
    credentials: true, // Allow credentials for cross-origin requests
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
app.get('/snippet.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'snippet.js'));
});
app.post('/api/session', async (req, res) => {
  try {
    const session = req.body || {};

    if (!session.sessionId || typeof session.sessionId !== 'string') {
      return res.status(400).json({ show: false, error: 'Missing sessionId' });
    }

<<<<<<< HEAD
    const timeOnSite = Number(session.time_on_site ?? 0);

    if (timeOnSite < Number(MIN_SESSION_SECONDS)) {
      return res.json({ show: false, reason: 'session_too_short' });
    }

    if (session.current_page === 'checkout') {
      return res.json({ show: false, reason: 'on_checkout' });
    }

    if (isInCooldown(session.sessionId)) {
      return res.json({ show: false, reason: 'cooldown' });
    }

    const messages = buildMessages(session);
=======
    // Normalize session fields for LLM
    const normalized = normalizeSession(session);
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(normalized, null, 2) },
    ];
>>>>>>> f5b5f16 (changes)

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.6,
      max_tokens: 120,
    });

    const raw = completion.choices?.[0]?.message?.content || '';

    console.log('[LLM RAW OUTPUT]', raw);

    // -----------------------------
    // SAFE JSON PARSING (FIXED)
    // -----------------------------
    let parsed = null;

    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // fallback: extract JSON block
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (err2) {
          console.warn('[parse fail] extracted JSON invalid');
        }
      }
    }

    if (!parsed) {
      return res.json({
        show: false,
        reason: 'invalid_json_from_llm',
        debug: raw,
      });
    }

    // -----------------------------
    // NORMALIZATION
    // -----------------------------
    const shouldShow = parsed.show === true;
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';

    if (shouldShow && message) {
      cooldowns.set(session.sessionId, Date.now());

      return res.json({
        show: true,
        message,
      });
    }

    return res.json({
      show: false,
      reason: 'llm_rejected',
      debug: parsed,
    });

  } catch (err) {
    console.error('[error] /api/session:', err);
    return res.status(500).json({ show: false, error: 'server_error' });
  }
});
app.listen(PORT, () => {
  console.log(`[ok] Engagement API listening on :${PORT} (model: ${OPENAI_MODEL})`);
});
