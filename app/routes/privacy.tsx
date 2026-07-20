import type { LinksFunction, MetaFunction } from "@remix-run/node";
import portalStyles from "../styles/portal.css?url";
import {
  PRIVACY_SECTIONS,
  PRIVACY_LAST_UPDATED,
} from "../lib/legal";
import { formatDate } from "../lib/format";

// Public privacy policy — the URL the App Store listing points to. No auth, no
// DB, no Shopify: a plain server-rendered page reviewers and merchants can open
// directly. Reuses the light portal stylesheet.
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: portalStyles },
];

export const meta: MetaFunction = () => [
  { title: "Privacy Policy — Mannon" },
  {
    name: "description",
    content: "How Mannon accesses, stores, and protects merchant and buyer data.",
  },
];

export default function Privacy() {
  return (
    <main className="portal">
      <section className="portal-card">
        <h1>Privacy Policy</h1>
        <p className="muted">Last updated {formatDate(PRIVACY_LAST_UPDATED)}</p>

        {PRIVACY_SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2 className="portal-subhead">{section.heading}</h2>
            {section.body.map((paragraph, i) =>
              paragraph.startsWith("• ") ? (
                <p key={i} style={{ paddingLeft: "1rem" }}>
                  {paragraph}
                </p>
              ) : (
                <p key={i}>{paragraph}</p>
              ),
            )}
          </section>
        ))}
      </section>
    </main>
  );
}
