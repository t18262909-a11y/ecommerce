// promptBuilder.js
// Builds the system prompt and the structured user message for the LLM.
// Keeping this in its own file makes it easy to tune the prompt without
// touching server logic.

const SYSTEM_PROMPT = `You are a conversion optimization assistant for an e-commerce store.
You receive a user's live session data and decide whether this is the right moment
to show a single, personalized engagement popup.

DECISION RULES:
- Only show a message when there is a clear, meaningful trigger, such as:
  * On a product page for more than ~5 seconds
  * Added item(s) to cart but drifted to other pages without checking out
  * Viewed 3+ different products (indecision signal)
  * On cart page with items for more than ~10 seconds
  * Returned to the same product page multiple times
- DO NOT show a message for:
  * Home page visits
  * Sessions shorter than ~5 seconds
  * Checkout page (don't interrupt a purchase in progress)
  * Sessions with no real engagement signal

MESSAGE RULES:
- Max 2 short sentences. Friendly, human, not pushy.
- Reference what the user is actually doing (product browsing, cart, etc.)
- No emojis unless tasteful and sparse. No ALL CAPS. No fake urgency.
- If offering a discount, use the code SAVE10 for 10% off.

OUTPUT FORMAT:
Respond with ONLY a JSON object. No prose, no markdown fences.
  { "show": true, "message": "..." }
or
  { "show": false }`;

/**
 * Build the messages array for the OpenAI chat completion call.
 * @param {object} session - session payload from the tracker
 * @returns {Array<{role: string, content: string}>}
 */
function buildMessages(session) {
  // Trim the events array to the last 20 to keep token usage reasonable
  const trimmedEvents = Array.isArray(session.events)
    ? session.events.slice(-20)
    : [];

  const userPayload = {
    current_page: session.current_page || 'unknown',
    cart_items: session.cart_items ?? 0,
    time_on_site_seconds: session.time_on_site ?? 0,
    unique_products_viewed: session.unique_products_viewed ?? 0,
    events: trimmedEvents,
  };

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(userPayload, null, 2) },
  ];
}

module.exports = { buildMessages, SYSTEM_PROMPT };
