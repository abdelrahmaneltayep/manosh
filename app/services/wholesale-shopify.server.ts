/**
 * F6 — best-effort Shopify customer tagging on approval. Adds `b2b-approved` to
 * the matching customer so the storefront can gate trade pricing. Requires
 * `write_customers`. This is deliberately guarded and NEVER throws into the
 * approval flow: if the applicant isn't yet a Shopify customer, it no-ops.
 */

const FIND_CUSTOMER = `#graphql
  query FindCustomer($q: String!) {
    customers(first: 1, query: $q) { nodes { id } }
  }
`;
const TAGS_ADD = `#graphql
  mutation AddTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { message } }
  }
`;

export async function tagCustomerApproved(
  shopDomain: string,
  email: string,
  tag: string,
): Promise<{ tagged: boolean }> {
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(shopDomain);

  const found = await admin.graphql(FIND_CUSTOMER, {
    variables: { q: `email:${email}` },
  });
  const body = (await found.json()) as { data?: { customers?: { nodes?: Array<{ id: string }> } } };
  const id = body.data?.customers?.nodes?.[0]?.id;
  if (!id) return { tagged: false };

  await admin.graphql(TAGS_ADD, { variables: { id, tags: [tag] } });
  return { tagged: true };
}
