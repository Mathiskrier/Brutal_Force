/*
 * Brutalforce: free shipping invitation with checkbox add-ons (snippets/free-shipping-upsell.liquid)
 *
 * - The box text is STATIC ("Add a 2nd mug — unlock free shipping"). This box does no cart
 *   calculation at all; the live free shipping status lives in the cart bar
 *   (snippets/free-shipping-bar.liquid).
 * - Ticking a row adds NOTHING to the cart. It only marks that mug for the main Add to cart.
 * - The only dynamic element: the main button label/total ("Add 2 to cart · €39,00").
 * - assets/product-form.js asks this element for the ticked mugs (getSelections) when the
 *   main button is pressed, and adds viewed product + ticked mugs in one /cart/add request.
 */
if (!customElements.get('free-shipping-upsell')) {
  customElements.define(
    'free-shipping-upsell',
    class FreeShippingUpsell extends HTMLElement {
      connectedCallback() {
        this.sectionId = this.dataset.sectionId;
        this.seed = Number(this.dataset.seed) || 0;

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
        if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
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

      // Updates only the main button label/total and the PayPal button visibility
      update() {
        const ticked = this.ticked;
        const tickedTotal = ticked.reduce((sum, checkbox) => sum + Number(checkbox.dataset.price || 0), 0);
        const addTotal = this.seed * this.quantity + tickedTotal;
        const addCount = this.quantity + ticked.length;

        this.updateButton(addCount, addTotal);
        if (this.paymentButton) this.paymentButton.hidden = ticked.length > 0;
      }

      updateButton(count, total) {
        if (!this.submitButton || !this.submitText) return;
        if (this.submitButton.hasAttribute('disabled')) return; // sold out / unavailable: keep theme text
        // Base label from the Buy buttons block, e.g. "Add to cart & continue"
        const base = this.submitButton.dataset.addLabel || window.variantStrings?.addToCart || 'Add to cart';
        let label = base;
        if (count > 1) {
          label = /^add to cart/i.test(base) ? base.replace(/^add to cart/i, `Add ${count} to cart`) : `${base} (${count})`;
        }
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
