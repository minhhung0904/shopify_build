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

// Tiered "Bundle & Save": choose a tier (1/2/3 units), then pick a variant per
// slot via swatches. Discount escalates by tier; all slot lines share the
// bundle grouping so the function applies the tier discount at checkout.
class BundleTiered extends HTMLElement {
  connectedCallback() {
    this.variants = this.parseVariants();
    this.slotsEl = this.querySelector('[data-bp-slots]');
    this.priceEl = this.querySelector('[data-bundle-price]');
    this.compareEl = this.querySelector('[data-bundle-compare]');
    this.submitBtn = this.querySelector('[data-bundle-submit]');
    this.errorEl = this.querySelector('[data-bundle-error]');
    this.radios = Array.from(this.querySelectorAll('.bp-tierrow__radio'));
    this.selection = [];
    if (!this.submitBtn || !this.radios.length || !this.variants.length) return;

    this.radios.forEach((r) =>
      r.addEventListener('change', () => this.onTierChange()),
    );
    this.submitBtn.addEventListener('click', () => this.onSubmit());

    const checked = this.radios.find((r) => r.checked) || this.radios[0];
    checked.checked = true;
    this.onTierChange();
  }

  parseVariants() {
    const script = this.querySelector('[data-bp-variants]');
    try {
      return JSON.parse(script.textContent);
    } catch {
      return [];
    }
  }

  availableVariants() {
    const avail = this.variants.filter((v) => v.available);
    return avail.length ? avail : this.variants;
  }

  currentTier() {
    const r = this.radios.find((x) => x.checked) || this.radios[0];
    return {
      quantity: Math.max(1, Number(r.dataset.quantity) || 1),
      discountType: r.dataset.discountType,
      discountValue: Number(r.dataset.discountValue) || 0,
    };
  }

  onTierChange() {
    this.radios.forEach((r) =>
      r
        .closest('.bp-tierrow')
        ?.classList.toggle('is-selected', r.checked),
    );
    const tier = this.currentTier();
    const avail = this.availableVariants();
    const next = [];
    for (let i = 0; i < tier.quantity; i++) {
      const prev = this.selection[i];
      const stillValid =
        prev != null &&
        this.variants.some(
          (v) => String(v.id) === String(prev) && v.available,
        );
      next.push(stillValid ? prev : avail[i % avail.length]?.id ?? avail[0]?.id);
    }
    this.selection = next;
    this.renderSlots(tier);
    this.render();
  }

  renderSlots(tier) {
    if (!this.slotsEl) return;
    this.slotsEl.innerHTML = '';
    for (let slot = 0; slot < tier.quantity; slot++) {
      const group = document.createElement('div');
      group.className = 'bp-slot';

      const label = document.createElement('span');
      label.className = 'bp-slot__label';
      label.textContent = tier.quantity > 1 ? `Item ${slot + 1}` : 'Choose your item';
      group.appendChild(label);

      const swatches = document.createElement('div');
      swatches.className = 'bp-swatches';
      this.variants.forEach((v) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bp-swatch';
        btn.title = v.title;
        if (!v.available) btn.disabled = true;
        if (String(this.selection[slot]) === String(v.id)) {
          btn.classList.add('is-selected');
        }
        if (v.image) {
          const img = document.createElement('img');
          img.src = v.image;
          img.alt = v.title;
          img.loading = 'lazy';
          btn.appendChild(img);
        } else {
          btn.textContent = v.title;
        }
        btn.addEventListener('click', () => {
          this.selection[slot] = v.id;
          this.renderSlots(this.currentTier());
          this.render();
        });
        swatches.appendChild(btn);
      });
      group.appendChild(swatches);
      this.slotsEl.appendChild(group);
    }
  }

  render() {
    const tier = this.currentTier();
    const base = this.selection.reduce((sum, id) => {
      const v = this.variants.find((x) => String(x.id) === String(id));
      return sum + (v ? v.price : 0);
    }, 0);
    const discounted = applyDiscount(base, tier.discountType, tier.discountValue);
    if (this.priceEl) {
      this.priceEl.textContent = formatMoney(discounted, this.dataset.currency);
    }
    if (this.compareEl) {
      const show = discounted < base;
      this.compareEl.textContent = show
        ? formatMoney(base, this.dataset.currency)
        : '';
      this.compareEl.style.display = show ? '' : 'none';
    }
  }

  onSubmit() {
    const lines = this.selection
      .filter((id) => id != null)
      .map((id) => ({ id, quantity: 1 }));
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
