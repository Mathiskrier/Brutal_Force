/*
 * Brutalforce: keep the cart drawer, cart icon and cart page in sync with the LIVE cart.
 * Browsers can restore a page from the back/forward cache (Back button) or show a tab
 * that was open while the cart changed elsewhere. In those cases the server-rendered
 * drawer (incl. the free shipping bar) would show an old cart. This re-renders it.
 */
(function () {
  if (window.brutalCartFreshness) return;
  window.brutalCartFreshness = true;

  let lastItemCount = null;
  let lastSubtotal = null;

  function sectionHTML(html, selector) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const element = doc.querySelector(selector);
    return element ? element.innerHTML : null;
  }

  async function refresh() {
    try {
      const cartUrl = window.routes?.cart_url || '/cart';
      const cart = await fetch(`${cartUrl}.js`, { headers: { Accept: 'application/json' } }).then((r) => r.json());
      const unknownBaseline = lastItemCount === null;
      const changed = cart.item_count !== lastItemCount || cart.items_subtotal_price !== lastSubtotal;
      lastItemCount = cart.item_count;
      lastSubtotal = cart.items_subtotal_price;
      // Unknown baseline = this page just rendered the cart itself (e.g. after an add): nothing stale
      if (!changed || unknownBaseline) return;

      // Cart page: simplest reliable refresh is a reload
      if (document.getElementById('main-cart-items')) {
        window.location.reload();
        return;
      }

      const drawer = document.querySelector('cart-drawer');
      const root = window.Shopify?.routes?.root || '/';
      const sections = await fetch(`${root}?sections=cart-drawer,cart-icon-bubble`).then((r) => r.json());

      if (drawer && sections['cart-drawer']) {
        const inner = sectionHTML(sections['cart-drawer'], '.drawer__inner');
        const target = drawer.querySelector('.drawer__inner');
        if (inner !== null && target) target.innerHTML = inner;
        drawer.classList.toggle('is-empty', cart.item_count === 0);
      }

      const bubble = document.getElementById('cart-icon-bubble');
      if (bubble && sections['cart-icon-bubble']) {
        const html = sectionHTML(sections['cart-icon-bubble'], '.shopify-section');
        if (html !== null) bubble.innerHTML = html;
      }
    } catch (e) {
      // Leave the page as it is if the cart can't be read
    }
  }

  // Remember the cart this page was rendered with
  fetch(`${window.routes?.cart_url || '/cart'}.js`, { headers: { Accept: 'application/json' } })
    .then((r) => r.json())
    .then((cart) => {
      lastItemCount = cart.item_count;
      lastSubtotal = cart.items_subtotal_price;
    })
    .catch(() => {});

  // Track changes made on this page so a later check doesn't treat them as stale
  if (typeof subscribe === 'function' && window.PUB_SUB_EVENTS) {
    subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
      const cart = event?.cartData;
      if (cart && typeof cart.item_count === 'number') {
        lastItemCount = cart.item_count;
        lastSubtotal = cart.items_subtotal_price;
      } else {
        lastItemCount = null;
        lastSubtotal = null;
      }
    });
  }

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
})();
