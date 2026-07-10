/**
  * @typedef {import("../generated/api").CartDeliveryOptionsDiscountsGenerateRunResult} CartDeliveryOptionsDiscountsGenerateRunResult
  */

// Bundles only ever discount products, never shipping — this target exists
// because the "discount" function type bundles both, but it's a deliberate
// no-op here.
/**
  * @returns {CartDeliveryOptionsDiscountsGenerateRunResult}
  */
export function cartDeliveryOptionsDiscountsGenerateRun() {
  return { operations: [] };
}