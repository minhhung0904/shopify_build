function formatMoney(cents, currency) {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
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

  const items = lines.map(({ id, quantity }) => ({
    id,
    quantity: quantity || 1,
    properties: {
      _bundle_handle: bundleHandle,
      _bundle_instance: instanceId,
      ...(bundleTitle ? { _bundle: bundleTitle } : {}),
    },
  }));

  fetch(cartAddUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ items }),
  })
    .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) {
        const message = data.description || data.message || 'Could not add this bundle to your cart.';
        throw new Error(message);
      }
      window.location.href = cartUrl || '/cart';
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

customElements.define('bundle-add-to-cart', BundleFixed);
customElements.define('bundle-mix-match', BundleMixMatch);
customElements.define('bundle-volume', BundleVolume);
