// promptBuilder.js
// Builds the system prompt and the structured user message for the LLM.
// Keeping this in its own file makes it easy to tune the prompt without
// touching server logic.

const SYSTEM_PROMPT = `You are an e-commerce conversion intelligence system.

<<<<<<< HEAD
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
=======
Your job is NOT to be overly cautious.
Your job is to estimate PURCHASE INTENT from session behavior.
>>>>>>> f5b5f16 (changes)

You must evaluate intent on a scale internally and decide output accordingly.

DECISION MODEL:
- Low intent (0–40): show = false
- Medium intent (41–70): show = false, but close to threshold
- High intent (71–100): show = true

STRONG INTENT SIGNALS:
- Repeated product views
- Cart activity (adding or modifying items)
- Time spent on product pages (>15–30 seconds)
- Multiple product comparisons (3+ products viewed)
- Returning to same product page
- Cart abandonment behavior

WEAK SIGNALS (do not ignore them completely):
- short sessions
- browsing homepage
- single product view

IMPORTANT RULES:
- DO NOT default to false. You must reason about intent strength.
- If uncertain, lean slightly toward MEDIUM intent, not zero.
- Think like a conversion optimizer, not a risk manager.

OUTPUT FORMAT:
Return ONLY JSON:

If show = true:
{ "show": true, "message": "..." }

If show = false:
{ "show": false, "message": "" }`;

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
