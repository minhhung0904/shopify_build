import { useMemo, useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { activateBundleCartTransform } from "../discounts.server";

// Single source of truth for the bundle types the app supports. Each entry
// declares which form sections it needs so the UI, the index sync, and the
// discount function all agree on the same set. Adding a future type is a
// matter of appending here + handling its `value` in the three switch points
// (buildIndexEntry, the form sections below, and the discount function).
const BUNDLE_TYPES = [
  {
    value: "fixed",
    label: "Fixed bundle",
    tagline: "A set of products always sold together",
    description:
      "Pick several products that are bundled and discounted as one offer.",
  },
  {
    value: "variant",
    label: "Variant bundle",
    tagline: "Pick several variants of one product",
    description:
      "Let shoppers choose a number of variants (colors, sizes) of a single product.",
  },
  {
    value: "multipack",
    label: "Multipack",
    tagline: "A fixed pack of one product",
    description:
      "Sell a pack of N units of one product/variant at a bundled pack price.",
  },
  {
    value: "mix_match",
    label: "Mix & match",
    tagline: "Shoppers build their own set",
    description:
      "Shoppers pick a set number of items from a pool of eligible products.",
  },
  {
    value: "infinite",
    label: "Infinite options",
    tagline: "Mix & match with no upper limit",
    description:
      "Like mix & match, but shoppers can add as many items as they like.",
  },
  {
    value: "volume",
    label: "Volume discount",
    tagline: "Buy more, save more",
    description:
      "Quantity-break tiers on a single product — bigger discount at higher counts.",
  },
  {
    value: "tiered",
    label: "Tiered bundle (Bundle & Save)",
    tagline: "Pick a tier, mix variants, save more",
    description:
      "Offer 1/2/3-unit tiers of one product with escalating discounts. Each unit can be a different variant.",
  },
  {
    value: "bogo",
    label: "BOGO",
    tagline: "Buy X, get Y",
    description:
      "Buy products from one set and get products from another free or discounted.",
  },
];

const DISCOUNT_TYPES = [
  { value: "percentage", label: "Percentage off" },
  { value: "fixed_amount", label: "Amount off" },
  { value: "fixed_price", label: "Fixed bundle price" },
];

const REWARD_DISCOUNT_TYPES = [
  { value: "percentage", label: "Percentage off" },
  { value: "fixed_amount", label: "Amount off" },
];

// --- Per-type capability helpers (shared by the form + validation) ---
const usesDiscount = (type) =>
  ["fixed", "variant", "multipack", "mix_match", "infinite"].includes(type);
const usesMinMax = (type) => ["mix_match", "variant"].includes(type);
const usesMinOnly = (type) => type === "infinite";
const usesSingleProduct = (type) =>
  ["volume", "multipack", "variant", "tiered"].includes(type);

const emptyForm = {
  handle: "",
  title: "",
  badgeText: "Save 15%",
  price: "",
  description: "",
  bundleType: "fixed",
  discountType: "percentage",
  discountValue: "10",
  minItems: "1",
  maxItems: "2",
  status: "active",
  sortOrder: "0",
  accentColor: "#FFCB05",
  // Cart Transform "container" variant: the parent line a merged bundle folds
  // into. Null = the bundle is NOT merged into one cart line.
  containerVariant: null,
  selectedProducts: [],
  volumeTiers: [{ minQuantity: "2", discountType: "percentage", value: "10" }],
  // multipack
  packSize: "3",
  // bogo
  buyQuantity: "1",
  getQuantity: "1",
  rewardDiscountType: "percentage",
  rewardDiscountValue: "100",
  rewardProducts: [],
  // tiered (Bundle & Save): each tier = N units of the product at a discount
  tieredTiers: [
    { title: "Single", quantity: "1", discountType: "percentage", value: "0", mostPopular: false },
    { title: "Double", quantity: "2", discountType: "percentage", value: "10", mostPopular: true },
    { title: "Triple", quantity: "3", discountType: "percentage", value: "15", mostPopular: false },
  ],
};

const BUNDLE_FIELDS = `#graphql
  fragment BundleFields on Metaobject {
    id
    handle
    title: field(key: "title") { value }
    badgeText: field(key: "badge_text") { value }
    price: field(key: "price") { value }
    description: field(key: "description") { value }
    bundleType: field(key: "bundle_type") { value }
    discountType: field(key: "discount_type") { value }
    discountValue: field(key: "discount_value") { value }
    volumeTiers: field(key: "volume_tiers") { value }
    minItems: field(key: "min_items") { value }
    maxItems: field(key: "max_items") { value }
    status: field(key: "status") { value }
    sortOrder: field(key: "sort_order") { value }
    config: field(key: "config") { value }
    products: field(key: "products") {
      references(first: 20) {
        nodes { ... on Product { id title handle } }
      }
    }
    rewardProducts: field(key: "reward_products") {
      references(first: 20) {
        nodes { ... on Product { id title handle } }
      }
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Self-heal activation for already-installed shops (afterAuth only runs on
  // install/re-auth). Idempotent and non-throwing.
  await activateBundleCartTransform(admin);

  const response = await admin.graphql(
    `#graphql
      query ListBundles {
        metaobjects(type: "$app:bundle", first: 50, sortKey: "updated_at", reverse: true) {
          nodes { ...BundleFields }
        }
      }
      ${BUNDLE_FIELDS}`,
  );
  const json = await response.json();
  const bundles = json.data.metaobjects.nodes.slice().sort((a, b) => {
    const sortA = Number(a.sortOrder?.value || 0);
    const sortB = Number(b.sortOrder?.value || 0);
    if (sortA !== sortB) return sortA - sortB;
    return (a.title?.value || "").localeCompare(b.title?.value || "");
  });
  return { bundles };
};

// Reduces one metaobject node down to the minimal, storefront-tamper-proof
// config the discount function needs. Mirrors the type list in BUNDLE_TYPES.
function buildIndexEntry(node) {
  const productIds = (node.products?.references?.nodes || []).map((p) => p.id);
  const rewardIds = (node.rewardProducts?.references?.nodes || []).map(
    (p) => p.id,
  );
  const type = node.bundleType?.value;
  let config = {};
  try {
    config = JSON.parse(node.config?.value || "{}");
  } catch {
    config = {};
  }

  // The "container" variant a Cart Transform merge uses as the parent line for
  // this bundle (see bundle-cart-transform). Undefined = bundle isn't merged.
  const parentVariantId = config.parentVariantId || undefined;

  if (type === "volume") {
    let volumeTiers = [];
    try {
      volumeTiers = JSON.parse(node.volumeTiers?.value || "[]");
    } catch {
      volumeTiers = [];
    }
    return { type, productId: productIds[0], productIds, volumeTiers, parentVariantId };
  }

  if (type === "tiered") {
    const tiers = (config.tiers || []).map((t) => ({
      quantity: Number(t.quantity) || 1,
      discountType: t.discountType || "percentage",
      discountValue: Number(t.discountValue) || 0,
    }));
    return {
      type,
      productId: productIds[0],
      productIds,
      tiers,
      addOnProductIds: rewardIds,
      addOnDiscountType: config.addOnDiscountType || "percentage",
      addOnDiscountValue: Number(config.addOnDiscountValue || 0),
      parentVariantId,
    };
  }

  if (type === "bogo") {
    return {
      type,
      buyProductIds: productIds,
      getProductIds: rewardIds,
      buyQuantity: Number(config.buyQuantity || 1),
      getQuantity: Number(config.getQuantity || 1),
      rewardDiscountType: config.rewardDiscountType || "percentage",
      rewardDiscountValue: Number(config.rewardDiscountValue || 0),
      parentVariantId,
    };
  }

  const entry = {
    type,
    productIds,
    discountType: node.discountType?.value,
    discountValue: Number(node.discountValue?.value || 0),
    parentVariantId,
  };

  if (type === "multipack") {
    entry.productId = productIds[0];
    entry.packSize = Number(config.packSize || 1);
  } else if (type === "variant") {
    entry.productId = productIds[0];
    entry.minItems = Number(node.minItems?.value || 1);
    entry.maxItems = Number(node.maxItems?.value || 1);
  } else if (type === "mix_match") {
    entry.minItems = Number(node.minItems?.value || 1);
    entry.maxItems = Number(node.maxItems?.value || productIds.length || 1);
  } else if (type === "infinite") {
    entry.minItems = Number(node.minItems?.value || 1);
  }

  return entry;
}

// Mirrors every active bundle's discount config into a shop metafield so the
// checkout discount function can look it up by handle without calling back
// into the Admin API at runtime (functions run sandboxed, no network access).
async function syncBundleIndex(admin) {
  const response = await admin.graphql(
    `#graphql
      query BundleIndexSource {
        shop { id }
        metaobjects(type: "$app:bundle", first: 50) {
          nodes { ...BundleFields }
        }
      }
      ${BUNDLE_FIELDS}`,
  );
  const json = await response.json();
  const shopId = json.data.shop.id;
  const nodes = json.data.metaobjects.nodes;

  const index = {};
  for (const node of nodes) {
    if (node.status?.value !== "active") continue;
    index[node.handle] = buildIndexEntry(node);
  }

  await admin.graphql(
    `#graphql
      mutation SyncBundleIndex($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message code }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: "$app",
            key: "bundle_index",
            type: "json",
            value: JSON.stringify(index),
          },
        ],
      },
    },
  );
}

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const id = formData.get("id");
    const response = await admin.graphql(
      `#graphql
        mutation DeleteBundle($id: ID!) {
          metaobjectDelete(id: $id) {
            deletedId
            userErrors { field message }
          }
        }`,
      { variables: { id } },
    );
    const json = await response.json();
    await syncBundleIndex(admin);
    return { deleted: json.data.metaobjectDelete };
  }

  if (intent === "toggleStatus") {
    const handle = formData.get("handle");
    const status = formData.get("status");
    const response = await admin.graphql(
      `#graphql
        mutation ToggleBundleStatus($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
          metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
            metaobject { id handle }
            userErrors { field message code }
          }
        }`,
      {
        variables: {
          handle: { type: "$app:bundle", handle },
          metaobject: { fields: [{ key: "status", value: status }] },
        },
      },
    );
    const json = await response.json();
    await syncBundleIndex(admin);
    return { toggled: json.data.metaobjectUpsert };
  }

  // intent === "save" — create (blank handle) or update (existing handle)
  const handle = formData.get("handle") || `bundle-${Date.now()}`;
  const title = formData.get("title") || "";
  const badgeText = formData.get("badgeText") || "";
  const price = formData.get("price") || "";
  const description = formData.get("description") || "";
  const bundleType = formData.get("bundleType") || "fixed";
  const discountType = formData.get("discountType") || "percentage";
  const discountValue = formData.get("discountValue") || "0";
  const minItems = formData.get("minItems") || "";
  const maxItems = formData.get("maxItems") || "";
  const volumeTiers = formData.get("volumeTiers") || "[]";
  const status = formData.get("status") || "active";
  const sortOrder = formData.get("sortOrder") || "0";
  const productIds = JSON.parse(formData.get("productIds") || "[]");
  const rewardProductIds = JSON.parse(formData.get("rewardProductIds") || "[]");
  const config = JSON.parse(formData.get("config") || "{}");

  const fields = [
    { key: "title", value: title },
    { key: "badge_text", value: badgeText },
    { key: "price", value: price || "0" },
    { key: "description", value: description },
    { key: "products", value: JSON.stringify(productIds) },
    { key: "bundle_type", value: bundleType },
    { key: "status", value: status },
    { key: "sort_order", value: sortOrder || "0" },
    { key: "config", value: JSON.stringify(config) },
  ];

  if (bundleType === "volume") {
    fields.push({ key: "volume_tiers", value: volumeTiers });
  } else if (bundleType === "bogo" || bundleType === "tiered") {
    // bogo: "get" products; tiered: add-on products — both live in reward_products
    fields.push({
      key: "reward_products",
      value: JSON.stringify(rewardProductIds),
    });
  } else {
    fields.push({ key: "discount_type", value: discountType });
    fields.push({ key: "discount_value", value: discountValue || "0" });
    if (bundleType === "mix_match" || bundleType === "variant") {
      fields.push({ key: "min_items", value: minItems || "1" });
      fields.push({
        key: "max_items",
        value: maxItems || String(productIds.length || 1),
      });
    } else if (bundleType === "infinite") {
      fields.push({ key: "min_items", value: minItems || "1" });
    }
  }

  const response = await admin.graphql(
    `#graphql
      mutation UpsertBundle($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
        metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message code }
        }
      }`,
    {
      variables: {
        handle: { type: "$app:bundle", handle },
        metaobject: { fields },
      },
    },
  );
  const json = await response.json();
  await syncBundleIndex(admin);
  return { saved: json.data.metaobjectUpsert };
};

