# Shopify AI Engagement Popup

Lightweight system that watches user behavior on a Shopify store and uses an LLM to decide *when* and *what* to show as a personalized engagement popup.

## Architecture

```
[ Shopify theme ]  →  tracker.js  →  POST /api/session  →  [ Express ]  →  OpenAI
                                                                ↓
                                   { show: true/false, message }
                                                                ↓
                                                          popup renders
```

Three pieces:

1. **`tracker.js`** — runs in the browser, collects events, batches and sends to backend, renders popup.
2. **`server.js`** — Express API, one endpoint `POST /api/session`, calls OpenAI, returns decision.
3. **Popup** — injected by the tracker itself (no separate file needed in production).

## Setup

### 1. Backend

```bash
cp .env.example .env
# edit .env and set OPENAI_API_KEY
npm install
npm start
```

Server runs on `http://localhost:3000`. Health check: `GET /health`.

### 2. Build the snippet

```bash
node build.js
```

This writes `snippet.js`. Upload it anywhere publicly accessible (your backend host, a CDN, GitHub Pages, etc.) and note the URL.

### 3. Inject into Shopify

In your Shopify admin: **Online Store → Themes → Edit code → `theme.liquid`**.

Paste just before `</body>`:

```html
<script>
  window.ENGAGEMENT_API = "https://your-backend-url.com";
</script>
<script src="https://your-cdn-or-host/snippet.js" defer></script>
```

Save. The tracker is now live on every page.

## How the LLM prompting works

Session data is scored with a rule-based intent engine in `server.js` first — if the score is too low the LLM is never called (saves tokens). When the score crosses the threshold, `promptBuilder.js` builds a two-message conversation:

- **System prompt**: instructs the model to act as a conversion copywriter, maps each behavioral signal to an engagement angle (cart items → reinforce decision, idle → re-engage, multi-product browsing → highlight variety, etc.), and enforces hard output rules (max 120 chars, valid JSON only, no fake discounts for users already in cart).
- **User message**: a JSON snapshot of the session — `intent_score`, `current_page`, `cart_items`, `time_on_site_seconds`, `unique_products_viewed`, `scroll_depth_pct`, `last_added_product`, `cart_products`, and the last 20 events.

The model returns `{"message": "..."}`. The backend wraps this into `{show: true, message}` and sends it to the tracker, which renders the popup.

Server-side short-circuits (before any LLM call):

- Session under `MIN_SESSION_SECONDS` → `show: false`
- Current page is `checkout` → `show: false`
- Session already shown a popup within `SESSION_COOLDOWN_MS` → `show: false`

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | Your OpenAI key |
| `OPENAI_MODEL` | `gpt-4o-mini` | Cheap + fast; good for this task |
| `PORT` | `3000` | Server port |
| `ALLOWED_ORIGIN` | `*` | Comma-separated list of origins (set to your Shopify URL in prod) |
| `MIN_SESSION_SECONDS` | `25` | Skip LLM call for sessions shorter than this |
| `SESSION_COOLDOWN_MS` | `120000` | Don't show another popup for this session within this window |
| `INTENT_THRESHOLD` | `5` | Minimum intent score (0–100) to trigger LLM call |

## Deployment notes

- **Backend**: Railway, Render, Fly.io, or any Node host. Set the env vars listed above.
- **Snippet**: Serve `snippet.js` as a static file from your backend — add `app.use('/snippet.js', express.static('snippet.js'))` in `server.js`, then reference `https://your-backend-url.com/snippet.js` in Shopify.
- **CORS**: Change `ALLOWED_ORIGIN` from `*` to your actual store URL(s) once you go live.

## Debugging

Open DevTools console on your Shopify store:

```js
window.__engagement.getPayload()        // inspect what would be sent
window.__engagement.forceSend()         // trigger a send now
window.__engagement.showPopup("test")   // preview the popup UI
```

## Testing locally without Shopify

Open `test.html` in a browser (point `ENGAGEMENT_API` at `http://localhost:3000`), interact with the page, then call `window.__engagement.forceSend()` in the console to see the full cycle.

## File layout

```
shopify-engagement-backend/
├── tracker.js         ← injectable snippet source (edit this)
├── snippet.js         ← built output — upload this to CDN / backend
├── popup.css          ← reference stylesheet (styles are inlined in tracker.js)
├── server.js          ← Express API + intent scoring
├── promptBuilder.js   ← builds the LLM messages
├── normalizeSession.js← cleans raw tracker payload before scoring
├── build.js           ← copies tracker.js → snippet.js
├── test.html          ← local smoke-test page
├── package.json
├── .env.example
└── README.md
```
