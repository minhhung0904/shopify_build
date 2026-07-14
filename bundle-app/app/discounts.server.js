const BUNDLE_DISCOUNT_TITLE = "Bundle discounts";

// Registers the app's Cart Transform function on the shop so bundles whose
// container variant is set are actually merged into one cart line at checkout.
// Unlike discounts, a cart transform only runs once activated with
// cartTransformCreate. Idempotent + never throws (mirrors
// activateBundleDiscount): safe to call on every auth and on app load.
export async function activateBundleCartTransform(admin) {
  try {
    const functionsResponse = await admin.graphql(
      `#graphql
        query BundleCartTransformFunctions {
          shopifyFunctions(first: 25) {
            nodes {
              id
              apiType
            }
          }
        }`,
    );
    const functionsJson = await functionsResponse.json();
    const transformFunction = (
      functionsJson.data?.shopifyFunctions?.nodes || []
    ).find((node) => node.apiType === "cart_transform");
    if (!transformFunction) return;

    const existingResponse = await admin.graphql(
      `#graphql
        query ExistingCartTransform {
          cartTransforms(first: 10) {
            nodes { id functionId }
          }
        }`,
    );
    const existingJson = await existingResponse.json();
    const alreadyActive = (
      existingJson.data?.cartTransforms?.nodes || []
    ).some((node) => node.functionId === transformFunction.id);
    if (alreadyActive) return;

    const createResponse = await admin.graphql(
      `#graphql
        mutation ActivateBundleCartTransform($functionId: String!) {
          cartTransformCreate(functionId: $functionId, blockOnFailure: false) {
            cartTransform { id }
            userErrors { field message }
          }
        }`,
      { variables: { functionId: transformFunction.id } },
    );
    const createJson = await createResponse.json();
    const userErrors =
      createJson.data?.cartTransformCreate?.userErrors || [];
    if (userErrors.length) {
      console.error("cartTransformCreate userErrors", userErrors);
    }
  } catch (error) {
    console.error("Failed to activate bundle cart transform function", error);
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