function formatDiscount(bundle) {
  const type = bundle.bundleType?.value;
  if (type === "volume") {
    let tiers = [];
    try {
      tiers = JSON.parse(bundle.volumeTiers?.value || "[]");
    } catch {
      tiers = [];
    }
    return `${tiers.length} volume tier${tiers.length === 1 ? "" : "s"}`;
  }
  if (type === "tiered") {
    let config = {};
    try {
      config = JSON.parse(bundle.config?.value || "{}");
    } catch {
      config = {};
    }
    const n = (config.tiers || []).length;
    return `${n} tier${n === 1 ? "" : "s"} (Bundle & Save)`;
  }
  if (type === "bogo") {
    let config = {};
    try {
      config = JSON.parse(bundle.config?.value || "{}");
    } catch {
      config = {};
    }
    const reward =
      config.rewardDiscountType === "percentage"
        ? `${config.rewardDiscountValue || 0}% off`
        : `$${config.rewardDiscountValue || 0} off`;
    return `Buy ${config.buyQuantity || 1}, get ${config.getQuantity || 1} (${reward})`;
  }
  const discountType = bundle.discountType?.value;
  const value = bundle.discountValue?.value;
  if (discountType === "percentage") return `${value || 0}% off`;
  if (discountType === "fixed_amount") return `$${value || 0} off`;
  if (discountType === "fixed_price") return `Fixed $${value || 0}`;
  return "—";
}

