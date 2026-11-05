/*
 * Brutalforce: free shipping upsell (snippets/free-shipping-upsell.liquid)
 * - Reads the live cart (/cart.js) and shows how far the order is from free shipping.
 *   Projected order = cart subtotal + the viewed product, if it is not in the cart yet.
 * - "Add" buttons add the first available variant via /cart/add.js without leaving the page,
 *   then refresh the cart notification / drawer, the cart icon and this bar.
 */
if (!customElements.get('free-shipping-upsell')) {
  customElements.define(
    'free-shipping-upsell',
    class FreeShippingUpsell extends HTMLElement {
      connectedCallback() {
        const rate = Number(window.Shopify?.currency?.rate) || 1;
        this.threshold = Math.round(Number(this.dataset.threshold) * rate);
        this.seed = Number(this.dataset.seed) || 0;
        this.productId = Number(this.dataset.productId);
        this.heading = this.querySelector('[data-fs-heading]');
        this.bar = this.querySelector('.fs-upsell__bar');
        this.fill = this.querySelector('.fs-upsell__bar-fill');

        this.querySelectorAll('[data-variant-id]').forEach((button) => {
          button.addEventListener('click', () => this.add(button));
        });

        if (typeof subscribe === 'function' && window.PUB_SUB_EVENTS) {
          this.unsubscribe = subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
            if (event?.source !== 'free-shipping-upsell') this.refresh();
          });
        }

        this.refresh();
      }

      disconnectedCallback() {
        if (this.unsubscribe) this.unsubscribe();
      }

      async refresh() {
        try {
          const cartUrl = (window.routes?.cart_url || '/cart') + '.js';
          const response = await fetch(cartUrl, { headers: { Accept: 'application/json' } });
          if (!response.ok) return;
          this.render(await response.json());
        } catch (e) {
          // Keep the server-rendered state if the cart can't be read
        }
      }

      render(cart) {
        if (!this.threshold) return;
        const viewedInCart = (cart.items || []).some((item) => item.product_id === this.productId);
        const projected = (cart.items_subtotal_price || 0) + (viewedInCart ? 0 : this.seed);
        const remaining = Math.max(0, this.threshold - projected);
        const progress = Math.min(100, (projected / this.threshold) * 100);
        const unlocked = remaining === 0;

        this.fill.style.width = `${progress}%`;
        this.bar.setAttribute('aria-valuenow', String(Math.round(progress)));
        this.classList.toggle('is-unlocked', unlocked);
        this.heading.textContent = unlocked
          ? this.dataset.textUnlocked
          : this.dataset.textAway.replace('[amount]', this.formatMoney(remaining));
      }

      async add(button) {
        if (button.disabled) return;
        button.disabled = true;
        button.classList.add('is-loading');

        const cartUi = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        const body = { id: Number(button.dataset.variantId), quantity: 1 };
        if (cartUi && typeof cartUi.getSectionsToRender === 'function') {
          body.sections = cartUi.getSectionsToRender().map((section) => section.id);
          body.sections_url = window.location.pathname;
        }

        try {
          const addUrl = (window.routes?.cart_add_url || '/cart/add') + '.js';
          const response = await fetch(addUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await response.json();
          if (!response.ok || data.status) throw data;

          if (cartUi) {
            cartUi.classList.remove('is-empty');
            try {
              cartUi.renderContents(data);
            } catch (e) {
              // Cart UI could not be refreshed; the item is still in the cart
            }
          }

          if (typeof publish === 'function' && window.PUB_SUB_EVENTS) {
            publish(PUB_SUB_EVENTS.cartUpdate, {
              source: 'free-shipping-upsell',
              productVariantId: body.id,
              cartData: data,
            });
          }

          this.flash(button, 'is-added');
          await this.refresh();
        } catch (error) {
          this.flash(button, 'is-error');
          if (error?.description) console.warn('[free-shipping-upsell]', error.description);
        } finally {
          button.disabled = false;
          button.classList.remove('is-loading');
        }
      }

      flash(button, className) {
        button.classList.remove('is-added', 'is-error');
        button.classList.add(className);
        clearTimeout(button.flashTimer);
        button.flashTimer = setTimeout(() => button.classList.remove(className), 2000);
      }

      formatMoney(cents) {
        const format = this.dataset.moneyFormat || '€{{amount_with_comma_separator}}';
        const number = (value, decimals, thousands = ',', decimal = '.') => {
          const [whole, fraction] = (value / 100).toFixed(decimals).split('.');
          const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
          return fraction ? grouped + decimal + fraction : grouped;
        };
        return format.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
          switch (key) {
            case 'amount_no_decimals':
              return number(cents, 0);
            case 'amount_with_comma_separator':
              return number(cents, 2, '.', ',');
            case 'amount_no_decimals_with_comma_separator':
              return number(cents, 0, '.', ',');
            case 'amount_with_apostrophe_separator':
              return number(cents, 2, "'", '.');
            case 'amount_no_decimals_with_space_separator':
              return number(cents, 0, ' ');
            case 'amount_with_space_separator':
              return number(cents, 2, ' ', ',');
            default:
              return number(cents, 2);
          }
        });
      }
    }
  );
}
