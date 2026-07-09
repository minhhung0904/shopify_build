import { useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query ListBundles {
        metaobjects(type: "$app:bundle", first: 50, sortKey: "updated_at", reverse: true) {
          nodes {
            id
            handle
            title: field(key: "title") { value }
            badgeText: field(key: "badge_text") { value }
            price: field(key: "price") { value }
            products: field(key: "products") {
              references(first: 10) {
                nodes {
                  ... on Product {
                    id
                    title
                  }
                }
              }
            }
          }
        }
      }`,
  );
  const json = await response.json();
  return { bundles: json.data.metaobjects.nodes };
};

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
    return { deleted: json.data.metaobjectDelete };
  }

  const title = formData.get("title") || "";
  const badgeText = formData.get("badgeText") || "";
  const price = formData.get("price") || "";
  const description = formData.get("description") || "";
  const productIds = JSON.parse(formData.get("productIds") || "[]");
  const handle = `bundle-${Date.now()}`;

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
        metaobject: {
          fields: [
            { key: "title", value: title },
            { key: "badge_text", value: badgeText },
            { key: "price", value: price || "0" },
            { key: "description", value: description },
            { key: "products", value: JSON.stringify(productIds) },
          ],
        },
      },
    },
  );
  const json = await response.json();
  return { created: json.data.metaobjectUpsert };
};

export default function Bundles() {
  const { bundles } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [title, setTitle] = useState("");
  const [badgeText, setBadgeText] = useState("Save 15%");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);

  const isSaving =
    fetcher.state !== "idle" && fetcher.formData?.get("intent") !== "delete";

  const pickProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: selectedProducts.map((p) => ({ id: p.id })),
    });
    if (selected) {
      setSelectedProducts(selected);
    }
  };

  const createBundle = () => {
    fetcher.submit(
      {
        intent: "create",
        title,
        badgeText,
        price,
        description,
        productIds: JSON.stringify(selectedProducts.map((p) => p.id)),
      },
      { method: "POST" },
    );
    setTitle("");
    setBadgeText("Save 15%");
    setPrice("");
    setDescription("");
    setSelectedProducts([]);
    shopify.toast.show("Bundle created");
  };

  const deleteBundle = (id) => {
    fetcher.submit({ intent: "delete", id }, { method: "POST" });
  };

  return (
    <s-page heading="Bundles">
      <s-section heading="Create a bundle">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Title"
            name="title"
            value={title}
            onInput={(e) => setTitle(e.target.value)}
          ></s-text-field>
          <s-text-field
            label="Badge text"
            name="badgeText"
            value={badgeText}
            onInput={(e) => setBadgeText(e.target.value)}
          ></s-text-field>
          <s-text-field
            label="Display price"
            name="price"
            value={price}
            onInput={(e) => setPrice(e.target.value)}
          ></s-text-field>
          <s-text-area
            label="Description"
            name="description"
            rows={3}
            value={description}
            onInput={(e) => setDescription(e.target.value)}
          ></s-text-area>

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button onClick={pickProducts}>Choose products</s-button>
            <s-text>
              {selectedProducts.length > 0
                ? selectedProducts.map((p) => p.title).join(", ")
                : "No products selected"}
            </s-text>
          </s-stack>

          <s-button
            variant="primary"
            onClick={createBundle}
            {...(isSaving ? { loading: true } : {})}
            {...(!title || selectedProducts.length === 0
              ? { disabled: true }
              : {})}
          >
            Save bundle
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Existing bundles">
        {bundles.length === 0 ? (
          <s-paragraph>No bundles yet. Create one above.</s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Title</s-table-header>
              <s-table-header>Badge</s-table-header>
              <s-table-header>Price</s-table-header>
              <s-table-header>Products</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {bundles.map((bundle) => (
                <s-table-row key={bundle.id}>
                  <s-table-cell>{bundle.title?.value}</s-table-cell>
                  <s-table-cell>{bundle.badgeText?.value}</s-table-cell>
                  <s-table-cell>{bundle.price?.value}</s-table-cell>
                  <s-table-cell>
                    {(bundle.products?.references?.nodes || [])
                      .map((p) => p.title)
                      .join(", ")}
                  </s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => deleteBundle(bundle.id)}
                    >
                      Delete
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}
