/*
 * Brutalforce: real normal-shipping price for the cart summary (snippets/cart-summary.liquid).
 * While free shipping applies, the summary shows "€X,XX (struck) FREE" and adds X to Total savings.
 * X is NOT a fixed number: it is what Shopify would charge for THIS cart in the visitor's country,
 * asked from Shopify's own shipping-rates endpoint (/cart/shipping_rates.json). Shipping here is a
 * flat rate per zone, so a sample postal code per country gives the exact price.
 * If the price can't be fetched (unknown country, error), nothing is added: only "FREE" shows.
 * Results are cached per cart contents + country, so re-renders don't refetch.
 */
(() => {
  if (window.bfCartSummaryBound) return;
  window.bfCartSummaryBound = true;

  // sample address per country (zone-based flat rates: any valid postal code gives the same price)
  const ADDRESSES = {
    AT: ['1010'], BE: ['1000'], BR: ['01001-000', 'SP'], HR: ['10000'], CZ: ['110 00'], DK: ['1050'],
    FR: ['75001'], DE: ['10115'], GR: ['105 52'], HU: ['1011'], IE: ['D01 F5P2', 'D'], IT: ['00118', 'RM'],
    LU: ['1009'], MT: ['VLT 1010'], NL: ['1012 AB'], PL: ['00-001'], PT: ['1100-148', 'PT-11'], SK: ['811 01'],
    SI: ['1000'], ES: ['28001', 'M'], SE: ['111 22'], CH: ['8001'], US: ['10001', 'NY'], GB: ['SW1A 1AA'],
    NO: ['0150'], FI: ['00100'], EE: ['10111'], LV: ['LV-1050'], LT: ['01103'], RO: ['010011', 'B'], BG: ['1000'],
    CY: ['1010'], IS: ['101'], LI: ['9490'], CA: ['M5V 2T6', 'ON'], AU: ['2000', 'NSW'], NZ: ['1010'], JP: ['100-0001', 'JP-13'],
  };
  const pending = new Map();

  function cacheGet(key) {
    try {
      const v = sessionStorage.getItem(key);
      return v === null ? undefined : Number(v);
    } catch (e) {
      return undefined;
    }
  }

  function cacheSet(key, value) {
    try {
      sessionStorage.setItem(key, String(value));
    } catch (e) {}
  }

  async function normalShipping(country, sig) {
    const address = ADDRESSES[country];
    if (!address) return 0;
    const key = `bfShip:${country}:${sig}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;
    if (pending.has(key)) return pending.get(key);

    const request = (async () => {
      const params = new URLSearchParams({
        'shipping_address[country]': country,
        'shipping_address[zip]': address[0],
      });
      if (address[1]) params.set('shipping_address[province]', address[1]);
      const response = await fetch(`${window.Shopify?.routes?.root || '/'}cart/shipping_rates.json?${params}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return 0;
      const data = await response.json();
      const prices = (data.shipping_rates || []).map((r) => Math.round(parseFloat(r.price) * 100)).filter((p) => p >= 0);
      // the standard (cheapest) option is the normal shipping price
      const cents = prices.length ? Math.min(...prices) : 0;
      cacheSet(key, cents);
      return cents;
    })()
      .catch(() => 0)
      .finally(() => pending.delete(key));

    pending.set(key, request);
    return request;
  }

  function formatMoney(cents, sample) {
    const m = (sample || '').match(/^(.*?)1(\D?)234(\D)56(.*)$/);
    if (!m) return (cents / 100).toFixed(2);
    const [, prefix, thousands, decimal, suffix] = m;
    const [whole, fraction] = (cents / 100).toFixed(2).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return `${prefix}${grouped}${decimal}${fraction}${suffix}`;
  }

  async function apply(summary) {
    summary.dataset.rateState = 'loading';
    const cents = await normalShipping(summary.dataset.country, summary.dataset.sig);
    if (!summary.isConnected) return;
    summary.dataset.rateState = 'done';
    if (!(cents > 0)) return; // unknown: show only "FREE", no shipping saving

    const was = summary.querySelector('[data-ship-was]');
    if (was) {
      was.textContent = formatMoney(cents, summary.dataset.moneySample);
      was.hidden = false;
    }
    const total = (Number(summary.dataset.productSavings) || 0) + cents;
    const savings = summary.querySelector('[data-savings]');
    const row = summary.querySelector('[data-savings-row]');
    if (savings) savings.textContent = `−${formatMoney(total, summary.dataset.moneySample)}`;
    if (row) row.hidden = false;
  }

  function scan() {
    document
      .querySelectorAll('.bf-summary[data-ship-free="true"]:not([data-rate-state])')
      .forEach((summary) => apply(summary));
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  });

  function start() {
    scan();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
