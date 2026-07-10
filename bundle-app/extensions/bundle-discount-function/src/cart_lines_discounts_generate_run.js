import { DiscountClass, ProductDiscountSelectionStrategy } from '../generated/api';

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

const EMPTY_RESULT = { operations: [] };

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  if (!input.cart.lines.length) return EMPTY_RESULT;

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );
  if (!hasProductDiscountClass) return EMPTY_RESULT;

  const bundleIndex = parseBundleIndex(input.shop.bundleIndex?.jsonValue);
  if (!bundleIndex) return EMPTY_RESULT;

  // A group can yield more than one candidate (e.g. a tiered bundle discounts
  // its main lines and its add-on lines at different rates), so flatten.
  const candidates = groupCartLines(input.cart.lines).flatMap(
    ({ handle, lines }) => {
      const result = buildCandidate(bundleIndex[handle], lines);
      if (!result) return [];
      return Array.isArray(result) ? result : [result];
    },
  );

  if (!candidates.length) return EMPTY_RESULT;

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}

function parseBundleIndex(jsonValue) {
  if (!jsonValue || typeof jsonValue !== 'object') return null;
  return jsonValue;
}

// The storefront only ever sends a bundle handle + a random per-submission
// grouping id as cart line attributes — never a discount value. Lines that
// share a `_bundle_instance` were added together as one bundle purchase.
function groupCartLines(lines) {
  const groups = new Map();
  for (const line of lines) {
    const handle = line.bundleHandle?.value;
    if (!handle) continue;
    const instance = line.bundleInstance?.value || line.id;
    const key = `${handle}::${instance}`;
    if (!groups.has(key)) groups.set(key, { handle, lines: [] });
    groups.get(key).lines.push(line);
  }
  return Array.from(groups.values());
}

function buildCandidate(bundle, lines) {
  if (!bundle || !isValidGroup(bundle, lines)) return null;

  if (bundle.type === 'volume') {
    const line = lines[0];
    const tier = pickVolumeTier(bundle.volumeTiers, line.quantity);
    if (!tier) return null;
    return discountCandidate([line], tier.discountType, tier.value);
  }

  // Tiered "Bundle & Save": the main product (any variant) is discounted by the
  // tier matching its total units; optional add-on products in the same group
  // are discounted at their own rate. Returns up to two candidates.
  if (bundle.type === 'tiered') {
    const addOnSet = new Set(bundle.addOnProductIds || []);
    const mainLines = lines.filter(
      (line) => line.merchandise?.product?.id === bundle.productId,
    );
    const addOnLines = lines.filter((line) =>
      addOnSet.has(line.merchandise?.product?.id),
    );
    const mainUnits = mainLines.reduce((sum, line) => sum + line.quantity, 0);
    const tier = pickTieredTier(bundle.tiers, mainUnits);

    const candidates = [];
    if (tier) {
      const main = discountCandidate(
        mainLines,
        tier.discountType,
        tier.discountValue,
      );
      if (main) candidates.push(main);
    }
    if (addOnLines.length) {
      const addOn = discountCandidate(
        addOnLines,
        bundle.addOnDiscountType,
        bundle.addOnDiscountValue,
      );
      if (addOn) candidates.push(addOn);
    }
    return candidates.length ? candidates : null;
  }

  // BOGO discounts only the "get" lines; the "buy" lines stay full price.
  if (bundle.type === 'bogo') {
    const getSet = new Set(bundle.getProductIds || []);
    const getLines = lines.filter((line) =>
      getSet.has(line.merchandise?.product?.id),
    );
    if (!getLines.length) return null;
    return discountCandidate(
      getLines,
      bundle.rewardDiscountType,
      bundle.rewardDiscountValue,
    );
  }

  // fixed / variant / multipack / mix_match / infinite all share the same
  // group-discount path (percentage, amount off, or a fixed target price).
  if (bundle.discountType === 'fixed_price') {
    const amount = fixedPriceDiscountAmount(lines, bundle.discountValue);
    if (amount <= 0) return null;
    return discountCandidate(lines, 'fixed_amount', amount);
  }

  return discountCandidate(lines, bundle.discountType, bundle.discountValue);
}

