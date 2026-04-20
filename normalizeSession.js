function normalizeSession(session = {}) {
  return {
    current_page: session.current_page || 'unknown',
    cart_items: session.cart_items ?? 0,
    time_on_site: session.time_on_site ?? session.time_on_site_seconds ?? 0,
    unique_products_viewed: session.unique_products_viewed ?? 0,
    events: Array.isArray(session.events) ? session.events.slice(-20) : [],
  };
}

module.exports = { normalizeSession };
