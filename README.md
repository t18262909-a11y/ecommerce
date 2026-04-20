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

1. **`tracker/tracker.js`** — runs in the browser, collects events, batches and sends to backend, renders popup.
2. **`backend/server.js`** — Express API, one endpoint `POST /api/session`, calls OpenAI, returns decision.
3. **Popup** — injected by the tracker itself (no separate file needed in production).

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env
# edit .env and set OPENAI_API_KEY
npm install
npm start
```

Server runs on `http://localhost:3000`. Health check: `GET /health`.

### 2. Build the snippet

From the project root:

```bash
node build.js
```

This writes `snippet.js` at the root. Upload it anywhere publicly accessible (your backend host, a CDN, GitHub Pages, etc.) and note the URL.

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

## How the LLM decides

All the "smarts" live in `backend/promptBuilder.js`. The system prompt instructs the model to **only** show a popup on meaningful triggers — long dwell on product pages, cart abandonment, indecision (3+ products viewed), etc. — and to skip home page, short sessions, and checkout.

There are also hard server-side short-circuits in `server.js` that save tokens before even calling OpenAI:

- Sessions under `MIN_SESSION_SECONDS` → auto no.
- Current page is `checkout` → auto no.
- Session is in cooldown (already shown popup in last `SESSION_COOLDOWN_MS`) → auto no.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | Your OpenAI key |
| `OPENAI_MODEL` | `gpt-4o-mini` | Cheap + fast; good for this task |
| `PORT` | `3000` | Server port |
| `ALLOWED_ORIGIN` | `*` | Comma-separated list of origins (set to your Shopify URL in prod) |
| `MIN_SESSION_SECONDS` | `25` | Skip LLM call for sessions shorter than this |
| `SESSION_COOLDOWN_MS` | `120000` | Don't show another popup for this session within this window |

## Deployment notes

- **Backend**: Railway, Render, Fly.io, or any Node host. Just set env vars.
- **Snippet**: Can be served by your own backend as a static file if you want, e.g. add `app.use('/snippet.js', express.static('../snippet.js'))` in `server.js`.
- **CORS**: Change `ALLOWED_ORIGIN` from `*` to your actual store URL(s) once you go live.

## Debugging

Open DevTools console on your Shopify store and use:

```js
window.__engagement.getPayload()   // inspect what would be sent
window.__engagement.forceSend()    // trigger a send now
window.__engagement.showPopup("test message")  // preview the popup
```

## Testing locally without Shopify

Serve `snippet.js` locally and load any HTML page that defines `window.ENGAGEMENT_API` and includes the script. Fire events manually in the console and call `window.__engagement.forceSend()` to see the decision.

## File layout

```
shopify-engagement/
├── tracker/
│   ├── tracker.js       ← the injectable snippet source
│   └── popup.css        ← reference stylesheet (already inlined in tracker.js)
├── backend/
│   ├── server.js        ← Express API
│   ├── promptBuilder.js ← builds the LLM prompt
│   ├── package.json
│   └── .env.example
├── build.js             ← copies tracker.js → snippet.js
├── snippet.js           ← built output (git-ignored, gets uploaded)
└── README.md
```




curl -X POST https://ecommerce-production-2e53.up.railway.app/api/session \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId":"abc456",
    "current_page":"product",
    "cart_items":1,
    "time_on_site":210,
    "unique_products_viewed":4,
    "events":[
      {"type":"page_view","page":"product","url":"/products/a"},
      {"type":"page_view","page":"product","url":"/products/b"},
      {"type":"click","element":"add_to_cart"},
      {"type":"page_view","page":"product","url":"/products/c"},
      {"type":"page_view","page":"product","url":"/products/d"}
    ]
  }'