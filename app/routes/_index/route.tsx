import type { HeadersFunction, LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { useEffect } from "react";

import { login } from "../../shopify.server";
import { isDemoEnabled } from "../../services/demo.server";
import { FeaturesBlock, LandingFooter, LandingHeader, useReveal } from "../../components/landing";
import landingStyles from "../../styles/landing.css?url";
import homeStyles from "../../styles/landing-home.css?url";

/**
 * Public home (manosh.fly.dev): the guided journey from a buyer's first click
 * to a Shopify draft order, the demo store section, the features block, and
 * the merchant login. ?shop= still hands off to the embedded app.
 */

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: landingStyles },
  { rel: "stylesheet", href: homeStyles },
];

export const meta: MetaFunction = () => [
  { title: "Mannon — B2B quotes and reorders for Shopify" },
  {
    name: "description",
    content:
      "Quote, counter with Claude, accept with net terms and reorder in one tap, on Shopify's native B2B draft orders. Try the demo store, no install, no sign-up.",
  },
];

export const headers: HeadersFunction = () => ({ "Cache-Control": "no-store" });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login), buyerLive: isDemoEnabled() };
};

const STEPS = [
  { id: "s1", short: "Request", who: "Buyer · storefront", title: "A buyer asks for a quote", body: "On the product page: Add to Quote, Make an Offer, or Request a Quote. Email and company, no account.", img: "/landing/store-product.png", alt: "Demo store product page with Add to Quote, Make an Offer and Request a Quote", chrome: "harbor-roasters-wholesale.myshopify.com/products/harbor-blend-espresso", try: { to: "/demo/store", label: "Try this step", note: "Opens the demo store's product page" } },
  { id: "s2", short: "Inbox", who: "Merchant · admin", title: "It lands in one inbox", body: "Every request, with its company, buyer and status. New, Countered, Ordered. No email thread to dig through.", img: "/landing/inbox.png", alt: "Quote inbox", tour: true },
  { id: "s3", short: "Priced by Shopify", who: "Merchant · admin", title: "Priced by Shopify, not by the app", body: "The Totals from Shopify card shows subtotal, tax and total for this buyer's company. Mannon never calculates money itself.", img: "/landing/quote-totals.png", alt: "Quote with Totals from Shopify", tour: true },
  { id: "s4", short: "✦ Draft with Claude", who: "Merchant · admin", title: "Draft with Claude", claude: true, body: "Claude drafts a counter price and a note for every line. You pick “Use this price” and click Send counter.", rule: "Claude drafts. You review and send. It never acts on its own.", img: "/landing/claude-draft.png", alt: "Draft with Claude", tour: true },
  { id: "s5", short: "Portal", who: "Buyer · portal", title: "A portal with no password", body: "One link per buyer, and it expires. Inside: the countered quote, a reorder card from a real order, an order pad, invoices on net terms.", img: "/landing/portal.png", alt: "Buyer portal", chrome: "manosh.fly.dev/portal · Incognito", buyer: { label: "Try this step", note: "You become a sample buyer" } },
  { id: "s6", short: "Accept", who: "Buyer · portal", title: "Accept, with Net 30", body: "Pick the payment terms from the store's own templates, click Accept, then confirm. Nothing is written until the buyer confirms.", img: "/landing/portal-ordered.png", alt: "Quote ordered with Shopify totals", chrome: "manosh.fly.dev/portal/quotes/… · Incognito", buyer: { label: "Try this step" } },
  { id: "s7", short: "Draft order", who: "Merchant · Shopify", title: "A real Shopify draft order", body: "PO number, company, net terms. Straight into Orders → Drafts. Nothing to copy over.", img: "/landing/draft-order.png", alt: "Shopify draft order", tour: true },
  { id: "s8", short: "Reorder", who: "Buyer · portal", title: "Weeks later: one-tap reorder", body: "A past order becomes a reorder card. Shopify re-prices it today; within your tolerance it's a draft order, otherwise you review it first. The order pad reads a pasted PO with Claude.", img: "/landing/order-pad.png", alt: "Order pad", chrome: "manosh.fly.dev/portal/quick-order · Incognito", buyer: { label: "Try this step" } },
] as const;

