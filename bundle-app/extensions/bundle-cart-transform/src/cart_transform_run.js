// @ts-check
/**
 * @typedef {import("../generated/api").CartTransformRunInput} RunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/** @type {CartTransformRunResult} */
const NO_CHANGES = { operations: [] };

/**
 * Merges a bundle's component cart lines (everything sharing one
 * `_bundle_instance`) into a SINGLE cart line, priced at the bundle's
 * discounted total, so a bundle reads as one item.
 *
 * Why the price is computed HERE and not left to the discount function:
 * Shopify runs functions in the order Cart Transform -> Discounts -> Validation.
 * Once this function merges the component lines, the discount function can no
 * longer see them (the merged line carries the container variant, not the
 * `_bundle_*` attributes), so it applies nothing to a merged bundle. We
 * therefore replicate the bundle's discount math and express the savings as a
 * `percentageDecrease` on the merged line. `linesMerge`'s price is relative to
 * the sum of the component prices, and a percentage is currency-agnostic, so no
 * presentment-currency conversion is needed. Bundles WITHOUT a container
 * variant configured are left un-merged and keep being handled by the discount
 * function as before.
 *
 * @param {RunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const bundleIndex = input.shop?.bundleIndex?.jsonValue;
  if (!bundleIndex || typeof bundleIndex !== "object") return NO_CHANGES;

  const lines = input.cart?.lines ?? [];
  if (!lines.length) return NO_CHANGES;

  // Group by bundle handle + the per-add-to-cart instance id, so two separate
  // purchases of the same bundle stay two merged lines.
  const groups = new Map();
  for (const line of lines) {
    const handle = line.bundleHandle?.value;
    const instance = line.bundleInstance?.value;
    if (!handle || !instance) continue;
    const key = `${handle}::${instance}`;
    let group = groups.get(key);
    if (!group) {
      group = { handle, title: line.bundleTitle?.value, lines: [] };
      groups.set(key, group);
    }
    group.lines.push(line);
  }

  const operations = [];
  for (const group of groups.values()) {
    // A single-line group is already one item — nothing to merge.
    if (group.lines.length < 2) continue;

    const entry = bundleIndex[group.handle];
    const parentVariantId = entry && entry.parentVariantId;
    if (!parentVariantId) continue;

    // Re-validate the cart against the bundle config so a tampered
    // `_bundle_handle` can't merge/discount an arbitrary set of products.
    if (!isValidGroup(entry, group.lines)) continue;

    const summed = sumSubtotal(group.lines);
    if (summed <= 0) continue;
    const discounted = discountedTotal(entry, group.lines);
    const pct = clampPct((1 - discounted / summed) * 100);

    /** @type {any} */
    const linesMerge = {
      parentVariantId,
      cartLines: group.lines.map((line) => ({
        cartLineId: line.id,
        quantity: line.quantity,
      })),
    };
    if (group.title) linesMerge.title = group.title;
    if (pct > 0) {
      linesMerge.price = { percentageDecrease: { value: Number(pct.toFixed(4)) } };
    }

    operations.push({ linesMerge });
  }

  return operations.length ? { operations } : NO_CHANGES;
}

function lineSubtotal(line) {
  return parseFloat(line.cost?.subtotalAmount?.amount ?? "0") || 0;
}

function sumSubtotal(lines) {
  return lines.reduce((sum, line) => sum + lineSubtotal(line), 0);
}

function productId(line) {
  const m = line.merchandise;
  return m && m.__typename === "ProductVariant" ? m.product?.id : undefined;
}

