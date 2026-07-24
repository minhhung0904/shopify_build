if (!customElements.get('product-description')) {
  customElements.define(
    'product-description',
    class ProductDescription extends HTMLElement {
      constructor() {
        super();
        this.content = this.querySelector('.product__description');
        this.toggle = this.querySelector('.product__description-toggle');
        if (!this.content || !this.toggle) return;

        this.toggle.addEventListener('click', this.onToggle.bind(this));
        requestAnimationFrame(this.updateVisibility.bind(this));
        window.addEventListener('resize', this.updateVisibility.bind(this));
      }

      updateVisibility() {
        if (this.content.classList.contains('product__description--clamped')) {
          const isClamped = this.content.scrollHeight > this.content.clientHeight + 1;
          this.toggle.hidden = !isClamped;
        }
      }

      onToggle() {
        this.content.classList.toggle('product__description--clamped');
        const isExpanded = !this.content.classList.contains('product__description--clamped');
        this.toggle.querySelectorAll('span').forEach((label) => label.classList.toggle('hidden'));
        this.toggle.setAttribute('aria-expanded', isExpanded);
      }
    }
  );
}