export default function Home() {
  const { showForm, buyerLive } = useLoaderData<typeof loader>();
  const buyerHref = buyerLive ? "/demo/buyer" : "/demo";
  useReveal();
  useProgress();

  return (
    <>
      <LandingHeader />

      <section className="h-hero">
        <div className="l-wrap">
          <span className="l-pill rv">Try before you install · no sign-up</span>
          <h1 className="l-h1">
            <span className="w">From a</span> <span className="w">buyer’s first click</span>{" "}
            <span className="w">to a</span> <span className="w l-hl">Shopify draft order</span>
          </h1>
          <p className="l-lead rv d2">
            Eight steps, every one of them a real screen. Scroll the story, or jump into the live demo at any step.
          </p>
          <div className="l-ctas rv d3">
            <a className="l-btn" href="#s1">Start the journey</a>
            <Link className="l-btn ghost" to="/demo/store">Open the demo store</Link>
          </div>
        </div>
      </section>

      <nav className="h-progress" aria-label="Journey steps">
        <div className="l-wrap">
          {STEPS.map((s, i) => (
            <a key={s.id} href={`#${s.id}`} className={i === 0 ? "on" : undefined}>
              {i + 1} {s.short}
            </a>
          ))}
        </div>
      </nav>

      {STEPS.map((s, i) => (
        <div className={`h-step${i % 2 ? " even" : ""}${i === 0 ? " on" : ""}`} id={s.id} key={s.id}>
          <div className="l-wrap">
            <div className="copy rv">
              <span className="h-num" aria-hidden="true">{i + 1}</span>
              <span className="h-who">{s.who}</span>
              <h2 className="l-h2">
                {"claude" in s && s.claude ? <><span className="l-claude">✦</span> </> : null}
                {s.title}
              </h2>
              <p className="l-lead">{s.body}</p>
              {"rule" in s && s.rule ? <div className="h-rule">{s.rule}</div> : null}
              <div className="h-try">
                {"try" in s && s.try ? (
                  <>
                    <Link className="l-btn sm" to={s.try.to}>{s.try.label}</Link>
                    <span className="l-note">{s.try.note}</span>
                  </>
                ) : null}
                {"buyer" in s && s.buyer ? (
                  <>
                    <Link className="l-btn sm" to={buyerHref}>{s.buyer.label}</Link>
                    {"note" in s.buyer && s.buyer.note ? <span className="l-note">{s.buyer.note}</span> : null}
                  </>
                ) : null}
                {"tour" in s && s.tour ? (
                  <Link className="l-btn sm ghost" to="/demo/tour">See this screen in the tour</Link>
                ) : null}
              </div>
            </div>
            <div className="vis rv d1">
              <div className="l-shot">
                {"chrome" in s && s.chrome ? (
                  <div className="l-chrome" aria-hidden="true"><i /><i /><i /><span>{s.chrome}</span></div>
                ) : null}
                <img src={s.img} alt={s.alt} loading={i === 0 ? "eager" : "lazy"} width={1440} height={810} />
              </div>
            </div>
          </div>
        </div>
      ))}

      <section className="h-store" id="store" aria-labelledby="store-h">
        <div className="l-wrap">
          <div className="hd">
            <div className="rv">
              <span className="l-kicker">Demo store</span>
              <h2 className="l-h2" id="store-h">Shop it like a wholesale buyer</h2>
              <p className="l-lead">
                Harbor Roasters Wholesale is a sample store with Mannon’s theme blocks switched on. Add products to a quote, name a price, or send a request with your terms. Nothing is charged.
              </p>
              <div className="h-blocks">
                <span>Add to Quote</span><span>Make an Offer</span><span>Request a Quote</span><span>Price gate</span><span>Convert cart to quote</span>
              </div>
              <div className="l-ctas" style={{ justifyContent: "flex-start" }}>
                <Link className="l-btn" to="/demo/store">Open the demo store</Link>
                <Link className="l-btn ghost" to="/demo/store">See the 3-step request</Link>
              </div>
            </div>
            <div className="mock rv d1">
              <div className="l-crop h-float">
                <img src="/landing/crop-store.png" alt="Demo store product page: Add to Quote, Make an Offer, Request a Quote and volume breaks" loading="lazy" />
                <div className="lbl">Product page · Mannon blocks</div>
              </div>
              <span className="tab" aria-hidden="true">Quote (1)</span>
            </div>
          </div>
          <div className="h-pg">
            <Product img="/landing/p-espresso.jpg" alt="Ground espresso and beans" name="Harbor Blend Espresso, 1 kg" price="USD 21.50 / bag · case of 12" cta="Add to Quote" primary />
            <Product img="/landing/p-beans.jpg" alt="Roasted coffee beans" name="Guji Natural, Ethiopia, 1 kg" price="USD 27.80 / bag · case of 12" cta="Add to Quote" primary delay="d1" />
            <Product img="/landing/p-coldbrew.jpg" alt="Iced cold brew" name="Cold Brew Concentrate, 5 L" price="USD 42.00 / box · case of 4" cta="Make an Offer" delay="d2" />
            <Product img="/landing/p-decaf.jpg" alt="Black coffee in a glass cup" name="Decaf Harbor Blend, 1 kg" gate cta="Request a Quote" delay="d3" />
          </div>
        </div>
      </section>

      <FeaturesBlock buyerHref={buyerHref} />

      <section className="h-end" id="end">
        <div className="l-wrap">
          <h2 className="l-h2 rv">That’s the whole loop.</h2>
          <p className="l-lead rv d1" style={{ margin: "0 auto 20px" }}>
            Quote, accept, reorder, on native Shopify draft orders. Try it as a buyer now, or install on your store.
          </p>
          <div className="l-ctas rv d2">
            <Link className="l-btn" to="/demo/store">Open the demo store</Link>
            <Link className="l-btn ghost" to="/demo/tour">Start the merchant tour</Link>
            <Link className="l-btn ghost" to="/pricing">See pricing</Link>
          </div>

          {showForm && (
            <div className="h-login rv d3">
              <span className="l-kicker">Already a merchant?</span>
              <Form method="post" action="/auth/login">
                <label>
                  Shop domain
                  <input type="text" name="shop" placeholder="my-shop-domain.myshopify.com" aria-describedby="shop-hint" />
                </label>
                <div className="row">
                  <button className="l-btn sm" type="submit">Log in</button>
                  <span id="shop-hint" className="l-note">e.g. my-shop-domain.myshopify.com</span>
                </div>
              </Form>
            </div>
          )}
        </div>
      </section>

      <LandingFooter />
    </>
  );
}

