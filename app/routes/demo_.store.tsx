import type { HeadersFunction, LinksFunction, MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

import { isDemoEnabled } from "../services/demo.server";
import landingStyles from "../styles/landing.css?url";
import storeStyles from "../styles/landing-store.css?url";

/**
 * /demo/store — a sample storefront product page (Harbor Roasters Wholesale)
 * with Mannon's storefront blocks the way a buyer meets them: Add to Quote,
 * Make an Offer, Request a Quote, volume breaks from the company catalog, the
 * guest price gate, the floating Quote tab and the three-step request.
 *
 * It is a mock of the theme blocks, not a connected store: nothing here calls
 * Shopify, and the request never leaves the page. The last step hands off to
 * the live buyer demo (or the merchant tour when the demo store is off).
 * Standalone route (demo_.store) so it does not inherit the /demo shell.
 */

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: landingStyles },
  { rel: "stylesheet", href: storeStyles },
];

export const meta: MetaFunction = () => [
  { title: "Harbor Roasters Wholesale — demo store · Mannon" },
  { name: "description", content: "A sample wholesale product page with Mannon's Add to Quote, Make an Offer, Request a Quote and price gate blocks. Try the three-step quote request." },
];

export const headers: HeadersFunction = () => ({
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
});

export const loader = async () => ({ buyerLive: isDemoEnabled() });

const PRODUCT = {
  name: "Harbor Blend Espresso, 1 kg",
  price: "USD 21.50",
  roasts: ["Medium", "Dark", "Decaf (Swiss Water)"],
  gallery: [
    { src: "/landing/p-espresso.jpg", alt: "Harbor Blend Espresso: freshly ground espresso in a portafilter beside whole beans" },
    { src: "/landing/p-pour.jpg", alt: "Roasted beans pouring into a cup" },
    { src: "/landing/p-latte.jpg", alt: "Latte pour in a café" },
  ],
};

const ALSO = [
  { name: "Guji Natural, Ethiopia, 1 kg", price: "USD 27.80 / bag · case of 12", img: "/landing/p-beans.jpg", alt: "Roasted coffee beans" },
  { name: "Cold Brew Concentrate, 5 L", price: "USD 42.00 / box · case of 4", img: "/landing/p-coldbrew.jpg", alt: "Iced cold brew with milk" },
  { name: "Compostable Cups 12 oz, 1,000", price: "USD 96.00 / case", img: "/landing/p-cups.jpg", alt: "Paper coffee cups on a tray" },
  { name: "Barista Oat Milk, 1 L × 12", price: "USD 28.90 / case", img: "/landing/p-oatmilk.jpg", alt: "Milk being poured into a glass", was: "USD 31.00" },
];

type Line = { name: string; detail: string; qty: number; img: string };

