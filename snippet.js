/* Shopify Engagement Snippet — built 2026-04-20T12:13:00.654Z */
/* tracker.js — Shopify engagement tracker
 *
 * Usage (in theme.liquid, before </body>):
 *   <script>window.ENGAGEMENT_API = "https://your-backend.com";</script>
 *   <script src="https://your-cdn/snippet.js" defer></script>
 *
 * Collects page views, meaningful clicks, and time on site.
 * Sends a summary to the backend every 30s (and on page unload).
 * Renders a single popup if the backend decides to show one.
 */
(function () {
  'use strict';

  // ---- Config ----
  var API_BASE = (window.ENGAGEMENT_API || '').replace(/\/$/, '');
  if (!API_BASE) {
    console.warn('[engagement] window.ENGAGEMENT_API is not set. Tracker disabled.');
    return;
  }

  var SEND_INTERVAL_MS = 30000;
  var MAX_EVENTS = 50;
  var POPUP_SHOWN_KEY = 'eng_popup_shown';
  var SESSION_KEY = 'eng_session_id';
  var SESSION_START_KEY = 'eng_session_start';

  // ---- Session ID (persists across page nav via sessionStorage) ----
  function uuid() {
    // RFC4122-ish v4, good enough for session IDs
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  var sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = uuid();
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  var sessionStart = Number(sessionStorage.getItem(SESSION_START_KEY));
  if (!sessionStart) {
    sessionStart = Date.now();
    sessionStorage.setItem(SESSION_START_KEY, String(sessionStart));
  }

  // ---- Event buffer ----
  var events = [];
  var uniqueProducts = new Set();

  function pushEvent(evt) {
    evt.ts = Date.now();
    events.push(evt);
    if (events.length > MAX_EVENTS) events.shift();
  }

  // ---- Page classification ----
  function classifyPage() {
    var path = window.location.pathname.toLowerCase();
    if (path === '/' || path === '') return 'home';
    if (path.indexOf('/products/') === 0) return 'product';
    if (path.indexOf('/collections/') === 0) return 'category';
    if (path.indexOf('/cart') === 0) return 'cart';
    if (path.indexOf('/checkout') === 0 || path.indexOf('/checkouts/') === 0) return 'checkout';
    if (path.indexOf('/search') === 0) return 'search';
    return 'other';
  }

  // ---- Click classification ----
  function classifyClick(target) {
    if (!target || !target.closest) return null;

    // Walk up to 4 levels looking for meaningful hooks
    var el = target;
    for (var i = 0; i < 4 && el; i++) {
      var id = (el.id || '').toLowerCase();
      var cls = (el.className && typeof el.className === 'string' ? el.className : '').toLowerCase();
      var name = (el.getAttribute && el.getAttribute('name') || '').toLowerCase();
      var haystack = id + ' ' + cls + ' ' + name;

      if (/add.?to.?cart|addtocart|product-form__submit/.test(haystack)) return 'add_to_cart';
      if (/checkout|buy.?now/.test(haystack)) return 'checkout_click';
      if (/wishlist|favorite|save.?for.?later/.test(haystack)) return 'wishlist';
      if (/filter|sort-by|refine/.test(haystack)) return 'filter';
      if (/remove|delete/.test(haystack) && /cart|item/.test(haystack)) return 'remove_from_cart';
      if (/quantity|qty/.test(haystack)) return 'quantity_change';

      el = el.parentElement;
    }
    return null;
  }

  // ---- Initial page view ----
  var currentPage = classifyPage();
  pushEvent({ type: 'page_view', page: currentPage, url: window.location.pathname });
  if (currentPage === 'product') uniqueProducts.add(window.location.pathname);

  // ---- Click listener ----
  document.addEventListener(
    'click',
    function (e) {
      var kind = classifyClick(e.target);
      if (kind) {
        pushEvent({ type: 'click', element: kind, url: window.location.pathname });
      }
    },
    true
  );

  // ---- Shopify cart count (read from cookie or Shopify.cart if available) ----
  function getCartItems() {
    try {
      if (window.Shopify && window.Shopify.cart && typeof window.Shopify.cart.item_count === 'number') {
        return window.Shopify.cart.item_count;
      }
    } catch (_) {}
    // Fallback: count events
    var adds = events.filter(function (e) { return e.type === 'click' && e.element === 'add_to_cart'; }).length;
    var removes = events.filter(function (e) { return e.type === 'click' && e.element === 'remove_from_cart'; }).length;
    return Math.max(0, adds - removes);
  }

  // ---- Build payload ----
  function buildPayload() {
    return {
      sessionId: sessionId,
      current_page: classifyPage(),
      cart_items: getCartItems(),
      time_on_site: Math.floor((Date.now() - sessionStart) / 1000),
      unique_products_viewed: uniqueProducts.size,
      events: events.slice(),
    };
  }

  // ---- Send to backend ----
  var inFlight = false;

  function sendSession() {
    if (inFlight) return;
    // Skip if popup already shown this session
    if (sessionStorage.getItem(POPUP_SHOWN_KEY) === '1') return;

    inFlight = true;
    var payload = buildPayload();

    fetch(API_BASE + '/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.show && data.message) {
          showPopup(data.message);
          sessionStorage.setItem(POPUP_SHOWN_KEY, '1');
        }
      })
      .catch(function (err) {
        console.warn('[engagement] send failed', err);
      })
      .finally(function () {
        inFlight = false;
      });
  }

  // Fire once on load (after a small delay so events accumulate), then every 30s
  setTimeout(sendSession, 8000);
  setInterval(sendSession, SEND_INTERVAL_MS);

  // Also send on page unload (best-effort via sendBeacon)
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && sessionStorage.getItem(POPUP_SHOWN_KEY) !== '1') {
      try {
        var blob = new Blob([JSON.stringify(buildPayload())], { type: 'application/json' });
        navigator.sendBeacon(API_BASE + '/api/session', blob);
      } catch (_) {}
    }
  });

  // ---- Popup UI ----
  function injectStyles() {
    if (document.getElementById('eng-popup-styles')) return;
    var css = [
      '#eng-popup{position:fixed;bottom:24px;right:24px;max-width:340px;',
      'background:#ffffff;color:#1a1a1a;border-radius:12px;',
      'box-shadow:0 10px 30px rgba(0,0,0,0.12),0 2px 6px rgba(0,0,0,0.06);',
      'padding:18px 44px 18px 20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      'font-size:14px;line-height:1.5;z-index:2147483647;',
      'transform:translateY(20px);opacity:0;transition:transform .35s ease,opacity .35s ease;',
      'border:1px solid rgba(0,0,0,0.06);}',
      '#eng-popup.eng-visible{transform:translateY(0);opacity:1;}',
      '#eng-popup p{margin:0;color:#1a1a1a;}',
      '#eng-close{position:absolute;top:8px;right:10px;background:transparent;border:0;',
      'font-size:20px;line-height:1;cursor:pointer;color:#888;padding:4px 8px;border-radius:6px;}',
      '#eng-close:hover{background:rgba(0,0,0,0.05);color:#333;}',
      '@media (max-width:480px){#eng-popup{left:16px;right:16px;bottom:16px;max-width:none;}}',
    ].join('');
    var style = document.createElement('style');
    style.id = 'eng-popup-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function showPopup(message) {
    if (document.getElementById('eng-popup')) return;
    injectStyles();

    var wrap = document.createElement('div');
    wrap.id = 'eng-popup';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-live', 'polite');

    var close = document.createElement('button');
    close.id = 'eng-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.onclick = function () {
      wrap.classList.remove('eng-visible');
      setTimeout(function () { wrap.remove(); }, 350);
    };

    var p = document.createElement('p');
    p.id = 'eng-message';
    p.textContent = message;

    wrap.appendChild(close);
    wrap.appendChild(p);
    document.body.appendChild(wrap);

    // Trigger transition
    requestAnimationFrame(function () {
      wrap.classList.add('eng-visible');
    });

    // Auto-dismiss after 20s
    setTimeout(function () {
      if (document.getElementById('eng-popup')) {
        wrap.classList.remove('eng-visible');
        setTimeout(function () { wrap.remove(); }, 350);
      }
    }, 20000);
  }

  // Expose for debugging
  window.__engagement = {
    sessionId: sessionId,
    getPayload: buildPayload,
    forceSend: sendSession,
    showPopup: showPopup,
  };
})();