function clampPct(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

// Currency-space discount (base is a float in presentment currency).
// fixed_price = an absolute target total for these units (e.g. a tier priced
// at $50); capped at `base` since a merge can only reduce, never raise, the
// summed component price.
function applyDiscount(base, discountType, value) {
  const v = Number(value) || 0;
  if (discountType === "percentage") return Math.max(0, base * (1 - v / 100));
  if (discountType === "fixed_amount") return Math.max(0, base - v);
  if (discountType === "fixed_price") return Math.max(0, Math.min(base, v));
  return base;
}

// The intended discounted total for the group — mirrors the pricing logic of
// bundle-discount-function/src/cart_lines_discounts_generate_run.js.
function discountedTotal(entry, lines) {
  if (entry.type === "volume") {
    const tier = pickVolumeTier(entry.volumeTiers, lines[0]?.quantity || 0);
    const base = sumSubtotal(lines);
    return tier ? applyDiscount(base, tier.discountType, tier.value) : base;
  }

  if (entry.type === "tiered") {
    const addOnSet = new Set(entry.addOnProductIds || []);
    const mainLines = lines.filter((l) => productId(l) === entry.productId);
    const addOnLines = lines.filter((l) => addOnSet.has(productId(l)));
    const mainUnits = mainLines.reduce((s, l) => s + l.quantity, 0);
    const tier = pickTieredTier(entry.tiers, mainUnits);
    const sMain = sumSubtotal(mainLines);
    const sAdd = sumSubtotal(addOnLines);
    const dMain = tier
      ? applyDiscount(sMain, tier.discountType, tier.discountValue)
      : sMain;
    const dAdd = applyDiscount(
      sAdd,
      entry.addOnDiscountType,
      entry.addOnDiscountValue,
    );
    return dMain + dAdd;
  }

  if (entry.type === "bogo") {
    const getSet = new Set(entry.getProductIds || []);
    let sGet = 0;
    let sBuy = 0;
    for (const line of lines) {
      if (getSet.has(productId(line))) sGet += lineSubtotal(line);
      else sBuy += lineSubtotal(line);
    }
    return sBuy + applyDiscount(sGet, entry.rewardDiscountType, entry.rewardDiscountValue);
  }

  // fixed / variant / multipack / mix_match / infinite
  const base = sumSubtotal(lines);
  if (entry.discountType === "fixed_price") {
    return Math.min(base, Math.max(0, Number(entry.discountValue) || 0));
  }
  return applyDiscount(base, entry.discountType, entry.discountValue);
}

function pickVolumeTier(tiers, quantity) {
  return (tiers || [])
    .filter((tier) => quantity >= Number(tier.minQuantity))
    .sort((a, b) => Number(b.minQuantity) - Number(a.minQuantity))[0];
}

function pickTieredTier(tiers, totalQuantity) {
  return (tiers || [])
    .filter((tier) => totalQuantity >= Number(tier.quantity))
    .sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
}

// Mirrors isValidGroup in the discount function so the merge only applies to a
// cart that genuinely satisfies the bundle's product requirements.
function isValidGroup(entry, lines) {
  const productIds = lines.map((line) => productId(line));

  if (entry.type === "bogo") {
    const buySet = new Set(entry.buyProductIds || []);
    const getSet = new Set(entry.getProductIds || []);
    let buyQty = 0;
    let getQty = 0;
    for (const line of lines) {
      const id = productId(line);
      if (!id) return false;
      if (getSet.has(id)) getQty += line.quantity;
      else if (buySet.has(id)) buyQty += line.quantity;
      else return false;
    }
    return (
      buyQty >= (Number(entry.buyQuantity) || 1) &&
      getQty >= (Number(entry.getQuantity) || 1)
    );
  }

  if (entry.type === "variant") {
    if (productIds.some((id) => !id || id !== entry.productId)) return false;
    const count = lines.length;
    const min = Number(entry.minItems) || 1;
    const max = Number(entry.maxItems) || count;
    return count >= min && count <= max;
  }

  if (entry.type === "tiered") {
    const addOnSet = new Set(entry.addOnProductIds || []);
    if (productIds.some((id) => !id || (id !== entry.productId && !addOnSet.has(id)))) {
      return false;
    }
    const mainUnits = lines
      .filter((line) => productId(line) === entry.productId)
      .reduce((sum, line) => sum + line.quantity, 0);
    const tiers = entry.tiers || [];
    if (!tiers.length) return false;
    const smallest = Math.min(...tiers.map((t) => Number(t.quantity) || 1));
    return mainUnits >= smallest;
  }

  if (entry.type === "multipack") {
    if (lines.length !== 1) return false;
    const line = lines[0];
    if (productId(line) !== entry.productId) return false;
    return line.quantity >= (Number(entry.packSize) || 1);
  }

  const configured = new Set(entry.productIds || []);
  if (productIds.some((id) => !id || !configured.has(id))) return false;

  if (entry.type === "fixed") return productIds.length === configured.size;
  if (entry.type === "mix_match") {
    const min = Number(entry.minItems) || 1;
    const max = Number(entry.maxItems) || productIds.length;
    return productIds.length >= min && productIds.length <= max;
  }
  if (entry.type === "infinite") {
    return productIds.length >= (Number(entry.minItems) || 1);
  }
  if (entry.type === "volume") return productIds.length === 1;
  return false;
}