function typeLabel(value) {
  return BUNDLE_TYPES.find((t) => t.value === value)?.label || value;
}

// Same idea as formatDiscount, but reads straight from the in-progress form
// state so the editor preview updates live as the merchant types.
function formatFormDiscount(form) {
  if (form.bundleType === "volume") {
    const n = form.volumeTiers.length;
    return `${n} volume tier${n === 1 ? "" : "s"}`;
  }
  if (form.bundleType === "tiered") {
    const n = form.tieredTiers.length;
    return `${n} tier${n === 1 ? "" : "s"} (Bundle & Save)`;
  }
  if (form.bundleType === "bogo") {
    const reward =
      form.rewardDiscountType === "percentage"
        ? `${form.rewardDiscountValue || 0}% off`
        : `$${form.rewardDiscountValue || 0} off`;
    return `Buy ${form.buyQuantity || 1}, get ${form.getQuantity || 1} (${reward})`;
  }
  if (form.discountType === "percentage") return `${form.discountValue || 0}% off`;
  if (form.discountType === "fixed_amount") return `$${form.discountValue || 0} off`;
  if (form.discountType === "fixed_price") return `Fixed $${form.discountValue || 0}`;
  return "—";
}

// --- Storefront-faithful preview -------------------------------------------
// The editor's right column shows an approximation of how the bundle ACTUALLY
// renders on the storefront (mirrors extensions/bundle-picker: the bp-* markup
// + bundle-picker-css.liquid), not a Polaris schematic — so merchants
// recognise the real widget while building it. Product prices aren't loaded in
// the admin (the resource picker returns id/title/handle only), so an
// illustrative unit price is used purely to render the price/discount visuals.
const PREVIEW_UNIT_CENTS = 2999;

function pvApplyDiscount(baseCents, discountType, discountValue) {
  const value = Number(discountValue) || 0;
  if (discountType === "percentage")
    return Math.max(0, Math.round(baseCents * (1 - value / 100)));
  if (discountType === "fixed_amount")
    return Math.max(0, baseCents - Math.round(value * 100));
  if (discountType === "fixed_price")
    return Math.max(0, Math.round(value * 100));
  return baseCents;
}

