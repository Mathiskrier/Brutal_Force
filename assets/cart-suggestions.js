/*
 * Brutalforce: one-tap "+ Add" for the cart suggestions (snippets/cart-suggestions.liquid).
 * Adds through Shopify's /cart/add.js and asks for the cart drawer + cart bubble sections in the
 * same request, then lets the drawer render them (same path as the main Add to cart button).
 * Everything shown - items, free shipping bar, suggestions, totals - comes from that one response,
 * i.e. from one live cart. Event delegation, because the drawer HTML is replaced on every update.
 */
(() => {
  if (window.bfCartSuggestionsBound) return;
  window.bfCartSuggestionsBound = true;

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-bf-suggest-add]');
    if (!button || button.disabled) return;
    event.preventDefault();

    const drawer = document.querySelector('cart-drawer');
    const box = button.closest('[data-bf-suggest]');
    const error = box?.querySelector('.bf-suggest__error');
    if (error) error.hidden = true;

    button.disabled = true;
    button.classList.add('is-loading');

    try {
      const sections = drawer && typeof drawer.getSectionsToRender === 'function'
        ? drawer.getSectionsToRender().map((section) => section.id)
        : ['cart-drawer', 'cart-icon-bubble'];
      const url = `${window.routes?.cart_add_url || '/cart/add'}.js`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          items: [{ id: Number(button.dataset.variantId), quantity: 1 }],
          sections,
          sections_url: window.location.pathname,
        }),
      });
      const data = await response.json();

      if (!response.ok || data.status) {
        throw new Error(data.description || data.message || 'This mug could not be added.');
      }

      // /cart/add.js with items[] returns { items, sections }; the drawer expects { id, sections }
      const state = { ...data, id: data.items?.[0]?.id, key: data.items?.[0]?.key };
      if (drawer && typeof drawer.renderContents === 'function') {
        drawer.renderContents(state);
      } else {
        window.location.reload();
        return;
      }

      if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'bf-cart-suggestions', cartData: state });
      }
    } catch (e) {
      button.disabled = false;
      button.classList.remove('is-loading');
      if (error) {
        error.textContent = e.message || 'This mug could not be added. Please try again.';
        error.hidden = false;
      }
    }
  });
})();
