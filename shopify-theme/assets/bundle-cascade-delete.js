/**
 * A Tiered bundle's add-ons can be removed from the cart individually, but
 * removing the main product line has to take its add-ons with it — leaving
 * them behind would charge for add-ons whose bundle no longer exists.
 *
 * Cart lines carry a shared `_bundle_instance` property (set by
 * bundle-picker.js at add-to-cart time) and the main line additionally
 * carries `_bundle_role=main`. Both are mirrored onto each cart-item <tr> as
 * data attributes by main-cart-items.liquid / cart-drawer.liquid.
 */
(function () {
  if (window.__bundleCascadeDeleteInit) return;
  window.__bundleCascadeDeleteInit = true;

  function lineKeyOf(row) {
    return row?.querySelector('[data-quantity-line-key]')?.dataset.quantityLineKey;
  }

  function indexOf(row) {
    return row?.id.match(/-(\d+)$/)?.[1];
  }

  document.addEventListener(
    'click',
    function (event) {
      const removeBtn = event.target.closest('cart-remove-button');
      if (!removeBtn) return;

      const row = removeBtn.closest('.cart-item');
      const instance = row?.dataset.bundleInstance;
      if (!row || !instance || row.dataset.bundleRole !== 'main') return;

      const scope = row.closest('tbody') || document;
      const addOnRows = Array.from(scope.querySelectorAll('.cart-item')).filter(
        (candidate) => candidate !== row && candidate.dataset.bundleInstance === instance,
      );
      if (!addOnRows.length) return; // no add-ons to cascade — default remove flow is fine

      // Take over the whole removal: the default CartRemoveButton handler
      // only knows how to remove its own line by position, and firing it
      // concurrently with our add-on removals risks the two racing over
      // shifting line positions. Removing every line by its stable key in
      // one batch avoids that.
      event.preventDefault();
      event.stopImmediatePropagation();

      const cartItems = removeBtn.closest('cart-items') || removeBtn.closest('cart-drawer-items');
      if (!cartItems) return;

      const rows = [row, ...addOnRows];
      const keys = rows.map(lineKeyOf).filter(Boolean);
      const mainIndex = indexOf(row);

      if (mainIndex) cartItems.enableLoading(mainIndex);

      // One at a time, not Promise.all: concurrent /cart/change.js calls
      // against the same cart session can race each other server-side (one
      // can 400 because another write landed first). Awaiting each in turn
      // keeps every removal reliable at the cost of a few hundred ms.
      keys
        .reduce(
          (chain, id) =>
            chain.then(() =>
              fetch(window.routes.cart_change_url, {
                ...fetchConfig(),
                body: JSON.stringify({ id, quantity: 0 }),
              }),
            ),
          Promise.resolve(),
        )
        .then(() => cartItems.onCartUpdate())
        .catch(() => window.location.reload())
        .finally(() => {
          if (mainIndex) cartItems.disableLoading(mainIndex);
        });
    },
    true,
  );
})();
