// server.js
require('dotenv').config();
const path = require('path');
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
  MIN_SESSION_SECONDS = '5',
  SESSION_COOLDOWN_MS = '120000',
  INTENT_THRESHOLD = '5',
} = process.env;

if (!OPENAI_API_KEY) {
  console.error('[fatal] OPENAI_API_KEY is not set. Copy .env.example -> .env and fill it in.');
  process.exit(1);
}

const openai = new OpenAI(
  process.env.OPENROUTER_API_KEY
    ? { baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }
    : { apiKey: OPENAI_API_KEY }
);

// ---- Intent scoring (rule-based, no LLM) ----
// Returns 0–100. If score >= INTENT_THRESHOLD we show a popup.
function scoreIntent(session) {
  let score = 0;
  const events = Array.isArray(session.events) ? session.events : [];

  // Time on site
  const t = Number(session.time_on_site ?? 0);
  if (t >= 180) score += 20;
  else if (t >= 90)  score += 12;
  else if (t >= 40)  score += 6;

  // Current page type
  const page = (session.current_page || '').toLowerCase();
  if (page === 'cart')     score += 30;
  else if (page === 'product')  score += 20;
  else if (page === 'category') score += 10;

  // Cart items
  const cart = Number(session.cart_items ?? 0);
  if (cart >= 2) score += 25;
  else if (cart === 1) score += 15;

  // Unique products viewed
  const prods = Number(session.unique_products_viewed ?? 0);
  if (prods >= 3) score += 20;
  else if (prods >= 2) score += 12;
  else if (prods >= 1) score += 5;

  // Scroll depth on current page
  const scroll = Number(session.scroll_depth ?? 0);
  if (scroll >= 70) score += 10;
  else if (scroll >= 40) score += 5;

  // Time on current page
  const pt = Number(session.page_time ?? 0);
  if (pt >= 60) score += 15;
  else if (pt >= 30) score += 8;

  // Strong click events
  const hasAddToCart   = events.some(e => e.element === 'add_to_cart');
  const hasWishlist    = events.some(e => e.element === 'wishlist');
  const hasFilter      = events.some(e => e.element === 'filter');
  const hasCheckout    = events.some(e => e.element === 'checkout_click');
  if (hasAddToCart)  score += 30;
  if (hasWishlist)   score += 15;
  if (hasCheckout)   score += 20;
  if (hasFilter)     score += 8;

  // Multiple page views in session
  const pvCount = events.filter(e => e.type === 'page_view').length;
  if (pvCount >= 4) score += 10;
  else if (pvCount >= 2) score += 5;

  // Idle — user paused, good moment to engage
  const hasIdle = events.some(e => e.type === 'idle');
  if (hasIdle) score += 20;

  // Cart already had items when page loaded (e.g. after reload)
  const cartLoaded = events.find(e => e.type === 'cart_loaded');
  if (cartLoaded) score += 35;

  return Math.min(score, 100);
}


// ---- Express app ----
const app = express();
app.use(express.json({ limit: '100kb' }));

const allowedOrigins = ALLOWED_ORIGIN.split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ---- Cooldown store ----
const cooldowns = new Map();

function isInCooldown(sessionId) {
  const last = cooldowns.get(sessionId);
  return last ? Date.now() - last < Number(SESSION_COOLDOWN_MS) : false;
}

setInterval(() => {
  const cutoff = Date.now() - Number(SESSION_COOLDOWN_MS) * 2;
  for (const [id, ts] of cooldowns.entries()) {
    if (ts < cutoff) cooldowns.delete(id);
  }
}, 60_000).unref();

// ---- Routes ----
app.get('/health', (_req, res) => {
  res.json({ ok: true, model: OPENAI_MODEL, threshold: Number(INTENT_THRESHOLD) });
});

app.get('/snippet.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'tracker.js'));
});

app.post('/api/session', async (req, res) => {
  try {
    const session = req.body || {};

    if (!session.sessionId || typeof session.sessionId !== 'string') {
      return res.status(400).json({ show: false, error: 'Missing sessionId' });
    }

    const timeOnSite = Number(session.time_on_site ?? 0);
    if (timeOnSite < Number(MIN_SESSION_SECONDS)) {
      return res.json({ show: false, reason: 'session_too_short' });
    }

    const page = (session.current_page || '').toLowerCase();
    if (page === 'checkout') {
      return res.json({ show: false, reason: 'on_checkout' });
    }

    const hasCartOnLoad = Array.isArray(session.events) && session.events.some(e => e.type === 'cart_loaded');
    if (!hasCartOnLoad && isInCooldown(session.sessionId)) {
      return res.json({ show: false, reason: 'cooldown' });
    }

    // Rule-based decision — LLM only generates the message
    const intentScore = scoreIntent(session);
    console.log(`[intent] sessionId=${session.sessionId} page=${page} score=${intentScore}`);

    if (intentScore < Number(INTENT_THRESHOLD)) {
      return res.json({ show: false, reason: 'low_intent', score: intentScore });
    }

    // Ask LLM to generate a contextual message
    let message = '';
    try {
      const messages = buildMessages(session, intentScore);
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 80,
      });

      const raw = (completion.choices?.[0]?.message?.content || '').trim();
      console.log('[LLM RAW]', raw);

      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch { /* fall through */ }
        }
      }

      if (parsed && typeof parsed.message === 'string' && parsed.message.trim()) {
        message = parsed.message.trim();
      }
    } catch (llmErr) {
      console.warn('[LLM error] skipping popup:', llmErr.message);
      return res.json({ show: false, reason: 'llm_error' });
    }

    if (!message) {
      return res.json({ show: false, reason: 'empty_message' });
    }

    cooldowns.set(session.sessionId, Date.now());
    return res.json({ show: true, message, score: intentScore });

  } catch (err) {
    console.error('[error] /api/session:', err);
    return res.status(500).json({ show: false, error: 'server_error' });
  }
});

app.listen(PORT, () => {
  console.log(`[ok] Engagement API listening on :${PORT} (model: ${OPENAI_MODEL}, threshold: ${INTENT_THRESHOLD})`);
});