// Re-checks that the products actually in the cart match what the bundle was
// configured with. A shopper editing `_bundle_handle` in devtools to claim a
// cheaper bundle only works if their cart happens to already satisfy that
// bundle's real product requirements — otherwise no discount is applied.
function isValidGroup(bundle, lines) {
  const productIds = lines.map((line) => line.merchandise?.product?.id);

  // BOGO validates against two separate sets, so it's handled on its own.
  if (bundle.type === 'bogo') {
    return isValidBogo(bundle, lines);
  }

  // Variant bundle: several variants of ONE configured product, counted by
  // the number of cart lines (each variant is its own line).
  if (bundle.type === 'variant') {
    if (productIds.some((id) => !id || id !== bundle.productId)) return false;
    const count = lines.length;
    const min = Number(bundle.minItems) || 1;
    const max = Number(bundle.maxItems) || count;
    return count >= min && count <= max;
  }

  // Tiered: every line must be the main product (any variant) or a configured
  // add-on, and the MAIN units must reach at least the smallest tier.
  if (bundle.type === 'tiered') {
    const addOnSet = new Set(bundle.addOnProductIds || []);
    if (
      productIds.some(
        (id) => !id || (id !== bundle.productId && !addOnSet.has(id)),
      )
    ) {
      return false;
    }
    const mainUnits = lines
      .filter((line) => line.merchandise?.product?.id === bundle.productId)
      .reduce((sum, line) => sum + line.quantity, 0);
    const tiers = bundle.tiers || [];
    if (!tiers.length) return false;
    const smallest = Math.min(...tiers.map((t) => Number(t.quantity) || 1));
    return mainUnits >= smallest;
  }

  // Multipack: a single line of one configured product, quantity ≥ pack size.
  if (bundle.type === 'multipack') {
    if (lines.length !== 1) return false;
    const line = lines[0];
    if (line.merchandise?.product?.id !== bundle.productId) return false;
    return line.quantity >= (Number(bundle.packSize) || 1);
  }

  const configured = new Set(bundle.productIds || []);
  if (productIds.some((id) => !id || !configured.has(id))) return false;

  if (bundle.type === 'fixed') {
    return productIds.length === configured.size;
  }
  if (bundle.type === 'mix_match') {
    const min = Number(bundle.minItems) || 1;
    const max = Number(bundle.maxItems) || productIds.length;
    return productIds.length >= min && productIds.length <= max;
  }
  if (bundle.type === 'infinite') {
    const min = Number(bundle.minItems) || 1;
    return productIds.length >= min;
  }
  if (bundle.type === 'volume') {
    return productIds.length === 1;
  }
  return false;
}

// Re-checks a BOGO group: every line must belong to the buy or get set, and
// both the buy and get quantity thresholds must be met. A "get" product is
// counted toward the get total even if it also appears in the buy set.
function isValidBogo(bundle, lines) {
  const buySet = new Set(bundle.buyProductIds || []);
  const getSet = new Set(bundle.getProductIds || []);
  let buyQty = 0;
  let getQty = 0;
  for (const line of lines) {
    const id = line.merchandise?.product?.id;
    if (!id) return false;
    if (getSet.has(id)) {
      getQty += line.quantity;
    } else if (buySet.has(id)) {
      buyQty += line.quantity;
    } else {
      return false;
    }
  }
  return (
    buyQty >= (Number(bundle.buyQuantity) || 1) &&
    getQty >= (Number(bundle.getQuantity) || 1)
  );
}

function pickVolumeTier(tiers, quantity) {
  return (tiers || [])
    .filter((tier) => quantity >= Number(tier.minQuantity))
    .sort((a, b) => Number(b.minQuantity) - Number(a.minQuantity))[0];
}

// Highest tier whose unit threshold the cart meets — "buy more, save more".
function pickTieredTier(tiers, totalQuantity) {
  return (tiers || [])
    .filter((tier) => totalQuantity >= Number(tier.quantity))
    .sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
}

function fixedPriceDiscountAmount(lines, targetPrice) {
  const total = lines.reduce(
    (sum, line) => sum + Number(line.cost.subtotalAmount.amount),
    0,
  );
  return Math.max(0, total - Number(targetPrice));
}

function discountCandidate(lines, discountType, value) {
  const numericValue = Number(value) || 0;
  if (numericValue <= 0) return null;

  const targets = lines.map((line) => ({ cartLine: { id: line.id } }));

  if (discountType === 'percentage') {
    return {
      message: 'Bundle discount',
      targets,
      value: { percentage: { value: Math.min(numericValue, 100) } },
    };
  }

  return {
    message: 'Bundle discount',
    targets,
    value: {
      fixedAmount: { amount: numericValue, appliesToEachItem: false },
    },
  };
}
