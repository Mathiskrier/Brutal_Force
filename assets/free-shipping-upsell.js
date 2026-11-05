/*
 * Brutalforce: free shipping box with checkbox add-ons (snippets/free-shipping-upsell.liquid)
 *
 * - Ticking a row adds NOTHING to the cart. It only marks that mug for the main Add to cart.
 * - assets/product-form.js asks this element for the ticked mugs (getSelections) when the
 *   main button is pressed, and adds viewed product + ticked mugs in one /cart/add request.
 * - Text only, no progress bar. Projected = live cart subtotal (/cart.js) + ticked mugs
 *   + the viewed product (price x quantity) only if it is NOT in the cart yet. That way this box
 *   never says "unlocked" while the cart bar (snippets/free-shipping-bar.liquid) still shows a gap.
 *   The message switches between "away" and "unlocked" at the threshold.
 * - Threshold: Theme settings > Free shipping (settings.free_shipping_threshold), passed in as cents.
 */
if (!customElements.get('free-shipping-upsell')) {
  customElements.define(
    'free-shipping-upsell',
    class FreeShippingUpsell extends HTMLElement {
      connectedCallback() {
        const rate = Number(window.Shopify?.currency?.rate) || 1;
        this.sectionId = this.dataset.sectionId;
        this.threshold = Math.round(Number(this.dataset.threshold) * rate);
        this.seed = Number(this.dataset.seed) || 0;
        this.productId = Number(this.dataset.productId);
        this.cartSubtotal = null;
        this.viewedInCart = false;

        this.heading = this.querySelector('[data-fs-heading]');
        this.note = this.querySelector('[data-fs-note]');
        this.checkboxes = Array.from(this.querySelectorAll('.fs-upsell__checkbox'));

        this.submitButton = document.getElementById(`ProductSubmitButton-${this.sectionId}`);
        this.submitText = this.submitButton?.querySelector('span');
        this.paymentButton = this.submitButton?.closest('form')?.querySelector('.shopify-payment-button');

        this.onQuantityChange = () => this.update();
        this.checkboxes.forEach((checkbox) => checkbox.addEventListener('change', () => this.update()));
        document.addEventListener('change', this.onQuantityChange);
        document.addEventListener('input', this.onQuantityChange);

        this.unsubscribers = [];
        if (typeof subscribe === 'function' && window.PUB_SUB_EVENTS) {
          this.unsubscribers.push(subscribe(PUB_SUB_EVENTS.cartUpdate, () => this.refreshCart()));
          this.unsubscribers.push(
            subscribe(PUB_SUB_EVENTS.variantChange, (event) => {
              if (event?.data?.sectionId !== this.sectionId) return;
              if (event.data.variant) this.seed = Number(event.data.variant.price) || 0;
              // product-info.js resets the button text on variant change; re-apply ours afterwards
              setTimeout(() => this.update());
            })
          );
        }

        this.update();
        this.refreshCart();
      }

      disconnectedCallback() {
        document.removeEventListener('change', this.onQuantityChange);
        document.removeEventListener('input', this.onQuantityChange);
        (this.unsubscribers || []).forEach((unsubscribe) => unsubscribe && unsubscribe());
      }

      get quantity() {
        const input = document.getElementById(`Quantity-${this.sectionId}`);
        return Math.max(1, parseInt(input?.value, 10) || 1);
      }

      get ticked() {
        return this.checkboxes.filter((checkbox) => checkbox.checked && !checkbox.disabled);
      }

      async refreshCart() {
        try {
          const response = await fetch(`${window.routes?.cart_url || '/cart'}.js`, {
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) return;
          const cart = await response.json();
          this.cartSubtotal = cart.items_subtotal_price || 0;
          this.viewedInCart = (cart.items || []).some((item) => item.product_id === this.productId);
          this.update();
        } catch (e) {
          // Keep the last known state if the cart can't be read
        }
      }

      update() {
        const ticked = this.ticked;
        const tickedTotal = ticked.reduce((sum, checkbox) => sum + Number(checkbox.dataset.price || 0), 0);
        const addTotal = this.seed * this.quantity + tickedTotal;
        const addCount = this.quantity + ticked.length;

        this.updateButton(addCount, addTotal);
        if (this.paymentButton) this.paymentButton.hidden = ticked.length > 0;

        if (this.cartSubtotal === null || !this.threshold) return;
        const viewedTotal = this.viewedInCart ? 0 : this.seed * this.quantity;
        const projected = this.cartSubtotal + viewedTotal + tickedTotal;
        const remaining = Math.max(0, this.threshold - projected);
        const unlocked = remaining === 0;

        this.classList.toggle('is-unlocked', unlocked);
        this.heading.textContent = unlocked
          ? this.dataset.textUnlocked
          : this.dataset.textAway.replace('[amount]', this.formatMoney(remaining));
      }

      updateButton(count, total) {
        if (!this.submitButton || !this.submitText) return;
        if (this.submitButton.hasAttribute('disabled')) return; // sold out / unavailable: keep theme text
        const base = window.variantStrings?.addToCart || 'Add to cart';
        const label = count > 1 ? `Add ${count} to cart` : base;
        this.submitText.textContent = `${label} · ${this.formatMoney(total)}`;
      }

      /*
       * Called by product-form.js right before adding to the cart.
       * Re-checks availability of ticked mugs, skips unavailable ones and tells the customer.
       */
      async getSelections() {
        const ticked = this.ticked;
        const items = [];
        const skipped = [];
        this.hideNote();

        await Promise.all(
          ticked.map(async (checkbox) => {
            const variantId = Number(checkbox.value);
            let available = true;
            try {
              const root = window.Shopify?.routes?.root || '/';
              const response = await fetch(`${root}products/${checkbox.dataset.handle}.js`, {
                headers: { Accept: 'application/json' },
              });
              if (response.ok) {
                const product = await response.json();
                const variant = (product.variants || []).find((v) => v.id === variantId);
                available = Boolean(variant && variant.available);
              } else {
                available = false;
              }
            } catch (e) {
              available = true; // network hiccup: let /cart/add decide
            }

            if (available) {
              items.push({ id: variantId, quantity: 1 });
            } else {
              skipped.push(checkbox.dataset.title);
              checkbox.checked = false;
              checkbox.disabled = true;
              checkbox.closest('.fs-upsell__item')?.classList.add('is-unavailable');
            }
          })
        );

        // keep the order of the rows
        items.sort(
          (a, b) =>
            this.checkboxes.findIndex((c) => Number(c.value) === a.id) -
            this.checkboxes.findIndex((c) => Number(c.value) === b.id)
        );

        if (skipped.length) {
          const verb = skipped.length > 1 ? "are no longer available and weren't" : "is no longer available and wasn't";
          this.showNote(`${skipped.join(' and ')} ${verb} added.`);
          this.update();
        }
        return { items, skipped };
      }

      // Called by product-form.js after a successful add
      afterAdd() {
        this.checkboxes.forEach((checkbox) => (checkbox.checked = false));
        this.update();
        this.refreshCart();
      }

      showNote(text) {
        if (!this.note) return;
        this.note.textContent = text;
        this.note.classList.remove('hidden');
      }

      hideNote() {
        if (!this.note) return;
        this.note.textContent = '';
        this.note.classList.add('hidden');
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
