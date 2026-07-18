// Shown when someone reaches the portal without a valid session. There is no
// password form by design — access is entirely via the merchant-issued magic
// link.
export default function PortalSignin() {
  return (
    <section className="portal-card">
      <h1>Check your email</h1>
      <p className="muted">
        Your wholesale portal is passwordless. Open the sign-in link your
        supplier emailed you to get in.
      </p>
      <p className="muted">
        If your link has expired, ask your supplier to send a new one.
      </p>
    </section>
  );
}
