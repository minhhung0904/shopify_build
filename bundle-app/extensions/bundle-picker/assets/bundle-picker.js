class BundleAddToCart extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('[data-bundle-form]');
    if (!this.form) return;
    this.form.addEventListener('submit', this.onSubmit.bind(this));
  }

  onSubmit(event) {
    event.preventDefault();

    const errorEl = this.querySelector('[data-bundle-error]');
    const submitBtn = this.form.querySelector('button[type="submit"]');
    const variantIds = (this.form.dataset.variantIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const bundleTitle = this.form.dataset.bundleTitle || '';
    const cartAddUrl = this.form.dataset.cartAddUrl;
    const cartUrl = this.form.dataset.cartUrl;

    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.remove('is-visible');
    }

    if (!variantIds.length || !cartAddUrl) return;

    submitBtn.setAttribute('disabled', 'disabled');

    const items = variantIds.map((id) => ({
      id,
      quantity: 1,
      properties: bundleTitle ? { _bundle: bundleTitle } : {},
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
}

customElements.define('bundle-add-to-cart', BundleAddToCart);