function Product({ img, alt, name, price, gate, cta, primary, delay }: { img: string; alt: string; name: string; price?: string; gate?: boolean; cta: string; primary?: boolean; delay?: string }) {
  return (
    <div className={`p rv ${delay ?? ""}`}>
      <div className="im"><img src={img} alt={alt} loading="lazy" width={900} height={900} /></div>
      <h3>{name}</h3>
      {gate ? <div className="gate">Log in for wholesale pricing</div> : <div className="pr">{price}</div>}
      <Link className={primary ? "primary" : undefined} to="/demo/store">{cta}</Link>
    </div>
  );
}

/** Highlights the current step in the sticky progress bar and lights the step
 *  badges as the reader scrolls. */
function useProgress() {
  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".h-progress a"));
    const steps = links.map((a) => document.querySelector<HTMLElement>(a.getAttribute("href") ?? ""));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sync = () => {
      let i = 0;
      steps.forEach((s, k) => { if (s && s.getBoundingClientRect().top < 220) i = k; });
      links.forEach((a, k) => {
        const on = k === i;
        if (on && !a.classList.contains("on")) {
          a.classList.add("on");
          a.style.animation = "none";
          void a.offsetWidth;
          a.style.animation = "";
        } else if (!on) a.classList.remove("on");
      });
      steps.forEach((s, k) => s?.classList.toggle("on", k <= i));
    };
    const onClick = (e: Event) => {
      const a = e.currentTarget as HTMLAnchorElement;
      const t = document.querySelector<HTMLElement>(a.getAttribute("href") ?? "");
      if (t && !reduce) {
        e.preventDefault();
        window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 120, behavior: "smooth" });
      }
    };
    window.addEventListener("scroll", sync, { passive: true });
    links.forEach((a) => a.addEventListener("click", onClick));
    sync();
    return () => {
      window.removeEventListener("scroll", sync);
      links.forEach((a) => a.removeEventListener("click", onClick));
    };
  }, []);
}
