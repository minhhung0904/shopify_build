import { useMemo, useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// Single source of truth for the bundle types the app supports. Each entry
// declares which form sections it needs so the UI, the index sync, and the
// discount function all agree on the same set. Adding a future type is a
// matter of appending here + handling its `value` in the three switch points
// (buildIndexEntry, the form sections below, and the discount function).
const BUNDLE_TYPES = [
  { value: "fixed", label: "Fixed bundle" },
  { value: "variant", label: "Variant bundle" },
  { value: "multipack", label: "Multipack" },
  { value: "mix_match", label: "Mix & match" },
  { value: "infinite", label: "Infinite options" },
  { value: "volume", label: "Volume discount" },
  { value: "bogo", label: "BOGO (Buy X, get Y)" },
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
  ["volume", "multipack", "variant"].includes(type);

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
        nodes { ... on Product { id title } }
      }
    }
    rewardProducts: field(key: "reward_products") {
      references(first: 20) {
        nodes { ... on Product { id title } }
      }
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

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

  if (type === "volume") {
    let volumeTiers = [];
    try {
      volumeTiers = JSON.parse(node.volumeTiers?.value || "[]");
    } catch {
      volumeTiers = [];
    }
    return { type, productId: productIds[0], productIds, volumeTiers };
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
    };
  }

  const entry = {
    type,
    productIds,
    discountType: node.discountType?.value,
    discountValue: Number(node.discountValue?.value || 0),
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
  } else if (bundleType === "bogo") {
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

export default function Bundles() {
  const { bundles } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [form, setForm] = useState(emptyForm);
  const [searchValue, setSearchValue] = useState("");

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
      selectedProducts: (bundle.products?.references?.nodes || []).map((p) => ({
        id: p.id,
        title: p.title,
      })),
      volumeTiers,
      packSize: config.packSize != null ? String(config.packSize) : "3",
      buyQuantity: config.buyQuantity != null ? String(config.buyQuantity) : "1",
      getQuantity: config.getQuantity != null ? String(config.getQuantity) : "1",
      rewardDiscountType: config.rewardDiscountType || "percentage",
      rewardDiscountValue:
        config.rewardDiscountValue != null
          ? String(config.rewardDiscountValue)
          : "100",
      rewardProducts: (bundle.rewardProducts?.references?.nodes || []).map(
        (p) => ({ id: p.id, title: p.title }),
      ),
    });
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

  const buildConfig = () => {
    if (form.bundleType === "multipack") {
      return { packSize: Number(form.packSize) || 1 };
    }
    if (form.bundleType === "bogo") {
      return {
        buyQuantity: Number(form.buyQuantity) || 1,
        getQuantity: Number(form.getQuantity) || 1,
        rewardDiscountType: form.rewardDiscountType,
        rewardDiscountValue: Number(form.rewardDiscountValue) || 0,
      };
    }
    return {};
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
    resetForm();
    shopify.toast.show(isEditing ? "Bundle updated" : "Bundle created");
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
    bogo: "Choose “Buy” products",
  }[form.bundleType];

  return (
    <s-page heading="Bundles">
      <s-section heading={isEditing ? `Edit "${form.title}"` : "Create a bundle"}>
        <s-stack direction="block" gap="base">
          <s-select
            label="Bundle type"
            name="bundleType"
            value={form.bundleType}
            onChange={setField("bundleType")}
          >
            {BUNDLE_TYPES.map((t) => (
              <s-option key={t.value} value={t.value}>
                {t.label}
              </s-option>
            ))}
          </s-select>

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

          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              onClick={saveBundle}
              {...(isSaving ? { loading: true } : {})}
              {...(!canSave ? { disabled: true } : {})}
            >
              {isEditing ? "Save changes" : "Save bundle"}
            </s-button>
            {isEditing ? (
              <s-button onClick={resetForm}>Cancel edit</s-button>
            ) : null}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Existing bundles">
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
                      <s-stack direction="inline" gap="tight">
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
      </s-section>
    </s-page>
  );
}
