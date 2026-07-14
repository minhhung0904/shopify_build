function formatMoney(cents, currency) {
  const amount = (Number(cents) || 0) / 100;
  // Keep a plain "$" symbol only (no "US" locale prefix like "US$").
  const number = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${number}`;
}

function applyDiscount(baseCents, discountType, discountValue) {
  const value = Number(discountValue) || 0;
  if (discountType === 'percentage') {
    return Math.max(0, Math.round(baseCents * (1 - value / 100)));
  }
  if (discountType === 'fixed_amount') {
    return Math.max(0, baseCents - Math.round(value * 100));
  }
  if (discountType === 'fixed_price') {
    return Math.max(0, Math.round(value * 100));
  }
  return baseCents;
}

function addBundleToCart({ lines, bundleHandle, bundleTitle, cartAddUrl, cartUrl, submitBtn, errorEl }) {
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.remove('is-visible');
  }
  if (!lines.length || !cartAddUrl) return;

  submitBtn.setAttribute('disabled', 'disabled');
  const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const items = lines.map(({ id, quantity, role }) => ({
    id,
    quantity: quantity || 1,
    properties: {
      _bundle_handle: bundleHandle,
      _bundle_instance: instanceId,
      ...(bundleTitle ? { _bundle: bundleTitle } : {}),
      // Lets the cart page tell the main product line apart from its
      // add-ons, so removing the main line can cascade-remove the add-ons.
      ...(role ? { _bundle_role: role } : {}),
    },
  }));

  // Prefer opening the slide-out cart drawer over a full navigation to
  // /cart — matches how the theme's own product form adds to cart.
  const cartDrawer = document.querySelector('cart-drawer') || document.querySelector('cart-notification');
  const body = { items };
  if (cartDrawer && typeof cartDrawer.getSectionsToRender === 'function') {
    body.sections = cartDrawer.getSectionsToRender().map((section) => section.id);
    body.sections_url = window.location.pathname;
  }

  fetch(cartAddUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
    .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) {
        const message = data.description || data.message || 'Could not add this bundle to your cart.';
        throw new Error(message);
      }
      if (cartDrawer && typeof cartDrawer.renderContents === 'function') {
        cartDrawer.renderContents(data);
        submitBtn.removeAttribute('disabled');
      } else {
        window.location.href = cartUrl || '/cart';
      }
    })
    .catch((error) => {
      submitBtn.removeAttribute('disabled');
      if (errorEl) {
        errorEl.textContent = error.message;
        errorEl.classList.add('is-visible');
      }
    });
}

class BundleFixed extends HTMLElement {
  connectedCallback() {
    this.variantHolders = Array.from(this.querySelectorAll('[data-product-variants]'));
    this.priceEl = this.querySelector('[data-bundle-price]');
    this.submitBtn = this.querySelector('[data-bundle-submit]');
    this.errorEl = this.querySelector('[data-bundle-error]');
    if (!this.submitBtn) return;

    this.variantHolders.forEach((el) => {
      if (el.tagName === 'SELECT') {
        el.addEventListener('change', () => this.recalcPrice());
      }
    });

    this.submitBtn.addEventListener('click', () => this.onSubmit());
    this.recalcPrice();
  }

  currentLines() {
    return this.variantHolders.map((el) => {
      if (el.tagName === 'SELECT') {
        const option = el.selectedOptions[0];
        return { id: option?.value, price: Number(option?.dataset.price || 0) };
      }
      return { id: el.dataset.fixedVariantId, price: Number(el.dataset.price || 0) };
    });
  }

  recalcPrice() {
    const lines = this.currentLines();
    const baseCents = lines.reduce((sum, line) => sum + line.price, 0);
    const discounted = applyDiscount(baseCents, this.dataset.discountType, this.dataset.discountValue);
    if (this.priceEl) {
      this.priceEl.textContent = formatMoney(discounted, this.dataset.currency);
    }
  }

  onSubmit() {
    const lines = this.currentLines()
      .filter((line) => line.id)
      .map((line) => ({ id: line.id, quantity: 1 }));

    addBundleToCart({
      lines,
      bundleHandle: this.dataset.bundleHandle,
      bundleTitle: this.dataset.bundleTitle,
      cartAddUrl: this.dataset.cartAddUrl,
      cartUrl: this.dataset.cartUrl,
      submitBtn: this.submitBtn,
      errorEl: this.errorEl,
    });
  }
}

class BundleMixMatch extends HTMLElement {
  connectedCallback() {
    this.poolItems = Array.from(this.querySelectorAll('.bp-pool-item'));
    this.counterEl = this.querySelector('[data-bundle-counter]');
    this.priceEl = this.querySelector('[data-bundle-price]');
    this.submitBtn = this.querySelector('[data-bundle-submit]');
    this.errorEl = this.querySelector('[data-bundle-error]');
    this.minItems = Number(this.dataset.minItems || 1);
    this.maxItems = Number(this.dataset.maxItems || this.poolItems.length || 1);
    this.selected = new Set();

    this.poolItems.forEach((item) => {
      item.addEventListener('click', () => this.toggleItem(item));
    });
    this.submitBtn?.addEventListener('click', () => this.onSubmit());

    this.render();
  }

  toggleItem(item) {
    if (item.disabled) return;
    const variantId = item.dataset.variantId;
    if (this.selected.has(variantId)) {
      this.selected.delete(variantId);
    } else {
      if (this.selected.size >= this.maxItems) return;
      this.selected.add(variantId);
    }
    this.render();
  }

  render() {
    this.poolItems.forEach((item) => {
      item.classList.toggle('is-selected', this.selected.has(item.dataset.variantId));
    });

    if (this.counterEl) {
      this.counterEl.textContent = `Selected ${this.selected.size} of max ${this.maxItems} (${this.minItems} required)`;
    }

    const baseCents = this.poolItems
      .filter((item) => this.selected.has(item.dataset.variantId))
      .reduce((sum, item) => sum + Number(item.dataset.price || 0), 0);
    const discounted = applyDiscount(baseCents, this.dataset.discountType, this.dataset.discountValue);
    if (this.priceEl) {
      this.priceEl.textContent = this.selected.size > 0 ? formatMoney(discounted, this.dataset.currency) : '';
    }

    if (this.submitBtn) {
      const isValid = this.selected.size >= this.minItems && this.selected.size <= this.maxItems;
      this.submitBtn.toggleAttribute('disabled', !isValid);
    }
  }

  onSubmit() {
    const lines = Array.from(this.selected).map((id) => ({ id, quantity: 1 }));
    addBundleToCart({
      lines,
      bundleHandle: this.dataset.bundleHandle,
      bundleTitle: this.dataset.bundleTitle,
      cartAddUrl: this.dataset.cartAddUrl,
      cartUrl: this.dataset.cartUrl,
      submitBtn: this.submitBtn,
      errorEl: this.errorEl,
    });
  }
}

class BundleVolume extends HTMLElement {
  connectedCallback() {
    this.qtyInput = this.querySelector('[data-bundle-qty]');
    this.decreaseBtn = this.querySelector('[data-bundle-qty-decrease]');
    this.increaseBtn = this.querySelector('[data-bundle-qty-increase]');
    this.tiers = Array.from(this.querySelectorAll('.bp-tier'));
    this.priceEl = this.querySelector('[data-bundle-price]');
    this.submitBtn = this.querySelector('[data-bundle-submit]');
    this.errorEl = this.querySelector('[data-bundle-error]');
    if (!this.submitBtn) return;

    this.decreaseBtn?.addEventListener('click', () => this.setQty(this.qty() - 1));
    this.increaseBtn?.addEventListener('click', () => this.setQty(this.qty() + 1));
    this.qtyInput?.addEventListener('input', () => this.render());
    this.submitBtn.addEventListener('click', () => this.onSubmit());

    this.render();
  }

  qty() {
    return Math.max(1, Number(this.qtyInput?.value || 1));
  }

  setQty(value) {
    if (this.qtyInput) this.qtyInput.value = Math.max(1, value);
    this.render();
  }

  activeTier(qty) {
    return this.tiers
      .filter((tier) => qty >= Number(tier.dataset.minQuantity || 0))
      .sort((a, b) => Number(b.dataset.minQuantity) - Number(a.dataset.minQuantity))[0];
  }

  render() {
    const qty = this.qty();
    const baseCents = Number(this.dataset.price || 0) * qty;
    const tier = this.activeTier(qty);

    this.tiers.forEach((t) => t.classList.toggle('is-active', t === tier));

    const discounted = tier
      ? applyDiscount(baseCents, tier.dataset.discountType, tier.dataset.value)
      : baseCents;

    if (this.priceEl) {
      this.priceEl.textContent = formatMoney(discounted, this.dataset.currency);
    }
  }

  onSubmit() {
    addBundleToCart({
      lines: [{ id: this.dataset.variantId, quantity: this.qty() }],
      bundleHandle: this.dataset.bundleHandle,
      bundleTitle: this.dataset.bundleTitle,
      cartAddUrl: this.dataset.cartAddUrl,
      cartUrl: this.dataset.cartUrl,
      submitBtn: this.submitBtn,
      errorEl: this.errorEl,
    });
  }
}

// Multipack: a single variant added at a fixed pack quantity, with the pack
// price discounted as a whole.
class BundleMultipack extends HTMLElement {
  connectedCallback() {
    this.variantSelect = this.querySelector('[data-bundle-variant-select]');
    this.priceEl = this.querySelector('[data-bundle-price]');
    this.submitBtn = this.querySelector('[data-bundle-submit]');
    this.errorEl = this.querySelector('[data-bundle-error]');
    this.packSize = Math.max(1, Number(this.dataset.packSize || 1));
    if (!this.submitBtn) return;

    this.variantSelect?.addEventListener('change', () => this.render());
    this.submitBtn.addEventListener('click', () => this.onSubmit());
    this.render();
  }

  currentVariant() {
    if (this.variantSelect) {
      const option = this.variantSelect.selectedOptions[0];
      return { id: option?.value, price: Number(option?.dataset.price || 0) };
    }
    return {
      id: this.dataset.variantId,
      price: Number(this.dataset.price || 0),
    };
  }

  render() {
    const { price } = this.currentVariant();
    const base = price * this.packSize;
    const discounted = applyDiscount(
      base,
      this.dataset.discountType,
      this.dataset.discountValue,
    );
    if (this.priceEl) {
      this.priceEl.textContent = formatMoney(discounted, this.dataset.currency);
    }
  }

  onSubmit() {
    const { id } = this.currentVariant();
    if (!id) return;
    addBundleToCart({
      lines: [{ id, quantity: this.packSize }],
      bundleHandle: this.dataset.bundleHandle,
      bundleTitle: this.dataset.bundleTitle,
      cartAddUrl: this.dataset.cartAddUrl,
      cartUrl: this.dataset.cartUrl,
      submitBtn: this.submitBtn,
      errorEl: this.errorEl,
    });
  }
}

// BOGO: buy N of a chosen "buy" variant, get M of a chosen "get" variant at a
// reward discount. Both lines share the bundle grouping so the discount
// function can validate the pair and discount only the "get" line.
class BundleBogo extends HTMLElement {
  connectedCallback() {
    this.buySelect = this.querySelector('[data-bogo-buy]');
    this.getSelect = this.querySelector('[data-bogo-get]');
    this.priceEl = this.querySelector('[data-bundle-price]');
    this.submitBtn = this.querySelector('[data-bundle-submit]');
    this.errorEl = this.querySelector('[data-bundle-error]');
    this.buyQty = Math.max(1, Number(this.dataset.buyQuantity || 1));
    this.getQty = Math.max(1, Number(this.dataset.getQuantity || 1));
    if (!this.submitBtn) return;

    this.buySelect?.addEventListener('change', () => this.render());
    this.getSelect?.addEventListener('change', () => this.render());
    this.submitBtn.addEventListener('click', () => this.onSubmit());
    this.render();
  }

  selected(select) {
    const option = select?.selectedOptions[0];
    return { id: option?.value, price: Number(option?.dataset.price || 0) };
  }

  render() {
    const buy = this.selected(this.buySelect);
    const get = this.selected(this.getSelect);
    const buyBase = buy.price * this.buyQty;
    const getBase = get.price * this.getQty;
    const discountedGet = applyDiscount(
      getBase,
      this.dataset.rewardDiscountType,
      this.dataset.rewardDiscountValue,
    );
    if (this.priceEl) {
      this.priceEl.textContent = formatMoney(
        buyBase + discountedGet,
        this.dataset.currency,
      );
    }
  }

  onSubmit() {
    const buy = this.selected(this.buySelect);
    const get = this.selected(this.getSelect);
    const lines = [];
    if (buy.id) lines.push({ id: buy.id, quantity: this.buyQty });
    if (get.id) lines.push({ id: get.id, quantity: this.getQty });
    if (!lines.length) return;
    addBundleToCart({
      lines,
      bundleHandle: this.dataset.bundleHandle,
      bundleTitle: this.dataset.bundleTitle,
      cartAddUrl: this.dataset.cartAddUrl,
      cartUrl: this.dataset.cartUrl,
      submitBtn: this.submitBtn,
      errorEl: this.errorEl,
    });
  }
}

// Tiered "Bundle & Save": full-width tier rows; selecting one expands it to
// per-unit variant dropdowns plus optional add-on checkboxes. onSubmit groups
// same-variant units into one cart line each, so the main product adds as a
// single line whenever every unit shares a variant, and as one line per
// distinct variant otherwise (a real cart line is always tied to one
// variant — the cart page visually re-merges those lines back into a single
// card, see bundle-cascade-delete.js). The tier discount applies to the main
// product units and the add-on discount to the add-ons.
class BundleTiered extends HTMLElement {
  connectedCallback() {
    this.variants = this.parseJSON('[data-bp-variants]', []);
    this.addOns = this.parseJSON('[data-bp-addons]', []);
    this.addOnDiscount = this.parseJSON('[data-bp-addon-discount]', {
      discountType: 'percentage',
      discountValue: 0,
    });
    this.tierEls = Array.from(this.querySelectorAll('.bp-tier2'));
    this.radios = Array.from(this.querySelectorAll('.bp-tier2__radio'));
    this.submitBtn = this.querySelector('[data-bundle-submit]');
    this.errorEl = this.querySelector('[data-bundle-error]');
    if (!this.submitBtn || !this.tierEls.length || !this.variants.length) return;

    this.selection = []; // chosen variant id per main slot (selected tier)
    this.addOnChecked = new Set(this.addOns.map((a) => String(a.id)));

    this.radios.forEach((r) =>
      r.addEventListener('change', () => this.selectTier()),
    );
    this.submitBtn.addEventListener('click', () => this.onSubmit());

    const checked = this.radios.find((r) => r.checked) || this.radios[0];
    checked.checked = true;
    this.selectTier();
  }

  parseJSON(sel, fallback) {
    const el = this.querySelector(sel);
    if (!el) return fallback;
    try {
      return JSON.parse(el.textContent);
    } catch {
      return fallback;
    }
  }

  availableVariants() {
    const a = this.variants.filter((v) => v.available);
    return a.length ? a : this.variants;
  }

  // The "original" reference price is the real pre-discount price (Shopify's
  // compare-at price), not the live selling price — the merchant may already
  // have the product marked down, and tier savings should read against the
  // true original price rather than that already-discounted price.
  originalUnitPrice(v) {
    return v.compareAtPrice > v.price ? v.compareAtPrice : v.price;
  }

  defaultUnitPrice() {
    const a = this.availableVariants();
    return a.length ? this.originalUnitPrice(a[0]) : 0;
  }

  selectedIndex() {
    const r = this.radios.find((x) => x.checked) || this.radios[0];
    return Number(r.value) || 0;
  }

  tierMeta(el) {
    return {
      quantity: Math.max(1, Number(el.dataset.quantity) || 1),
      discountType: el.dataset.discountType,
      discountValue: Number(el.dataset.discountValue) || 0,
    };
  }

  selectTier() {
    const idx = this.selectedIndex();
    const tier = this.tierMeta(this.tierEls[idx]);
    const avail = this.availableVariants();
    // One variant for the whole tier — every unit is the same variant, so the
    // main product always collapses to a single cart line, however large the
    // tier quantity is.
    const defaultId = avail[0]?.id;
    this.selection = new Array(tier.quantity).fill(defaultId);
    this.tierEls.forEach((el, i) => {
      const sel = i === idx;
      el.classList.toggle('is-selected', sel);
      const body = el.querySelector('[data-bp-body]');
      if (!body) return;
      body.hidden = !sel;
      if (sel) this.renderBody(body, tier);
      else body.innerHTML = '';
    });
    this.renderSummaries();
  }

  renderBody(body, tier) {
    body.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'bp-vlabel';
    label.textContent = 'Variant';
    body.appendChild(label);

    // One picker per unit — each can be a different variant. The main
    // product still only ever adds as one cart line per distinct variant
    // chosen (onSubmit groups same-variant slots by quantity); when every
    // slot defaults to the same variant, that's a single line.
    for (let slot = 0; slot < tier.quantity; slot++) {
      const row = document.createElement('div');
      row.className = 'bp-vslot';

      const img = document.createElement('img');
      img.className = 'bp-vslot__img';

      const select = document.createElement('select');
      select.className = 'bp-vslot__select';
      this.variants.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.title;
        if (!v.available) opt.disabled = true;
        if (String(v.id) === String(this.selection[slot])) opt.selected = true;
        select.appendChild(opt);
      });

      const syncImg = () => {
        const v = this.variants.find(
          (x) => String(x.id) === String(this.selection[slot]),
        );
        if (v && v.image) {
          img.src = v.image;
          img.alt = v.title;
        } else {
          img.removeAttribute('src');
        }
      };
      syncImg();
      select.addEventListener('change', () => {
        this.selection[slot] = select.value;
        syncImg();
        this.renderSummaries();
      });

      row.appendChild(img);
      row.appendChild(select);
      body.appendChild(row);
    }

    if (this.addOns.length) {
      const wrap = document.createElement('div');
      wrap.className = 'bp-addons';
      this.addOns.forEach((a) => {
        const row = document.createElement('label');
        row.className = 'bp-addon';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'bp-addon__cb';
        if (a.available === false) {
          cb.disabled = true;
          this.addOnChecked.delete(String(a.id));
        }
        cb.checked = this.addOnChecked.has(String(a.id));
        cb.addEventListener('change', () => {
          if (cb.checked) this.addOnChecked.add(String(a.id));
          else this.addOnChecked.delete(String(a.id));
        });

        const img = document.createElement('img');
        img.className = 'bp-addon__img';
        if (a.image) {
          img.src = a.image;
          img.alt = a.title;
        }

        const name = document.createElement('span');
        name.className = 'bp-addon__name';
        name.textContent = a.title;

        const prices = document.createElement('span');
        prices.className = 'bp-addon__prices';
        const now = document.createElement('span');
        now.className = 'bp-addon__now';
        // The add-on discount is calculated off the live selling price (it
        // has to match what checkout actually charges); the struck-through
        // reference price is the true original (compare-at) price.
        const disc = applyDiscount(
          a.price,
          this.addOnDiscount.discountType,
          this.addOnDiscount.discountValue,
        );
        const original = this.originalUnitPrice(a);
        now.textContent = formatMoney(disc, this.dataset.currency);
        prices.appendChild(now);
        if (disc < original) {
          const was = document.createElement('s');
          was.className = 'bp-addon__was';
          was.textContent = formatMoney(original, this.dataset.currency);
          prices.appendChild(was);
        }

        row.appendChild(cb);
        row.appendChild(img);
        row.appendChild(name);
        row.appendChild(prices);
        wrap.appendChild(row);
      });
      body.appendChild(wrap);
    }
  }

  renderSummaries() {
    const selIdx = this.selectedIndex();
    this.tierEls.forEach((el, i) => {
      const tier = this.tierMeta(el);
      // liveTotal is what the tier discount is actually calculated off of
      // (matches the checkout math, which discounts the real selling
      // price). originalTotal is only the struck-through reference price —
      // the true pre-markdown price, shown so "you save" reflects the full
      // savings even when the product is already on sale in Shopify.
      let liveTotal;
      let originalTotal;
      if (i === selIdx) {
        liveTotal = this.selection.reduce((sum, id) => {
          const v = this.variants.find((x) => String(x.id) === String(id));
          return sum + (v ? v.price : 0);
        }, 0);
        originalTotal = this.selection.reduce((sum, id) => {
          const v = this.variants.find((x) => String(x.id) === String(id));
          return sum + (v ? this.originalUnitPrice(v) : 0);
        }, 0);
      } else {
        const defaultVariant = this.availableVariants()[0];
        liveTotal = (defaultVariant ? defaultVariant.price : 0) * tier.quantity;
        originalTotal = this.defaultUnitPrice() * tier.quantity;
      }
      const now = applyDiscount(liveTotal, tier.discountType, tier.discountValue);
      const was = originalTotal;
      const saved = Math.max(0, was - now);

      const nowEl = el.querySelector('[data-bp-now]');
      const wasEl = el.querySelector('[data-bp-was]');
      const subEl = el.querySelector('[data-bp-sub]');
      const pillEl = el.querySelector('[data-bp-savepill]');

      if (nowEl) nowEl.textContent = formatMoney(now, this.dataset.currency);
      if (wasEl) {
        const show = now < was;
        wasEl.textContent = show ? formatMoney(was, this.dataset.currency) : '';
        wasEl.style.display = show ? '' : 'none';
      }
      if (subEl) {
        if (saved > 0) {
          const pct = was > 0 ? Math.round((saved / was) * 100) : 0;
          subEl.textContent = `You save ${pct}%`;
        } else {
          subEl.textContent = 'Standard price';
        }
      }
      if (pillEl) {
        pillEl.textContent =
          saved > 0 ? `SAVE ${formatMoney(saved, this.dataset.currency)}` : '';
        pillEl.style.display = saved > 0 ? '' : 'none';
      }
    });
  }

  onSubmit() {
    const lines = [];

    // Combine main-product slots into one cart line per chosen variant (a
    // 3-unit tier where every slot is the same variant becomes a single line
    // of quantity 3, not three quantity-1 lines). Add-ons stay one line each.
    const mainQuantities = new Map();
    this.selection
      .filter((id) => id != null)
      .forEach((id) => mainQuantities.set(id, (mainQuantities.get(id) || 0) + 1));
    mainQuantities.forEach((quantity, id) => lines.push({ id, quantity, role: 'main' }));

    this.addOns
      .filter((a) => this.addOnChecked.has(String(a.id)))
      .forEach((a) => lines.push({ id: a.id, quantity: 1, role: 'addon' }));
    if (!lines.length) return;
    addBundleToCart({
      lines,
      bundleHandle: this.dataset.bundleHandle,
      bundleTitle: this.dataset.bundleTitle,
      cartAddUrl: this.dataset.cartAddUrl,
      cartUrl: this.dataset.cartUrl,
      submitBtn: this.submitBtn,
      errorEl: this.errorEl,
    });
  }
}

customElements.define('bundle-add-to-cart', BundleFixed);
customElements.define('bundle-mix-match', BundleMixMatch);
customElements.define('bundle-volume', BundleVolume);
customElements.define('bundle-multipack', BundleMultipack);
customElements.define('bundle-bogo', BundleBogo);
customElements.define('bundle-tiered', BundleTiered);
