/* tracker.js — Shopify engagement tracker
 *
 * Usage (in theme.liquid, before </body>):
 *   <script>window.ENGAGEMENT_API = "https://your-backend.com";</script>
 *   <script src="https://your-cdn/snippet.js" defer></script>
 */
(function () {
  'use strict';

  var API_BASE = (window.ENGAGEMENT_API || '').replace(/\/$/, '');
  if (!API_BASE) {
    console.warn('[engagement] window.ENGAGEMENT_API is not set. Tracker disabled.');
    return;
  }

  var SEND_INTERVAL_MS  = 30000;
  var MAX_EVENTS        = 50;
  var POPUP_SHOWN_KEY   = 'eng_popup_shown';
  var SESSION_KEY       = 'eng_session_id';
  var SESSION_START_KEY = 'eng_session_start';

  // ---- Session ID ----
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  var sessionId = sessionStorage.getItem(SESSION_KEY) || uuid();
  sessionStorage.setItem(SESSION_KEY, sessionId);

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
    var p = window.location.pathname.toLowerCase();
    if (p === '/' || p === '') return 'home';
    if (p.indexOf('/products/') === 0)  return 'product';
    if (p.indexOf('/collections/') === 0) return 'category';
    if (p.indexOf('/cart') === 0)       return 'cart';
    if (p.indexOf('/checkout') === 0 || p.indexOf('/checkouts/') === 0) return 'checkout';
    if (p.indexOf('/search') === 0)     return 'search';
    return 'other';
  }

  // ---- Click classification ----
  function classifyClick(target) {
    if (!target) return null;
    var el = target;
    for (var i = 0; i < 5 && el; i++) {
      var haystack = [
        el.id || '',
        typeof el.className === 'string' ? el.className : '',
        el.getAttribute ? (el.getAttribute('name') || '') : '',
        el.getAttribute ? (el.getAttribute('data-action') || '') : '',
      ].join(' ').toLowerCase();

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

  // ---- Scroll depth tracking ----
  var maxScrollPct = 0;
  function updateScroll() {
    var scrolled = window.scrollY || window.pageYOffset || 0;
    var docHeight = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.body.offsetHeight, document.documentElement.offsetHeight
    ) - window.innerHeight;
    if (docHeight > 0) {
      var pct = Math.round((scrolled / docHeight) * 100);
      if (pct > maxScrollPct) maxScrollPct = Math.min(pct, 100);
    }
  }
  window.addEventListener('scroll', updateScroll, { passive: true });

  // ---- Per-page time tracking ----
  var pageStartTime = Date.now();

  // ---- Initial page view ----
  var currentPage = classifyPage();
  pushEvent({ type: 'page_view', page: currentPage, url: window.location.pathname });
  if (currentPage === 'product') uniqueProducts.add(window.location.pathname);

  // Strong signals that warrant an immediate send (don't wait for the timer)
  var INSTANT_SEND_EVENTS = { add_to_cart: true, checkout_click: true, wishlist: true };

  // ---- Click listener ----
  document.addEventListener('click', function (e) {
    var kind = classifyClick(e.target);
    if (!kind) return;
    pushEvent({ type: 'click', element: kind, url: window.location.pathname });
    if (INSTANT_SEND_EVENTS[kind]) {
      // Small delay so Shopify can update cart state before we read it
      setTimeout(sendSession, 800);
    }
  }, true);

  // ---- Cart item count ----
  function getCartItems() {
    try {
      if (window.Shopify && window.Shopify.cart && typeof window.Shopify.cart.item_count === 'number') {
        return window.Shopify.cart.item_count;
      }
    } catch (_) {}
    var adds    = events.filter(function (e) { return e.element === 'add_to_cart'; }).length;
    var removes = events.filter(function (e) { return e.element === 'remove_from_cart'; }).length;
    return Math.max(0, adds - removes);
  }

  // ---- Build payload ----
  function buildPayload() {
    return {
      sessionId:              sessionId,
      current_page:           classifyPage(),
      cart_items:             getCartItems(),
      time_on_site:           Math.floor((Date.now() - sessionStart) / 1000),
      page_time:              Math.floor((Date.now() - pageStartTime) / 1000),
      scroll_depth:           maxScrollPct,
      unique_products_viewed: uniqueProducts.size,
      events:                 events.slice(),
    };
  }

  // ---- Send to backend ----
  var inFlight = false;

  function sendSession() {
    if (inFlight) return;
    inFlight = true;

    fetch(API_BASE + '/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
      keepalive: true,
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.show && data.message) {
          showPopup(data.message);
          sessionStorage.setItem(POPUP_SHOWN_KEY, '1');
        }
      })
      .catch(function (err) { console.warn('[engagement] send failed', err); })
      .finally(function () { inFlight = false; });
  }

  // First send after 3s, then every 30s
  setTimeout(sendSession, 3000);
  setInterval(sendSession, SEND_INTERVAL_MS);

  // Best-effort send on tab hide / page close
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && sessionStorage.getItem(POPUP_SHOWN_KEY) !== '1') {
      try {
        navigator.sendBeacon(API_BASE + '/api/session',
          new Blob([JSON.stringify(buildPayload())], { type: 'application/json' }));
      } catch (_) {}
    }
  });

  // ---- Popup UI ----
  function injectStyles() {
    if (document.getElementById('eng-styles')) return;
    var style = document.createElement('style');
    style.id = 'eng-styles';
    style.textContent = [
      '#eng-popup{',
        'position:fixed;bottom:24px;right:24px;max-width:320px;',
        'background:#fff;color:#1a1a1a;border-radius:14px;',
        'box-shadow:0 12px 36px rgba(0,0,0,0.14),0 2px 8px rgba(0,0,0,0.06);',
        'padding:16px 20px 16px 20px;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        'font-size:14px;line-height:1.5;z-index:2147483647;',
        'transform:translateY(16px);opacity:0;',
        'transition:transform .3s ease,opacity .3s ease;',
        'border:1px solid rgba(0,0,0,0.07);',
      '}',
      '#eng-popup.eng-visible{transform:translateY(0);opacity:1;}',
      '#eng-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;}',
      '#eng-label{font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:#888;}',
      '#eng-close{background:none;border:0;cursor:pointer;color:#aaa;font-size:18px;line-height:1;padding:0 0 0 8px;}',
      '#eng-close:hover{color:#444;}',
      '#eng-message{margin:0;color:#1a1a1a;font-size:14px;}',
      '#eng-cta{display:inline-block;margin-top:12px;padding:8px 16px;',
        'background:#1a1a1a;color:#fff;border-radius:8px;font-size:13px;font-weight:500;',
        'text-decoration:none;cursor:pointer;border:0;width:100%;text-align:center;',
        'transition:background .2s;}',
      '#eng-cta:hover{background:#333;}',
      '@media(max-width:480px){#eng-popup{left:16px;right:16px;bottom:16px;max-width:none;}}',
    ].join('');
    document.head.appendChild(style);
  }

  function showPopup(message) {
    if (document.getElementById('eng-popup')) return;
    injectStyles();

    var wrap = document.createElement('div');
    wrap.id = 'eng-popup';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-live', 'polite');

    var header = document.createElement('div');
    header.id = 'eng-header';

    var label = document.createElement('span');
    label.id = 'eng-label';
    label.textContent = 'Just for you';

    var closeBtn = document.createElement('button');
    closeBtn.id = 'eng-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.onclick = function () {
      wrap.classList.remove('eng-visible');
      setTimeout(function () { wrap.remove(); }, 350);
    };

    header.appendChild(label);
    header.appendChild(closeBtn);

    var p = document.createElement('p');
    p.id = 'eng-message';
    p.textContent = message;

    var cta = document.createElement('button');
    cta.id = 'eng-cta';
    cta.textContent = 'Shop Now';
    cta.onclick = function () {
      wrap.classList.remove('eng-visible');
      setTimeout(function () { wrap.remove(); }, 350);
    };

    wrap.appendChild(header);
    wrap.appendChild(p);
    wrap.appendChild(cta);
    document.body.appendChild(wrap);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { wrap.classList.add('eng-visible'); });
    });

    // Auto-dismiss after 20s
    setTimeout(function () {
      if (document.getElementById('eng-popup')) {
        wrap.classList.remove('eng-visible');
        setTimeout(function () { wrap.remove(); }, 350);
      }
    }, 20000);
  }

  window.__engagement = {
    sessionId:  sessionId,
    getPayload: buildPayload,
    forceSend:  sendSession,
    showPopup:  showPopup,
  };
})();
