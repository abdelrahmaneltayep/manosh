import { Link } from "@remix-run/react";
import { APP_STORE_URL } from "../lib/app-store";
import { useEffect } from "react";

/**
 * Shared pieces of the public marketing pages (/, /pricing, /demo/store):
 * header, footer, the features block, and the reveal-on-scroll hook.
 * Styles live in app/styles/landing.css. No Polaris here — these pages are
 * public and never depend on a Shopify session.
 */

/** Marks the document as scripted and reveals `.rv` elements as they scroll
 *  into view. Without JS the CSS keeps everything visible. */
export function useReveal() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("js");
    const els = Array.from(document.querySelectorAll<HTMLElement>(".rv"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((x) => {
          if (x.isIntersecting) {
            x.target.classList.add("in");
            io.unobserve(x.target);
          }
        });
      },
      { threshold: 0.1 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

export function LandingHeader({ cta }: { cta?: { to: string; label: string } }) {
  const button = cta ?? { to: APP_STORE_URL, label: "Install on Shopify" };
  return (
    <header className="l-top">
      <div className="l-wrap">
        <Link to="/" className="l-brand" aria-label="Mannon home">
          <img src="/landing/logo.png" alt="" width={34} height={34} />
          Mannon
        </Link>
        <nav className="l-menu" aria-label="Main">
          <Link to="/demo/store">Demo store</Link>
          <Link to="/#s1">The journey</Link>
          <Link to="/#features">Features</Link>
          <Link to="/pricing">Pricing</Link>
        </nav>
        {/^https?:/.test(button.to) ? (
          <a className="l-btn sm" href={button.to}>
            {button.label}
          </a>
        ) : (
          <Link className="l-btn sm" to={button.to}>
            {button.label}
          </Link>
        )}
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="l-foot">
      <div className="l-wrap">
        <div>
          <Link to="/" className="l-brand" aria-label="Mannon home">
            <img src="/landing/logo.png" alt="" width={34} height={34} />
            Mannon
          </Link>
          <p className="l-muted" style={{ marginTop: 10 }}>B2B quoting and reorders for Shopify merchants.</p>
          <p className="l-muted">Built on Shopify’s native B2B — every price comes from Shopify.</p>
          <p className="l-note">Demo store product photos from Unsplash.</p>
        </div>
        <div>
          <b>Storefront</b>
          <Link to="/demo/store">Add to Quote</Link>
          <Link to="/demo/store">Make an Offer</Link>
          <Link to="/demo/store">Request a Quote</Link>
          <Link to="/demo/store">Price gate</Link>
        </div>
        <div>
          <b>Merchant</b>
          <Link to="/demo/tour">Quote inbox</Link>
          <Link to="/demo/tour">Draft with Claude</Link>
          <Link to="/demo/tour">Analytics</Link>
          <Link to="/pricing">Pricing plans</Link>
        </div>
        <div>
          <b>Buyers</b>
          <Link to="/demo">Buyer portal</Link>
          <Link to="/demo">Reorder</Link>
          <Link to="/demo">Order pad</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}

/** The six-feature grid, four how-it-works steps and the facts band. The facts
 *  are product facts, never traction numbers. */
export function FeaturesBlock({ buyerHref }: { buyerHref: string }) {
  return (
    <section className="l-section l-feat" id="features" aria-labelledby="features-h">
      <div className="l-wrap">
        <div className="eyebrow">Features</div>
        <h2 className="l-h2" id="features-h">
          Everything you need to quote, from storefront to draft order
        </h2>
        <p className="sub">Quote, counter, accept and reorder, on Shopify’s native B2B.</p>
        <div className="grid">
          <Feature ic="+" title="Add to Quote & Make an Offer" where="Storefront · theme editor" href="/demo/store" link="See it on a product page →">
            Theme blocks for product, collection and cart pages. Buyers build a quote like a cart, name a price, or turn a cart into a quote in one click.
          </Feature>
          <Feature ic="◐" title="Custom pricing & price gate" where="Admin · Pricing & catalog" href="/demo/tour" link="Learn more →" delay="d1">
            Company price lists, price rules and catalogs. Hide wholesale prices from guests with “Log in for wholesale pricing” without hiding products.
          </Feature>
          <Feature ic="☰" title="Quote forms & wholesale application" where="Admin · Quote forms" href="/demo/tour" link="Learn more →" delay="d2">
            Custom request forms with your own fields, file upload and a message. A wholesale application with an approval queue and auto-approve rules.
          </Feature>
          <Feature ic="✦" title="Quote inbox with Draft with Claude" where="Admin · Quotes" href="/demo/tour" link="See the inbox →">
            Every request with status, follow-ups and Totals from Shopify. Claude drafts counters and add-ons; you review and send. It never acts on its own.
          </Feature>
          <Feature ic="$" title="PDF, net terms & draft orders" where="Shopify · Orders → Drafts" href="/demo/tour" link="See a draft order →" delay="d1">
            Branded quote PDFs by download or email. Accepting creates a Shopify draft order with PO number, Net 30 and payment due later. Deposits and pay-by-link on Growth.
          </Feature>
          <Feature ic="↻" title="Buyer portal, reorder & order pad" where="Portal · no login" href={buyerHref} link="Open the buyer demo →" delay="d2">
            Passwordless quote history, one-tap reorder re-priced live, an order pad that reads SKUs, CSV or a pasted PO. English, Arabic and French.
          </Feature>
        </div>

        <h2 className="l-h2" style={{ marginTop: 56 }}>
          How it works
        </h2>
        <div className="steps">
          <div className="s rv"><i>1</i><b>Buyers add products and send a request</b>From Add to Quote, Make an Offer or the quote form. Email and company only.</div>
          <div className="s rv d1"><i>2</i><b>You review and counter</b>In the inbox, with Totals from Shopify. Claude drafts the counter; you decide.</div>
          <div className="s rv d2"><i>3</i><b>Send the quote with pricing and terms</b>The buyer gets a passwordless link and a PDF. Follow-ups go out on your schedule.</div>
          <div className="s rv d3"><i>4</i><b>The buyer accepts and Shopify orders</b>Net 30 from your templates, then a draft order with the PO. Reorder in one tap later.</div>
        </div>

        <div className="facts rv">
          <div><b>4 min</b><span>Request to draft order in the demo</span></div>
          <div><b>1 tap</b><span>To reorder a past order</span></div>
          <div><b>0</b><span>Prices calculated by the app. All from Shopify.</span></div>
          <div><b>3</b><span>Portal languages: English, Arabic, French</span></div>
        </div>
      </div>
    </section>
  );
}

function Feature({
  ic, title, where, href, link, delay, children,
}: {
  ic: string; title: string; where: string; href: string; link: string; delay?: string; children: React.ReactNode;
}) {
  return (
    <div className={`f rv ${delay ?? ""}`}>
      <div className="ic" aria-hidden="true">{ic}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      <span className="where">{where}</span>
      <Link to={href}>{link}</Link>
    </div>
  );
}
