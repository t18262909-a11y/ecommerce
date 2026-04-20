// promptBuilder.js
// LLM is only responsible for GENERATING the message.
// The show/no-show decision is made by rule-based scoring in server.js.

const SYSTEM_PROMPT = `You are a conversion copywriter for a Shopify e-commerce store.

You will receive a JSON object with the user's session context and a computed intent score (0–100).

Your ONLY job: write ONE short, personalized popup message (1–2 sentences, max 120 characters).

TONE: Helpful nudge. Never pushy or spammy.

CONTEXT-SPECIFIC GUIDELINES:
- product page: highlight scarcity, social proof, or value ("Only a few left!", "Free shipping on orders over $50")
- cart page with items: reinforce the decision ("Great picks — checkout before they sell out")
- category/browsing: offer discovery hook ("Still exploring? Here's 10% off your first order")
- high time on site (>2 min): address hesitation ("Still deciding? We offer free 30-day returns")
- add_to_cart event seen: closing nudge ("Your cart is waiting — complete your order today")
- wishlist event seen: convert from wish to buy ("Your saved item is still available — grab it now")

RULES:
- Do NOT mention discounts unless cart_items = 0 and time_on_site > 120
- Do NOT use exclamation marks more than once
- Keep it under 120 characters

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
