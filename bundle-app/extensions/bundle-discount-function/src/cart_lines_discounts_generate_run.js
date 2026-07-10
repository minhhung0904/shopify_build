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

  const candidates = groupCartLines(input.cart.lines)
    .map(({ handle, lines }) => buildCandidate(bundleIndex[handle], lines))
    .filter(Boolean);

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
  const configured = new Set(bundle.productIds || []);
  const productIds = lines.map((line) => line.merchandise?.product?.id);
  if (productIds.some((id) => !id || !configured.has(id))) return false;

  if (bundle.type === 'fixed') {
    return productIds.length === configured.size;
  }
  if (bundle.type === 'mix_match') {
    const min = Number(bundle.minItems) || 1;
    const max = Number(bundle.maxItems) || productIds.length;
    return productIds.length >= min && productIds.length <= max;
  }
  if (bundle.type === 'volume') {
    return productIds.length === 1;
  }
  return false;
}

function pickVolumeTier(tiers, quantity) {
  return (tiers || [])
    .filter((tier) => quantity >= Number(tier.minQuantity))
    .sort((a, b) => Number(b.minQuantity) - Number(a.minQuantity))[0];
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
