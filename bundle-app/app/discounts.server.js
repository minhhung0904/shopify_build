const BUNDLE_DISCOUNT_TITLE = "Bundle discounts";

// Removes any cart transform this app registered on the shop, so bundles add
// as separate line items discounted by the discount function (the daveslamps /
// Kaching architecture) rather than being merged into one line. Idempotent +
// never throws: safe to call on every auth and on app load. Kept as a cleanup
// after the merge feature was removed.
export async function deactivateBundleCartTransform(admin) {
  try {
    const existingResponse = await admin.graphql(
      `#graphql
        query ExistingCartTransforms {
          cartTransforms(first: 50) {
            nodes { id }
          }
        }`,
    );
    const existingJson = await existingResponse.json();
    const nodes = existingJson.data?.cartTransforms?.nodes || [];
    for (const node of nodes) {
      const deleteResponse = await admin.graphql(
        `#graphql
          mutation DeleteBundleCartTransform($id: ID!) {
            cartTransformDelete(id: $id) {
              deletedId
              userErrors { field message }
            }
          }`,
        { variables: { id: node.id } },
      );
      const deleteJson = await deleteResponse.json();
      const userErrors =
        deleteJson.data?.cartTransformDelete?.userErrors || [];
      if (userErrors.length) {
        console.error("cartTransformDelete userErrors", userErrors);
      }
    }
  } catch (error) {
    console.error("Failed to deactivate bundle cart transform", error);
  }
}

// Activates the app's discount function as an automatic discount so bundle
// prices configured in the admin are actually enforced at checkout, not just
// displayed. Runs after every OAuth grant (install + re-auth on scope
// updates); intentionally never throws so a hiccup here can't break install.
export async function activateBundleDiscount(admin) {
  try {
    const functionsResponse = await admin.graphql(
      `#graphql
        query BundleDiscountFunctions {
          shopifyFunctions(first: 25) {
            nodes {
              id
              apiType
              title
            }
          }
        }`,
    );
    const functionsJson = await functionsResponse.json();
    const bundleFunction = (
      functionsJson.data?.shopifyFunctions?.nodes || []
    ).find(
      (node) =>
        node.apiType === "discount" && node.title === BUNDLE_DISCOUNT_TITLE,
    );
    if (!bundleFunction) return;

    const existingResponse = await admin.graphql(
      `#graphql
        query ExistingBundleDiscount {
          discountNodes(first: 50, query: "method:automatic") {
            nodes {
              discount {
                __typename
                ... on DiscountAutomaticApp {
                  title
                }
              }
            }
          }
        }`,
    );
    const existingJson = await existingResponse.json();
    const alreadyActive = (
      existingJson.data?.discountNodes?.nodes || []
    ).some((node) => node.discount?.title === BUNDLE_DISCOUNT_TITLE);
    if (alreadyActive) return;

    const createResponse = await admin.graphql(
      `#graphql
        mutation ActivateBundleDiscount($discount: DiscountAutomaticAppInput!) {
          discountAutomaticAppCreate(automaticAppDiscount: $discount) {
            automaticAppDiscount { discountId }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          discount: {
            title: BUNDLE_DISCOUNT_TITLE,
            functionId: bundleFunction.id,
            startsAt: new Date().toISOString(),
            discountClasses: ["PRODUCT"],
            combinesWith: {
              orderDiscounts: true,
              productDiscounts: true,
              shippingDiscounts: true,
            },
          },
        },
      },
    );
    const createJson = await createResponse.json();
    const userErrors =
      createJson.data?.discountAutomaticAppCreate?.userErrors || [];
    if (userErrors.length) {
      console.error("discountAutomaticAppCreate userErrors", userErrors);
    }
  } catch (error) {
    console.error("Failed to activate bundle discount function", error);
  }
}
