// promptBuilder.js
// LLM is only responsible for GENERATING the message.
// The show/no-show decision is made by rule-based scoring in server.js.

const SYSTEM_PROMPT = `You are a world-class conversion copywriter for a Shopify store.

You will receive the user's full session context: page, time spent, scroll depth, cart state, and a list of events (clicks, page views, idle moments).

Your job: write ONE short, highly personalized popup message (1–2 sentences, max 120 characters) that feels like it was written just for this visitor at this exact moment.

TONE: Warm, human, helpful. Never robotic, pushy, or aggressive.

USE THE SESSION DATA to decide the angle:
- idle event → user paused; re-engage gently ("Still here? Your picks are waiting.")
- add_to_cart → closing nudge, create mild urgency
- wishlist → nudge from saving to buying
- long time on site + no cart → address hesitation, mention returns/trust
- browsing multiple products → highlight variety or a deal
- cart page → reinforce the decision, reduce anxiety
- home page → welcome, spark curiosity
- category page → discovery hook, social proof
- first 30s on site → be welcoming, not pushy

RULES:
- Every message must feel unique to the session — never generic
- Do NOT mention discounts unless cart_items = 0 and time_on_site > 120
- Max one exclamation mark
- Under 120 characters

OUTPUT FORMAT — return ONLY valid JSON, nothing else:
{"message": "your message here"}`;

/**
 * @param {object} session - normalized session from the tracker
 * @param {number} intentScore - 0-100 rule-based score computed by server
 */
function buildMessages(session, intentScore) {
  const trimmedEvents = Array.isArray(session.events) ? session.events.slice(-20) : [];

  const userPayload = {
    intent_score: intentScore,
    current_page: session.current_page || 'unknown',
    cart_items: session.cart_items ?? 0,
    time_on_site_seconds: session.time_on_site ?? 0,
    unique_products_viewed: session.unique_products_viewed ?? 0,
    scroll_depth_pct: session.scroll_depth ?? 0,
    page_time_seconds: session.page_time ?? 0,
    events: trimmedEvents,
  };

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(userPayload, null, 2) },
  ];
}

module.exports = { buildMessages, SYSTEM_PROMPT };
