import type { HeadersFunction, LinksFunction, MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { useState } from "react";

import { NO_PER_ORDER_FEES_COPY, PLANS, PLAN_DISPLAY_NAME } from "../lib/billing-v3";
import { comparisonRows, pricingCards } from "../lib/pricing-page";
import { FeaturesBlock, LandingFooter, LandingHeader, useReveal } from "../components/landing";
import landingStyles from "../styles/landing.css?url";
import pricingStyles from "../styles/landing-pricing.css?url";

/**
 * Public pricing page (no Shopify auth, no Polaris). Everything on it is
 * derived from the v3 ladder in app/lib/billing-v3.ts — the same source the
 * in-app Plans page and App Pricing use — so the story can't drift.
 */

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: landingStyles },
  { rel: "stylesheet", href: pricingStyles },
];

export const meta: MetaFunction = () => [
  { title: "Pricing — Mannon" },
  {
    name: "description",
    content:
      "Mannon pricing: Free, Starter $9, Growth $29 and Scale $69 per month, annual plans with two months free, 14-day free trials. No per-order fees, ever.",
  },
];

export const headers: HeadersFunction = () => ({ "Cache-Control": "no-store" });

const CARDS = pricingCards();
const ROWS = comparisonRows();

export default function Pricing() {
  const [annual, setAnnual] = useState(false);
  useReveal();

  return (
    <>
      <LandingHeader />

      <section className="pr-hero">
        <div className="l-wrap">
          <span className="l-pill rv">Pricing · no per-order fees, ever</span>
          <h1 className="l-h1 rv d1">
            Plans that grow with <span className="l-hl">your wholesale</span>
          </h1>
          <p className="l-lead rv d2">
            Start free. Upgrade when you need more companies, AI counters or net terms. {NO_PER_ORDER_FEES_COPY}
          </p>
          <div className="pr-toggle rv d3">
            <span className={annual ? "off" : undefined} id="bill-monthly">Monthly</span>
            <button
              type="button"
              className="pr-sw"
              role="switch"
              aria-checked={annual}
              aria-label="Bill annually"
              onClick={() => setAnnual((a) => !a)}
            />
            <span className={annual ? undefined : "off"} id="bill-annual">Annual</span>
            <span className="pr-save">2 months free</span>
          </div>
        </div>
      </section>

      <section className="l-section tight" id="plans" aria-label="Plans">
        <div className="l-wrap">
          <div className="pr-plans">
            {CARDS.map((c, i) => (
              <article className={`pr-plan rv d${i}${c.recommended ? " rec" : ""}`} key={c.handle} aria-labelledby={`plan-${c.handle}`}>
                {c.recommended && <span className="tag">Recommended</span>}
                <h2 id={`plan-${c.handle}`}>{c.name}</h2>
                <p className="for">{c.blurb}</p>
                <div className="price">
                  <span className={`pr-flip${annual ? " go" : ""}`} key={annual ? "a" : "m"}>
                    {annual && c.annualPerMonth ? c.annualPerMonth : c.monthly}
                  </span>
                  <small>/month</small>
                </div>
                <div className="per">
                  {c.annualTotal === null
                    ? "Free forever"
                    : annual
                      ? `${c.annualTotal} billed yearly · ${c.trialDays}-day free trial`
                      : `${c.trialDays}-day free trial`}
                </div>
                <ul>
                  {c.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                <Link className={`l-btn${c.recommended ? "" : " ghost"}`} to="/auth/login">
                  {c.handle === "free" ? "Install free" : "Start free trial"}
                </Link>
              </article>
            ))}
          </div>
          <p className="pr-trust">
            Billed through Shopify. Change or cancel any time from the Plans page in the app. Prices in USD. Shops on an
            earlier price keep it.
          </p>
        </div>
      </section>

      <section className="l-section" id="compare" aria-labelledby="compare-h">
        <div className="l-wrap">
          <h2 className="l-h2" id="compare-h" style={{ textAlign: "center", marginBottom: 20 }}>
            Compare plans
          </h2>
          <div className="pr-tw">
            <table className="pr-cmp">
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  {PLANS.map((h) => (
                    <th scope="col" key={h}>{PLAN_DISPLAY_NAME[h]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r, i) => (
                  <Row key={r.label} r={r} first={i === 0 || ROWS[i - 1].group !== r.group} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="l-section tight" id="faq" aria-labelledby="faq-h">
        <div className="l-wrap">
          <h2 className="l-h2" id="faq-h" style={{ textAlign: "center", marginBottom: 20 }}>
            Questions
          </h2>
          <div className="pr-faq">
            <details className="rv"><summary>Is there a per-order fee?</summary><p>No. Mannon is one flat monthly price. Shopify’s own transaction fees still apply to orders, as with any app.</p></details>
            <details className="rv d1"><summary>How does billing work?</summary><p>Through Shopify billing, on your Shopify invoice. Upgrade, downgrade or cancel from the Plans page inside the app.</p></details>
            <details className="rv d2"><summary>Does the price ever change on me?</summary><p>No. If you subscribed at an earlier price, that price is honored and your plan keeps or gains capabilities.</p></details>
            <details className="rv d3"><summary>Do I need Shopify’s B2B features?</summary><p>Yes. Mannon runs on Shopify’s native companies, catalogs, payment terms and draft orders, so your store needs native B2B turned on.</p></details>
            <details className="rv"><summary>What does the AI do on Growth and Scale?</summary><p>Claude drafts counter-offers and reads pasted purchase orders. Every output lands on a confirm screen; nothing is sent or written until you click.</p></details>
            <details className="rv d1"><summary>Can I try it before installing?</summary><p>Yes. The demo store lets you quote as a sample buyer, and the merchant tour walks the admin screens. No install, no sign-up.</p></details>
          </div>
        </div>
      </section>

      <FeaturesBlock buyerHref="/demo" />

      <section className="l-section tight">
        <div className="l-wrap">
          <div className="l-band rv">
            <div>
              <h2 className="l-h2">Try it before you pick a plan</h2>
              <p>Quote on a product in the demo store, accept as a buyer, see the draft order. No install, no sign-up.</p>
            </div>
            <div className="l-ctas" style={{ margin: 0 }}>
              <Link className="l-btn white" to="/demo/store">Try the demo store</Link>
              <Link className="l-btn outline" to="/auth/login">Install on Shopify</Link>
            </div>
          </div>
        </div>
      </section>

      <LandingFooter />
    </>
  );
}

function Row({ r, first }: { r: ReturnType<typeof comparisonRows>[number]; first: boolean }) {
  return (
    <>
      {first && (
        <tr className="grp">
          <td colSpan={PLANS.length + 1}>{r.group}</td>
        </tr>
      )}
      <tr>
        <td>{r.label}</td>
        {PLANS.map((h) => {
          const v = r.values[h];
          const strong = v === "✓" || v === "Unlimited" || v.startsWith("Automation") || v === "Deal-level";
          return (
            <td key={h} className={strong ? "y" : undefined}>{v}</td>
          );
        })}
      </tr>
    </>
  );
}