function pvMoney(cents) {
  return `$${((Number(cents) || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const PREVIEW_CSS = `
.bpv { --acc: #E8B600; --card: #ffffff; --txt: #14110c; --hl: #1d63e9;
  --border: rgba(20,17,12,0.14); --muted: rgba(20,17,12,0.55);
  font-family: -apple-system, system-ui, sans-serif; color: var(--txt);
  background: var(--card); border-radius: 12px; border: 1px solid var(--border);
  padding: 1.25rem; max-width: 26rem; }
.bpv * { box-sizing: border-box; }
.bpv__title { display: flex; align-items: center; gap: .6rem; font-size: .95rem;
  font-weight: 800; letter-spacing: .02em; text-transform: uppercase; margin: 0 0 1rem; }
.bpv__title::before, .bpv__title::after { content:''; flex:1 1 auto; height:1px;
  background: color-mix(in srgb, currentColor 25%, transparent); }
.bpv__badge { display:inline-block; background: var(--acc); color:#fff; font-size:.7rem;
  font-weight:700; letter-spacing:.03em; text-transform:uppercase; padding:.25rem .6rem;
  border-radius:.4rem; margin-bottom:.75rem; }
.bpv-tierlist { list-style:none; margin:0 0 1rem; padding:0; display:flex; flex-direction:column; gap:.75rem; }
.bpv-tier2 { position:relative; border-radius:.7rem; background: var(--acc); color: var(--txt);
  box-shadow: 0 0 0 2px transparent; }
.bpv-tier2.is-selected { box-shadow: 0 0 0 3px var(--hl); }
.bpv-tier2.is-popular { margin-top: 1.6rem; }
.bpv-tier2__ribbon { position:absolute; bottom:100%; right:.8rem; margin-bottom:-.4rem;
  background: var(--hl); color:#fff; font-size:.62rem; font-weight:800; letter-spacing:.04em;
  padding:.2rem .5rem; border-radius:.4rem; text-transform:uppercase; }
.bpv-tier2__head { display:flex; align-items:center; gap:.7rem; padding:.7rem .8rem; }
.bpv-tier2__radio { width:1.1rem; height:1.1rem; flex:0 0 auto; accent-color: var(--hl); }
.bpv-tier2__info { display:flex; flex-direction:column; gap:.15rem; flex:1 1 auto; min-width:0; }
.bpv-tier2__t { display:flex; align-items:center; gap:.5rem; font-size:.95rem; font-weight:800; }
.bpv-pill { font-size:.6rem; font-weight:800; color:#fff; background: var(--hl);
  padding:.12rem .45rem; border-radius:999px; white-space:nowrap; }
.bpv-tier2__sub { font-size:.72rem; font-weight:600; color: var(--muted); }
.bpv-tier2__prices { display:flex; flex-direction:column; align-items:flex-end; flex:0 0 auto; }
.bpv-now { font-size:1.15rem; font-weight:800; }
.bpv-was { font-size:.72rem; color: var(--muted); text-decoration: line-through; }
.bpv-tier2__body { padding:0 .8rem .8rem; display:flex; flex-direction:column; gap:.5rem; }
.bpv-vslot { display:flex; align-items:center; gap:.6rem; }
.bpv-vslot__img { width:2rem; height:2rem; border-radius:.35rem; flex:0 0 auto;
  background: color-mix(in srgb, var(--txt) 12%, transparent); }
.bpv-vslot__sel { flex:1 1 auto; padding:.35rem .5rem; border-radius:.4rem; border:1px solid var(--border);
  background: color-mix(in srgb, var(--txt) 6%, var(--card)); font-size:.78rem; font-weight:600; }
.bpv-addons { margin:.5rem -.8rem -.8rem; background: color-mix(in srgb, var(--txt) 5%, var(--card)); }
.bpv-addon { display:flex; align-items:center; gap:.6rem; padding:.5rem .8rem; border-top:1px solid var(--border); }
.bpv-addon__cb { width:1rem; height:1rem; accent-color: var(--acc); }
.bpv-addon__img { width:1.8rem; height:1.8rem; border-radius:.35rem; flex:0 0 auto;
  background: color-mix(in srgb, var(--txt) 10%, transparent); }
.bpv-addon__name { flex:1 1 auto; font-size:.78rem; font-weight:700; }
.bpv-addon__price { font-size:.85rem; font-weight:800; }
.bpv-list { list-style:none; margin:0 0 1rem; padding:0; display:flex; flex-direction:column; gap:.5rem; }
.bpv-line { display:flex; align-items:center; gap:.6rem; }
.bpv-line__img { width:2.2rem; height:2.2rem; border-radius:.4rem; flex:0 0 auto;
  background: color-mix(in srgb, var(--txt) 10%, transparent); }
.bpv-line__name { flex:1 1 auto; font-size:.85rem; font-weight:600; }
.bpv-priceRow { display:flex; align-items:baseline; gap:.6rem; margin: .25rem 0 1rem; }
.bpv-priceRow .bpv-now { font-size:1.4rem; }
.bpv-submit { width:100%; padding:.85rem 1rem; border:none; border-radius:4px; background: var(--acc);
  color:#fff; font-size:.95rem; font-weight:800; letter-spacing:.04em; text-transform:uppercase; cursor:default; }
.bpv-note { font-size:.68rem; color: var(--muted); margin:.6rem 0 0; text-align:center; }
`;

function StorefrontPreview({ form }) {
  const acc = form.accentColor || "#E8B600";
  const title = form.title || "Bundle & Save";
  const products = form.selectedProducts || [];
  const firstProduct = products[0]?.title || "Product";
  const addOns = form.rewardProducts || [];

  let inner;
  if (form.bundleType === "tiered") {
    const tiers = form.tieredTiers || [];
    const selIdx = Math.max(0, tiers.findIndex((t) => t.mostPopular));
    inner = (
      <>
        <ul className="bpv-tierlist">
          {tiers.map((t, i) => {
            const qty = Number(t.quantity) || 1;
            const was = PREVIEW_UNIT_CENTS * qty;
            const now = pvApplyDiscount(was, t.discountType, t.value);
            const saved = Math.max(0, was - now);
            const pct = was > 0 ? Math.round((saved / was) * 100) : 0;
            const selected = i === selIdx;
            return (
              <li
                key={i}
                className={`bpv-tier2${selected ? " is-selected" : ""}${
                  t.mostPopular ? " is-popular" : ""
                }`}
              >
                {t.mostPopular ? (
                  <span className="bpv-tier2__ribbon">Most popular</span>
                ) : null}
                <div className="bpv-tier2__head">
                  <input
                    type="radio"
                    className="bpv-tier2__radio"
                    checked={selected}
                    readOnly
                  />
                  <div className="bpv-tier2__info">
                    <div className="bpv-tier2__t">
                      {t.title || `${qty}-pack`}
                      {saved > 0 ? (
                        <span className="bpv-pill">SAVE {pvMoney(saved)}</span>
                      ) : null}
                    </div>
                    <div className="bpv-tier2__sub">
                      {saved > 0 ? `You save ${pct}%` : "Standard price"}
                    </div>
                  </div>
                  <div className="bpv-tier2__prices">
                    <span className="bpv-now">{pvMoney(now)}</span>
                    {now < was ? (
                      <span className="bpv-was">{pvMoney(was)}</span>
                    ) : null}
                  </div>
                </div>
                {selected ? (
                  <div className="bpv-tier2__body">
                    {Array.from({ length: qty }).map((_, s) => (
                      <div className="bpv-vslot" key={s}>
                        <span className="bpv-vslot__img" />
                        <select className="bpv-vslot__sel" disabled>
                          <option>{firstProduct}</option>
                        </select>
                      </div>
                    ))}
                    {addOns.length > 0 ? (
                      <div className="bpv-addons">
                        {addOns.map((a) => {
                          const p = pvApplyDiscount(
                            PREVIEW_UNIT_CENTS,
                            form.rewardDiscountType,
                            form.rewardDiscountValue,
                          );
                          return (
                            <label className="bpv-addon" key={a.id}>
                              <input
                                type="checkbox"
                                className="bpv-addon__cb"
                                defaultChecked
                              />
                              <span className="bpv-addon__img" />
                              <span className="bpv-addon__name">{a.title}</span>
                              <span className="bpv-addon__price">
                                {pvMoney(p)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <button type="button" className="bpv-submit">
          Add to cart
        </button>
      </>
    );
  } else {
    // Fixed / variant / multipack / mix & match / infinite / volume / bogo:
    // a product card with the included lines, a headline price and the button.
    const count =
      form.bundleType === "multipack"
        ? Number(form.packSize) || 1
        : products.length || 1;
    const was = PREVIEW_UNIT_CENTS * count;
    const now = usesDiscount(form.bundleType)
      ? pvApplyDiscount(was, form.discountType, form.discountValue)
      : was;
    const shownProducts = products.length ? products : [{ id: "ph", title: "Your product" }];
    inner = (
      <>
        <ul className="bpv-list">
          {shownProducts.map((p) => (
            <li className="bpv-line" key={p.id}>
              <span className="bpv-line__img" />
              <span className="bpv-line__name">{p.title}</span>
            </li>
          ))}
        </ul>
        {form.bundleType === "bogo" && addOns.length > 0 ? (
          <ul className="bpv-list">
            {addOns.map((p) => (
              <li className="bpv-line" key={p.id}>
                <span className="bpv-line__img" />
                <span className="bpv-line__name">+ {p.title}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="bpv-priceRow">
          <span className="bpv-now">{pvMoney(now)}</span>
          {now < was ? <span className="bpv-was">{pvMoney(was)}</span> : null}
        </div>
        <button type="button" className="bpv-submit">
          Add to cart
        </button>
      </>
    );
  }

  return (
    <div className="bpv" style={{ "--acc": acc }}>
      <style dangerouslySetInnerHTML={{ __html: PREVIEW_CSS }} />
      {form.badgeText ? <span className="bpv__badge">{form.badgeText}</span> : null}
      <h3 className="bpv__title">{title}</h3>
      {inner}
      <p className="bpv-note">
        Live preview · prices are illustrative ({pvMoney(PREVIEW_UNIT_CENTS)}
        /unit)
      </p>
    </div>
  );
}

export default function Bundles() {
  const { bundles } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [form, setForm] = useState(emptyForm);
  const [searchValue, setSearchValue] = useState("");
  // Which screen of the flow is visible: the bundle list, the type gallery,
  // or the editor (form + live preview).
  const [view, setView] = useState("list");

  const isSaving =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === "save";
  const isEditing = Boolean(form.handle);

  const visibleBundles = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return bundles;
    return bundles.filter((bundle) =>
      (bundle.title?.value || "").toLowerCase().includes(query),
    );
  }, [bundles, searchValue]);

  const setField = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const resetForm = () => setForm(emptyForm);

  const startEdit = (bundle) => {
    let volumeTiers = emptyForm.volumeTiers;
    try {
      const parsed = JSON.parse(bundle.volumeTiers?.value || "[]");
      if (parsed.length) volumeTiers = parsed;
    } catch {
      // keep default tiers
    }
    let config = {};
    try {
      config = JSON.parse(bundle.config?.value || "{}");
    } catch {
      config = {};
    }
    setForm({
      handle: bundle.handle,
      title: bundle.title?.value || "",
      badgeText: bundle.badgeText?.value || "",
      price: bundle.price?.value || "",
      description: bundle.description?.value || "",
      bundleType: bundle.bundleType?.value || "fixed",
      discountType: bundle.discountType?.value || "percentage",
      discountValue: bundle.discountValue?.value || "0",
      minItems: bundle.minItems?.value || "1",
      maxItems: bundle.maxItems?.value || "2",
      status: bundle.status?.value || "active",
      sortOrder: bundle.sortOrder?.value || "0",
      accentColor: config.accentColor || emptyForm.accentColor,
      containerVariant: config.parentVariantId
        ? { id: config.parentVariantId, title: config.parentVariantTitle || "Selected variant" }
        : null,
      selectedProducts: (bundle.products?.references?.nodes || []).map((p) => ({
        id: p.id,
        title: p.title,
        handle: p.handle,
      })),
      volumeTiers,
      packSize: config.packSize != null ? String(config.packSize) : "3",
      buyQuantity: config.buyQuantity != null ? String(config.buyQuantity) : "1",
      getQuantity: config.getQuantity != null ? String(config.getQuantity) : "1",
      rewardDiscountType:
        config.rewardDiscountType || config.addOnDiscountType || "percentage",
      rewardDiscountValue:
        config.rewardDiscountValue != null
          ? String(config.rewardDiscountValue)
          : config.addOnDiscountValue != null
            ? String(config.addOnDiscountValue)
            : "100",
      rewardProducts: (bundle.rewardProducts?.references?.nodes || []).map(
        (p) => ({ id: p.id, title: p.title, handle: p.handle }),
      ),
      tieredTiers:
        Array.isArray(config.tiers) && config.tiers.length
          ? config.tiers.map((t) => ({
              title: t.title || "",
              quantity: String(t.quantity ?? "1"),
              discountType: t.discountType || "percentage",
              value: String(t.discountValue ?? "0"),
              mostPopular: !!t.mostPopular,
            }))
          : emptyForm.tieredTiers,
    });
    setView("editor");
  };

  // "Add bundle" starts a fresh draft and shows the type gallery first.
  const openAdd = () => {
    resetForm();
    setView("chooseType");
  };

  // Picking a type in the gallery keeps whatever the merchant already filled
  // in (so "Change type" mid-edit doesn't wipe the draft) and opens the editor.
  const chooseType = (type) => {
    setForm((prev) => ({ ...prev, bundleType: type }));
    setView("editor");
  };

  const cancelToList = () => {
    resetForm();
    setView("list");
  };

  const pickProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: usesSingleProduct(form.bundleType) ? false : true,
      selectionIds: form.selectedProducts.map((p) => ({ id: p.id })),
    });
    if (selected) {
      setForm((prev) => ({ ...prev, selectedProducts: selected }));
    }
  };

  const pickRewardProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: form.rewardProducts.map((p) => ({ id: p.id })),
    });
    if (selected) {
      setForm((prev) => ({ ...prev, rewardProducts: selected }));
    }
  };

  // Picks the single "container" variant that a Cart Transform merge uses as
  // the parent line so the whole bundle shows as one cart item.
  const pickContainerVariant = async () => {
    const selected = await shopify.resourcePicker({
      type: "variant",
      multiple: false,
      selectionIds: form.containerVariant ? [{ id: form.containerVariant.id }] : [],
    });
    if (selected && selected[0]) {
      const v = selected[0];
      setForm((prev) => ({
        ...prev,
        containerVariant: {
          id: v.id,
          title: [v.product?.title || v.displayName, v.title]
            .filter(Boolean)
            .join(" · "),
        },
      }));
    }
  };

  const clearContainerVariant = () =>
    setForm((prev) => ({ ...prev, containerVariant: null }));

  const addTierRow = () =>
    setForm((prev) => ({
      ...prev,
      volumeTiers: [
        ...prev.volumeTiers,
        { minQuantity: "", discountType: "percentage", value: "" },
      ],
    }));

  const removeTierRow = (index) =>
    setForm((prev) => ({
      ...prev,
      volumeTiers: prev.volumeTiers.filter((_, i) => i !== index),
    }));

  const updateTierRow = (index, key, value) =>
    setForm((prev) => ({
      ...prev,
      volumeTiers: prev.volumeTiers.map((tier, i) =>
        i === index ? { ...tier, [key]: value } : tier,
      ),
    }));

  const addTieredTier = () =>
    setForm((prev) => ({
      ...prev,
      tieredTiers: [
        ...prev.tieredTiers,
        {
          title: "",
          quantity: String(prev.tieredTiers.length + 1),
          discountType: "percentage",
          value: "",
          mostPopular: false,
        },
      ],
    }));

  const removeTieredTier = (index) =>
    setForm((prev) => ({
      ...prev,
      tieredTiers: prev.tieredTiers.filter((_, i) => i !== index),
    }));

  const updateTieredTier = (index, key, value) =>
    setForm((prev) => ({
      ...prev,
      tieredTiers: prev.tieredTiers.map((tier, i) =>
        // "most popular" is exclusive — only one tier can be preselected
        key === "mostPopular" && value
          ? { ...tier, mostPopular: i === index }
          : i === index
            ? { ...tier, [key]: value }
            : tier,
      ),
    }));

  const buildConfig = () => {
    // Product handles are stored here (scalar JSON) because app-owned metaobject
    // product_reference fields DON'T resolve on the storefront — the theme reads
    // these handles to match the product page and resolve add-ons via all_products.
    const base = {
      productHandles: form.selectedProducts.map((p) => p.handle).filter(Boolean),
      addOnHandles: form.rewardProducts.map((p) => p.handle).filter(Boolean),
      accentColor: form.accentColor,
      // Cart Transform container variant (see bundle-cart-transform). Stored in
      // config so it syncs into $app:bundle_index via buildIndexEntry.
      ...(form.containerVariant
        ? {
            parentVariantId: form.containerVariant.id,
            parentVariantTitle: form.containerVariant.title,
          }
        : {}),
    };
    if (form.bundleType === "multipack") {
      return { ...base, packSize: Number(form.packSize) || 1 };
    }
    if (form.bundleType === "bogo") {
      return {
        ...base,
        buyQuantity: Number(form.buyQuantity) || 1,
        getQuantity: Number(form.getQuantity) || 1,
        rewardDiscountType: form.rewardDiscountType,
        rewardDiscountValue: Number(form.rewardDiscountValue) || 0,
      };
    }
    if (form.bundleType === "tiered") {
      return {
        ...base,
        tiers: form.tieredTiers.map((t) => ({
          title: t.title,
          quantity: Number(t.quantity) || 1,
          discountType: t.discountType,
          discountValue: Number(t.value) || 0,
          mostPopular: !!t.mostPopular,
        })),
        addOnDiscountType: form.rewardDiscountType,
        addOnDiscountValue: Number(form.rewardDiscountValue) || 0,
      };
    }
    return base;
  };

  const saveBundle = () => {
    fetcher.submit(
      {
        intent: "save",
        handle: form.handle,
        title: form.title,
        badgeText: form.badgeText,
        price: form.price,
        description: form.description,
        bundleType: form.bundleType,
        discountType: form.discountType,
        discountValue: form.discountValue,
        minItems: form.minItems,
        maxItems: form.maxItems,
        volumeTiers: JSON.stringify(form.volumeTiers),
        status: form.status,
        sortOrder: form.sortOrder,
        productIds: JSON.stringify(form.selectedProducts.map((p) => p.id)),
        rewardProductIds: JSON.stringify(form.rewardProducts.map((p) => p.id)),
        config: JSON.stringify(buildConfig()),
      },
      { method: "POST" },
    );
    const wasEditing = isEditing;
    resetForm();
    setView("list");
    shopify.toast.show(wasEditing ? "Bundle updated" : "Bundle created");
  };

  const deleteBundle = (id) => {
    fetcher.submit({ intent: "delete", id }, { method: "POST" });
  };

  const toggleStatus = (bundle) => {
    const nextStatus = bundle.status?.value === "active" ? "draft" : "active";
    fetcher.submit(
      { intent: "toggleStatus", handle: bundle.handle, status: nextStatus },
      { method: "POST" },
    );
  };

  const canSave = (() => {
    if (!form.title) return false;
    if (form.bundleType === "bogo") {
      return (
        form.selectedProducts.length > 0 && form.rewardProducts.length > 0
      );
    }
    if (form.selectedProducts.length === 0) return false;
    if (usesMinMax(form.bundleType)) {
      return Number(form.minItems) <= Number(form.maxItems);
    }
    return true;
  })();

  const productPickerLabel = {
    fixed: "Choose products",
    variant: "Choose the product",
    multipack: "Choose the product",
    mix_match: "Choose eligible products",
    infinite: "Choose eligible products",
    volume: "Choose product",
    tiered: "Choose the product",
    bogo: "Choose “Buy” products",
  }[form.bundleType];

  // ---------------------------------------------------------------- LIST VIEW
  if (view === "list") {
    return (
      <s-page heading="Bundles">
        <s-button slot="primary-action" variant="primary" onClick={openAdd}>
          Add bundle
        </s-button>
        <s-section heading="All bundles">
          {bundles.length === 0 ? (
            <s-grid gap="base" justifyItems="center" paddingBlock="large-400">
              <s-stack direction="block" gap="small" alignItems="center">
                <s-heading>No bundles yet</s-heading>
                <s-paragraph color="subdued">
                  Create your first bundle — choose from {BUNDLE_TYPES.length}{" "}
                  bundle types.
                </s-paragraph>
              </s-stack>
              <s-button variant="primary" onClick={openAdd}>
                Add bundle
              </s-button>
            </s-grid>
          ) : (
            <s-stack direction="block" gap="base">
              <s-search-field
                label="Search bundles"
                value={searchValue}
                onInput={(e) => setSearchValue(e.target.value)}
              ></s-search-field>

              {visibleBundles.length === 0 ? (
                <s-paragraph>No bundles match.</s-paragraph>
              ) : (
                <s-table variant="auto">
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Title</s-table-header>
                    <s-table-header>Type</s-table-header>
                    <s-table-header>Discount</s-table-header>
                    <s-table-header>Status</s-table-header>
                    <s-table-header>Products</s-table-header>
                    <s-table-header></s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {visibleBundles.map((bundle) => (
                      <s-table-row key={bundle.id}>
                        <s-table-cell>{bundle.title?.value}</s-table-cell>
                        <s-table-cell>
                          {typeLabel(bundle.bundleType?.value)}
                        </s-table-cell>
                        <s-table-cell>{formatDiscount(bundle)}</s-table-cell>
                        <s-table-cell>
                          <s-badge
                            tone={
                              bundle.status?.value === "active"
                                ? "success"
                                : "neutral"
                            }
                          >
                            {bundle.status?.value === "active"
                              ? "Active"
                              : "Draft"}
                          </s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          {(bundle.products?.references?.nodes || [])
                            .map((p) => p.title)
                            .join(", ")}
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="small-300">
                            <s-button
                              variant="tertiary"
                              onClick={() => startEdit(bundle)}
                            >
                              Edit
                            </s-button>
                            <s-button
                              variant="tertiary"
                              onClick={() => toggleStatus(bundle)}
                            >
                              {bundle.status?.value === "active"
                                ? "Set draft"
                                : "Set active"}
                            </s-button>
                            <s-button
                              variant="tertiary"
                              tone="critical"
                              onClick={() => deleteBundle(bundle.id)}
                            >
                              Delete
                            </s-button>
                          </s-stack>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-stack>
          )}
        </s-section>
      </s-page>
    );
  }

  // --------------------------------------------------------- CHOOSE-TYPE VIEW
  if (view === "chooseType") {
    return (
      <s-page heading="Choose a bundle type">
        <s-button slot="secondary-actions" onClick={cancelToList}>
          Cancel
        </s-button>
        <s-section heading="What kind of bundle do you want to create?">
          <s-grid gridTemplateColumns="repeat(6, 1fr)" gap="base">
            {BUNDLE_TYPES.map((t) => (
              <s-grid-item key={t.value} gridColumn="span 2">
                <s-clickable
                  border="base"
                  borderRadius="base"
                  padding="base"
                  inlineSize="100%"
                  onClick={() => chooseType(t.value)}
                  accessibilityLabel={`Create a ${t.label}`}
                >
                  <s-stack direction="block" gap="small">
                    <s-heading>{t.label}</s-heading>
                    <s-text type="strong" color="subdued">
                      {t.tagline}
                    </s-text>
                    <s-paragraph color="subdued">{t.description}</s-paragraph>
                  </s-stack>
                </s-clickable>
              </s-grid-item>
            ))}
          </s-grid>
        </s-section>
      </s-page>
    );
  }

  // -------------------------------------------------------------- EDITOR VIEW
  const activeType = BUNDLE_TYPES.find((t) => t.value === form.bundleType);
  return (
    <s-page
      heading={isEditing ? "Edit bundle" : `New ${activeType?.label || "bundle"}`}
    >
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={saveBundle}
        {...(isSaving ? { loading: true } : {})}
        {...(!canSave ? { disabled: true } : {})}
      >
        {isEditing ? "Save changes" : "Save bundle"}
      </s-button>
      <s-button slot="secondary-actions" onClick={cancelToList}>
        Cancel
      </s-button>

      <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
        <s-grid-item gridColumn="span 7">
          <s-section heading="Details">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-badge tone="info">{activeType?.label}</s-badge>
                {!isEditing ? (
                  <s-button
                    variant="tertiary"
                    onClick={() => setView("chooseType")}
                  >
                    Change type
                  </s-button>
                ) : null}
              </s-stack>

              <s-text-field
                label="Title"
            name="title"
            value={form.title}
            onInput={setField("title")}
          ></s-text-field>
          <s-text-field
            label="Badge text"
            name="badgeText"
            value={form.badgeText}
            onInput={setField("badgeText")}
          ></s-text-field>
          <s-text-area
            label="Description"
            name="description"
            rows={3}
            value={form.description}
            onInput={setField("description")}
          ></s-text-area>

          <s-stack direction="inline" gap="small-300" alignItems="center">
            <label htmlFor="accentColor" style={{ fontSize: "0.8125rem" }}>
              Accent color
            </label>
            <input
              id="accentColor"
              type="color"
              name="accentColor"
              value={form.accentColor}
              onInput={setField("accentColor")}
              style={{
                width: "2.4rem",
                height: "2.4rem",
                padding: 0,
                border: "1px solid #c9cccf",
                borderRadius: "0.4rem",
                cursor: "pointer",
              }}
            />
          </s-stack>

          {usesDiscount(form.bundleType) ? (
            <s-stack direction="inline" gap="base">
              <s-select
                label="Discount type"
                name="discountType"
                value={form.discountType}
                onChange={setField("discountType")}
              >
                {DISCOUNT_TYPES.map((t) => (
                  <s-option key={t.value} value={t.value}>
                    {t.label}
                  </s-option>
                ))}
              </s-select>
              <s-number-field
                label={
                  form.discountType === "percentage"
                    ? "Percent off"
                    : form.discountType === "fixed_amount"
                      ? "Amount off"
                      : "Fixed bundle price"
                }
                name="discountValue"
                value={form.discountValue}
                onInput={setField("discountValue")}
              ></s-number-field>
            </s-stack>
          ) : null}

          {form.bundleType === "multipack" ? (
            <s-number-field
              label="Pack size (units per pack)"
              name="packSize"
              value={form.packSize}
              onInput={setField("packSize")}
            ></s-number-field>
          ) : null}

          {usesMinMax(form.bundleType) ? (
            <s-stack direction="inline" gap="base">
              <s-number-field
                label={
                  form.bundleType === "variant"
                    ? "Minimum variants to pick"
                    : "Minimum items to pick"
                }
                name="minItems"
                value={form.minItems}
                onInput={setField("minItems")}
              ></s-number-field>
              <s-number-field
                label={
                  form.bundleType === "variant"
                    ? "Maximum variants to pick"
                    : "Maximum items to pick"
                }
                name="maxItems"
                value={form.maxItems}
                onInput={setField("maxItems")}
              ></s-number-field>
            </s-stack>
          ) : null}

          {usesMinOnly(form.bundleType) ? (
            <s-number-field
              label="Minimum items to pick"
              name="minItems"
              value={form.minItems}
              onInput={setField("minItems")}
            ></s-number-field>
          ) : null}

          {form.bundleType === "volume" ? (
            <s-stack direction="block" gap="base">
              <s-text>Quantity tiers</s-text>
              {form.volumeTiers.map((tier, index) => (
                <s-stack
                  key={index}
                  direction="inline"
                  gap="base"
                  alignItems="center"
                >
                  <s-number-field
                    label="Min quantity"
                    value={tier.minQuantity}
                    onInput={(e) =>
                      updateTierRow(index, "minQuantity", e.target.value)
                    }
                  ></s-number-field>
                  <s-select
                    label="Discount type"
                    value={tier.discountType}
                    onChange={(e) =>
                      updateTierRow(index, "discountType", e.target.value)
                    }
                  >
                    <s-option value="percentage">Percentage off</s-option>
                    <s-option value="fixed_amount">Amount off</s-option>
                  </s-select>
                  <s-number-field
                    label="Value"
                    value={tier.value}
                    onInput={(e) =>
                      updateTierRow(index, "value", e.target.value)
                    }
                  ></s-number-field>
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    onClick={() => removeTierRow(index)}
                  >
                    Remove
                  </s-button>
                </s-stack>
              ))}
              <s-button onClick={addTierRow}>Add tier</s-button>
            </s-stack>
          ) : null}

          {form.bundleType === "tiered" ? (
            <s-stack direction="block" gap="base">
              <s-text>Tiers — each tier is a number of units at a discount</s-text>
              {form.tieredTiers.map((tier, index) => (
                <s-stack
                  key={index}
                  direction="inline"
                  gap="base"
                  alignItems="center"
                >
                  <s-text-field
                    label="Tier name"
                    value={tier.title}
                    onInput={(e) =>
                      updateTieredTier(index, "title", e.target.value)
                    }
                  ></s-text-field>
                  <s-number-field
                    label="Units"
                    value={tier.quantity}
                    onInput={(e) =>
                      updateTieredTier(index, "quantity", e.target.value)
                    }
                  ></s-number-field>
                  <s-select
                    label="Pricing"
                    value={tier.discountType}
                    onChange={(e) =>
                      updateTieredTier(index, "discountType", e.target.value)
                    }
                  >
                    <s-option value="percentage">Percentage off</s-option>
                    <s-option value="fixed_amount">Amount off</s-option>
                    <s-option value="fixed_price">Set price</s-option>
                  </s-select>
                  <s-number-field
                    label={
                      tier.discountType === "fixed_price"
                        ? "Tier price"
                        : tier.discountType === "fixed_amount"
                          ? "Amount off"
                          : "Percent off"
                    }
                    value={tier.value}
                    onInput={(e) =>
                      updateTieredTier(index, "value", e.target.value)
                    }
                  ></s-number-field>
                  <s-switch
                    label="Popular"
                    checked={tier.mostPopular}
                    onChange={(e) =>
                      updateTieredTier(index, "mostPopular", e.target.checked)
                    }
                  ></s-switch>
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    onClick={() => removeTieredTier(index)}
                  >
                    Remove
                  </s-button>
                </s-stack>
              ))}
              <s-button onClick={addTieredTier}>Add tier</s-button>
            </s-stack>
          ) : null}

          {form.bundleType === "tiered" ? (
            <s-stack direction="block" gap="base">
              <s-text type="strong">
                Add-on products (optional — shown as checkboxes under the
                selected tier)
              </s-text>
              <s-stack direction="inline" gap="base">
                <s-select
                  label="Add-on discount type"
                  name="rewardDiscountType"
                  value={form.rewardDiscountType}
                  onChange={setField("rewardDiscountType")}
                >
                  {REWARD_DISCOUNT_TYPES.map((t) => (
                    <s-option key={t.value} value={t.value}>
                      {t.label}
                    </s-option>
                  ))}
                </s-select>
                <s-number-field
                  label={
                    form.rewardDiscountType === "percentage"
                      ? "Percent off add-ons"
                      : "Amount off add-ons"
                  }
                  name="rewardDiscountValue"
                  value={form.rewardDiscountValue}
                  onInput={setField("rewardDiscountValue")}
                ></s-number-field>
              </s-stack>
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button onClick={pickRewardProducts}>
                  Choose add-on products
                </s-button>
                <s-text>
                  {form.rewardProducts.length > 0
                    ? form.rewardProducts.map((p) => p.title).join(", ")
                    : "No add-on products"}
                </s-text>
              </s-stack>
            </s-stack>
          ) : null}

          {form.bundleType === "bogo" ? (
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <s-number-field
                  label="Buy quantity (from “Buy” products)"
                  name="buyQuantity"
                  value={form.buyQuantity}
                  onInput={setField("buyQuantity")}
                ></s-number-field>
                <s-number-field
                  label="Get quantity (from “Get” products)"
                  name="getQuantity"
                  value={form.getQuantity}
                  onInput={setField("getQuantity")}
                ></s-number-field>
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-select
                  label="Reward discount type"
                  name="rewardDiscountType"
                  value={form.rewardDiscountType}
                  onChange={setField("rewardDiscountType")}
                >
                  {REWARD_DISCOUNT_TYPES.map((t) => (
                    <s-option key={t.value} value={t.value}>
                      {t.label}
                    </s-option>
                  ))}
                </s-select>
                <s-number-field
                  label={
                    form.rewardDiscountType === "percentage"
                      ? "Percent off reward (100 = free)"
                      : "Amount off reward"
                  }
                  name="rewardDiscountValue"
                  value={form.rewardDiscountValue}
                  onInput={setField("rewardDiscountValue")}
                ></s-number-field>
              </s-stack>
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button onClick={pickRewardProducts}>
                  Choose “Get” products
                </s-button>
                <s-text>
                  {form.rewardProducts.length > 0
                    ? form.rewardProducts.map((p) => p.title).join(", ")
                    : "No reward products selected"}
                </s-text>
              </s-stack>
            </s-stack>
          ) : null}

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button onClick={pickProducts}>{productPickerLabel}</s-button>
            <s-text>
              {form.selectedProducts.length > 0
                ? form.selectedProducts.map((p) => p.title).join(", ")
                : "No products selected"}
            </s-text>
          </s-stack>

          <s-stack direction="block" gap="small-300">
            <s-text type="strong">Merge into one cart line (optional)</s-text>
            <s-paragraph color="subdued">
              Pick a “container” product variant to represent this bundle. When
              set, the bundle’s items are merged into a single cart line at the
              bundle total (Cart Transform). Leave empty to keep separate lines.
            </s-paragraph>
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button onClick={pickContainerVariant}>
                {form.containerVariant ? "Change container variant" : "Choose container variant"}
              </s-button>
              <s-text>
                {form.containerVariant
                  ? form.containerVariant.title
                  : "Not merged (separate lines)"}
              </s-text>
              {form.containerVariant ? (
                <s-button variant="tertiary" tone="critical" onClick={clearContainerVariant}>
                  Clear
                </s-button>
              ) : null}
            </s-stack>
          </s-stack>

          <s-stack direction="inline" gap="base">
            <s-number-field
              label="Sort order"
              name="sortOrder"
              value={form.sortOrder}
              onInput={setField("sortOrder")}
            ></s-number-field>
            <s-switch
              label="Active"
              checked={form.status === "active"}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  status: e.target.checked ? "active" : "draft",
                }))
              }
            ></s-switch>
          </s-stack>

        </s-stack>
          </s-section>
        </s-grid-item>

        <s-grid-item gridColumn="span 5">
          <s-section heading="Preview">
            <s-stack direction="block" gap="base">
              <StorefrontPreview form={form} />
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-badge tone="info">{typeLabel(form.bundleType)}</s-badge>
                <s-text type="strong">{formatFormDiscount(form)}</s-text>
                <s-badge tone={form.status === "active" ? "success" : "neutral"}>
                  {form.status === "active" ? "Active" : "Draft"}
                </s-badge>
              </s-stack>
            </s-stack>
          </s-section>
        </s-grid-item>
      </s-grid>
    </s-page>
  );
}