export default function DemoStore() {
  const { buyerLive } = useLoaderData<typeof loader>();
  const nextHref = buyerLive ? "/demo/buyer" : "/demo/tour";
  const [guest, setGuest] = useState(false);
  const [roast, setRoast] = useState(PRODUCT.roasts[0]);
  const [qty, setQty] = useState(12);
  const [main, setMain] = useState(0);
  const [lines, setLines] = useState<Line[]>([
    { name: PRODUCT.name, detail: "Medium roast · USD 21.50", qty: 12, img: PRODUCT.gallery[0].src },
  ]);
  const [offer, setOffer] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const add = (name: string, detail: string, img: string) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.name === name);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: l.qty + qty } : l));
      return [...ls, { name, detail, qty, img }];
    });
    setStep(1);
    setOpen(true);
  };

  const show = (n: number) => {
    setStep(n);
    setOpen(true);
  };

  return (
    <>
      <div className="st-back">
        <Link to="/">← Back to Mannon</Link>
        <span>You’re in the demo store · a sample buyer at a sample store · nothing is charged</span>
        <Link to="/pricing">Pricing</Link>
      </div>
      <div className="st-ann">
        Wholesale buyers: <b>Net 30</b> on every quote · reorder in one tap · prices from your company catalog
      </div>
      <header className="st-head">
        <div className="l-wrap">
          <span className="logo">Harbor Roasters Wholesale</span>
          <nav aria-label="Store">
            <span>Coffee</span><span>Cold brew</span><span>Café supplies</span><span>Request a quote</span><span>Your quotes</span><span>Wholesale application</span>
          </nav>
          <span className="l-note">Search · Account · Cart</span>
        </div>
      </header>

      <main className="l-wrap">
        <div className="st-pdp">
          <div className="st-gallery">
            <div className="main">
              <img src={PRODUCT.gallery[main].src} alt={PRODUCT.gallery[main].alt} width={900} height={900} />
            </div>
            <div className="thumbs">
              {PRODUCT.gallery.map((g, i) => (
                <button key={g.src} type="button" aria-pressed={i === main} aria-label={`Show photo ${i + 1}`} onClick={() => setMain(i)}>
                  <img src={g.src} alt="" loading="lazy" width={300} height={300} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="st-crumb">Harbor Roasters · Espresso</span>
            <h1>{PRODUCT.name}</h1>
            {guest ? (
              <div className="st-gate">Log in for wholesale pricing · <u>Request a quote</u></div>
            ) : (
              <div className="st-price">
                {PRODUCT.price} <span className="tier">Bluebird Cafés price</span>
              </div>
            )}
            <div className="st-lbl" id="roast-l">Roast</div>
            <div className="st-pills" role="group" aria-labelledby="roast-l">
              {PRODUCT.roasts.map((r) => (
                <button key={r} type="button" aria-pressed={r === roast} onClick={() => setRoast(r)}>{r}</button>
              ))}
            </div>
            <label className="st-lbl" htmlFor="qty">Quantity</label>
            <div className="st-qty">
              <button type="button" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <input id="qty" value={qty} inputMode="numeric" onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
              <button type="button" aria-label="Increase quantity" onClick={() => setQty((q) => q + 1)}>+</button>
            </div>
            <div className="st-acts">
              <button className="st-btn primary" type="button" onClick={() => add(PRODUCT.name, `${roast} roast · ${PRODUCT.price}`, PRODUCT.gallery[0].src)}>Add to Quote</button>
              <button className="st-btn" type="button" onClick={() => { setOffer(true); show(1); }}>Make an Offer</button>
              <button className="st-btn lime" type="button" onClick={() => show(1)}>Request a Quote</button>
            </div>
            <div className="st-breaks" aria-label="Volume pricing">
              <div><span>1 to 11 bags</span><span>USD 21.50</span></div>
              <div><span>12 to 47 bags (1 to 3 cases)</span><b>USD 19.90</b></div>
              <div><span>48+ bags (4 cases and up)</span><b>USD 18.20</b></div>
            </div>
            <p className="l-note" style={{ marginTop: 12 }}>
              Case of 12 bags. Volume breaks and the price shown come from this company’s Shopify catalog. Tax and totals are calculated by Shopify when the quote is accepted.
            </p>
            <div className="st-preview">
              Preview as: <button type="button" onClick={() => setGuest(false)}>logged-in buyer</button> · <button type="button" onClick={() => setGuest(true)}>guest (price gate on)</button>
            </div>
          </div>
        </div>

        <section className="st-also" aria-labelledby="also-h">
          <h2 className="l-h3" id="also-h">Popular products</h2>
          <p className="l-muted">Browse products and request a quote in seconds.</p>
          <div className="g">
            {ALSO.map((p) => (
              <div className="p" key={p.name}>
                <div className="im"><img src={p.img} alt={p.alt} loading="lazy" width={900} height={900} /></div>
                <h3>{p.name}</h3>
                <div className="pr">{p.was ? <><s>{p.was}</s> </> : null}{p.price}</div>
                <button className="st-btn" type="button" onClick={() => add(p.name, p.price, p.img)}>Add to Quote</button>
              </div>
            ))}
          </div>
          <p className="l-note" style={{ marginTop: 24 }}>
            Product photos from <a href="https://unsplash.com">Unsplash</a>, used under the Unsplash License. Sample catalog; not a real store.
          </p>
        </section>
      </main>

      <button className="st-tab" type="button" onClick={() => show(step)} aria-haspopup="dialog" aria-expanded={open}>
        Quote ({lines.length})
      </button>

      {open && (
        <>
          <button className="st-ov" type="button" aria-label="Close the quote request" onClick={() => setOpen(false)} />
          <aside className="st-dr" role="dialog" aria-modal="true" aria-labelledby="dr-h">
            <div className="hd">
              <div>
                <h2 id="dr-h">Request a quote</h2>
                <div className="l-note">Tell us what you need. You’ll get a passwordless link to your quote.</div>
              </div>
              <button className="x" type="button" aria-label="Close" ref={closeRef} onClick={() => setOpen(false)}>×</button>
            </div>
            <ol className="st-stp">
              {["Products", "Contact", "Review"].map((s, i) => (
                <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={step > i + 1 ? "done" : undefined}>
                  <i aria-hidden="true">{i + 1}</i>{s}
                </li>
              ))}
            </ol>
            <div className="bd">
              {step === 1 && (
                <div>
                  {lines.map((l) => (
                    <div className="st-line" key={l.name}>
                      <div className="th"><img src={l.img} alt="" /></div>
                      <div className="n"><b>{l.name}</b><span>{l.detail}</span></div>
                      <input aria-label={`Quantity for ${l.name}`} value={l.qty} inputMode="numeric" onChange={(e) => setLines((ls) => ls.map((x) => (x.name === l.name ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} />
                      <button className="del" type="button" onClick={() => setLines((ls) => ls.filter((x) => x.name !== l.name))}>Remove</button>
                    </div>
                  ))}
                  {lines.length === 0 && <p className="l-muted">Your quote is empty. Add a product to continue.</p>}
                  {offer && (
                    <div className="st-off">Your offer: <b>USD 18.50</b> per bag on Harbor Blend Espresso. The merchant sees this as an offer, not a discount code.</div>
                  )}
                  <p className="l-note" style={{ marginTop: 14 }}>
                    Quantities and variants come straight from the product page. Nothing is priced until the merchant replies, and all totals come from Shopify.
                  </p>
                </div>
              )}
              {step === 2 && (
                <div className="st-frm">
                  <div className="st-off">Already a buyer? Open your portal link and your company fills in automatically.</div>
                  <div className="two">
                    <label>First name<input defaultValue="Noor" /></label>
                    <label>Last name<input defaultValue="Haddad" /></label>
                  </div>
                  <label>Work email<input defaultValue="noor@bluebirdcafes.example" type="email" /></label>
                  <label>Company<input defaultValue="Bluebird Cafés" /></label>
                  <label>Payment terms you’d like<select defaultValue="Net 30"><option>Net 30</option><option>Net 60</option><option>Due on receipt</option></select></label>
                  <label>PO number (optional)<input placeholder="BB-PO-0931" /></label>
                  <label>Attach a file (optional)<input type="file" /></label>
                  <label>Message (optional)<textarea rows={3} placeholder="Anything we should know?" /></label>
                </div>
              )}
              {step === 3 && (
                <div>
                  <div className="st-sum">
                    {lines.map((l) => (
                      <div key={l.name}><span>{l.name}</span><span>× {l.qty}</span></div>
                    ))}
                    <div><span>Contact</span><span>Noor Haddad · Bluebird Cafés</span></div>
                    <div><span>Terms requested</span><span>Net 30</span></div>
                  </div>
                  <p className="l-note" style={{ marginTop: 12 }}>
                    Sending creates a quote in the merchant’s inbox. You’ll get an email with a link to your portal, no password needed.
                  </p>
                </div>
              )}
              {step === 4 && (
                <div className="st-done" role="status">
                  <div className="ok" aria-hidden="true">✓</div>
                  <h3 className="l-h3">Quote request sent</h3>
                  <p className="l-muted">
                    This page is a sample of the storefront blocks, so nothing was sent. The live buyer demo opens a real portal with a countered quote waiting for you.
                  </p>
                  <div className="l-ctas">
                    <Link className="l-btn" to={nextHref}>See what happens next</Link>
                    <Link className="l-btn ghost" to="/">Back to Mannon</Link>
                  </div>
                </div>
              )}
            </div>
            {step < 4 && (
              <div className="ft">
                <button className="st-btn" type="button" onClick={() => (step === 1 ? setOpen(false) : setStep(step - 1))}>
                  {step === 1 ? "Continue shopping" : "Previous step"}
                </button>
                <button className="st-btn primary" type="button" disabled={step === 1 && lines.length === 0} onClick={() => setStep(step + 1)}>
                  {step === 3 ? "Send quote request" : "Next step"}
                </button>
              </div>
            )}
          </aside>
        </>
      )}
    </>
  );
}
