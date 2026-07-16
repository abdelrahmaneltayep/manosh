// Liveness probe. Deliberately dependency-free: no DB, no Shopify auth — a
// bare "is the server up?" check that load balancers / uptime monitors can hit.
export const loader = () => {
  return new Response("ok", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
};
