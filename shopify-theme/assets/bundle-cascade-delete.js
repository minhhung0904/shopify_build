/**
 * A Tiered bundle's add-ons can be removed from the cart individually, but
 * removing the main product line has to take its add-ons with it — leaving
 * them behind would charge for add-ons whose bundle no longer exists. A combo
 * bundle's package can also span several DIFFERENT main-product lines, all of
 * which must go together too.
 *
 * Cart lines carry a shared `_bundle_instance` property (set by
 * bundle-picker.js at add-to-cart time) and main lines additionally carry
 * `_bundle_role=main`. Both are mirrored onto each cart-item <tr> as data
 * attributes by main-cart-items.liquid / cart-drawer.liquid.
 */
(function () {
  if (window.__bundleCascadeDeleteInit) return;
  window.__bundleCascadeDeleteInit = true;

  function indexOf(row) {
    return row?.id.match(/-(\d+)$/)?.[1];
  }

  // Inner HTML of a rendered section, matching Dawn's global helper when it's
  // present and falling back to a local parse otherwise.
  function sectionInnerHTML(html, selector) {
    if (typeof getSectionInnerHTML === 'function') {
      return getSectionInnerHTML(html, selector);
    }
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const el = parsed.querySelector(selector);
    return el ? el.innerHTML : html;
  }

  function applyRenderedSections(cartItems, sections, parsed) {
    if (!parsed || !parsed.sections) {
      // Fallback: at least refresh the visible item list.
      if (typeof cartItems.onCartUpdate === 'function') cartItems.onCartUpdate();
      return;
    }

    // Mirror Dawn's updateQuantity: toggle the empty state on the cart
    // wrappers and swap in every re-rendered section (item list, footer,
    // header count bubble, live region).
    const isEmpty = parsed.item_count === 0;
    [
      cartItems,
      document.getElementById('main-cart-footer'),
      document.querySelector('cart-drawer'),
    ].forEach((el) => el && el.classList.toggle('is-empty', isEmpty));

    sections.forEach((section) => {
      const container = document.getElementById(section.id);
      if (!container || parsed.sections[section.section] == null) return;
      const target = container.querySelector(section.selector) || container;
      target.innerHTML = sectionInnerHTML(parsed.sections[section.section], section.selector);
    });
  }

  // Removes every cart line sharing `instance`, then re-checks the live cart
  // and retries any stragglers. This verify-and-retry loop (rather than
  // firing the removal calls once and trusting them) is deliberate: fetch()
  // only rejects on a network failure, not on a non-2xx response, so a single
  // /cart/change.js call in the batch can be rejected server-side without
  // ever surfacing as a caught error — silently leaving that one line behind
  // while the rest of the batch looks like it succeeded. Re-reading /cart.js
  // after each pass catches that instead of trusting the fetch resolved.
  function cascadeRemove(instance, cartItems, attemptsLeft) {
    attemptsLeft = attemptsLeft == null ? 3 : attemptsLeft;

    return fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then((response) => response.json())
      .then((cart) => {
        const keys = (cart.items || [])
          .filter(
            (item) => item.properties && item.properties['_bundle_instance'] === instance,
          )
          .map((item) => item.key);
        if (!keys.length) return; // fully clean — nothing left to do

        const sections =
          typeof cartItems.getSectionsToRender === 'function'
            ? cartItems.getSectionsToRender()
            : [];

        // One at a time, not Promise.all: concurrent /cart/change.js calls
        // against the same cart session can race each other server-side (one
        // can fail because another write landed first). Awaiting each in
        // turn keeps every removal as reliable as a single request can be —
        // the outer retry loop is what catches the rest.
        return keys
          .reduce(
            (chain, id, i) =>
              chain.then(() => {
                const body = { id, quantity: 0 };
                if (i === keys.length - 1 && sections.length) {
                  body.sections = sections.map((section) => section.section);
                  body.sections_url = window.location.pathname;
                }
                return fetch(window.routes.cart_change_url, {
                  ...fetchConfig(),
                  body: JSON.stringify(body),
                }).then((response) => response.text());
              }),
            Promise.resolve(),
          )
          .then((lastState) => {
            let parsed = null;
            try {
              parsed = JSON.parse(lastState);
            } catch (error) {
              parsed = null;
            }
            applyRenderedSections(cartItems, sections, parsed);

            if (attemptsLeft > 1) {
              return cascadeRemove(instance, cartItems, attemptsLeft - 1);
            }
          });
      });
  }

  document.addEventListener(
    'click',
    function (event) {
      const removeBtn = event.target.closest('cart-remove-button');
      if (!removeBtn) return;

      const row = removeBtn.closest('.cart-item');
      const instance = row?.dataset.bundleInstance;
      if (!row || !instance || row.dataset.bundleRole !== 'main') return;

      // Take over the whole removal: the default CartRemoveButton handler
      // only knows how to remove its own line by position, and firing it
      // concurrently with our own removals risks the two racing over
      // shifting line positions.
      event.preventDefault();
      event.stopImmediatePropagation();

      const cartItems = removeBtn.closest('cart-items') || removeBtn.closest('cart-drawer-items');
      if (!cartItems) return;

      const mainIndex = indexOf(row);
      if (mainIndex) cartItems.enableLoading(mainIndex);

      cascadeRemove(instance, cartItems)
        .catch(() => window.location.reload())
        .finally(() => {
          if (mainIndex) cartItems.disableLoading(mainIndex);
        });
    },
    true,
  );
})();
