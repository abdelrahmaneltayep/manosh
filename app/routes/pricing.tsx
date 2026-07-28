import type { MetaFunction } from "@remix-run/node";
import {
  PLAN_PRICING,
  PLAN_LIMITS,
  STARTER_PLAN,
  GROWTH_PLAN,
  TRIAL_DAYS,
} from "../lib/billing";

// Public, non-embedded pricing page (no Shopify auth, no Polaris). Mirrors the
// in-app Plans matrix so the marketing story and the billing config never drift.
export const meta: MetaFunction = () => [
  { title: "Pricing — Mannon" },
  {
    name: "description",
    content:
      "Mannon pricing: Starter $29/mo and Growth $79/mo, 14-day free trial. Growth adds the AI Quote Assistant and unlimited quotes.",
  },
];

const rows: Array<{ label: string; starter: string; growth: string }> = [
  { label: "Active quotes / month", starter: "Up to 50", growth: "Unlimited" },
  {
    label: "Team seats",
    starter: `${PLAN_LIMITS.starter.seatCap}`,
    growth: `Up to ${PLAN_LIMITS.growth.seatCap}`,
  },
  { label: "Quote builder + passwordless portal", starter: "✓", growth: "✓" },
  { label: "Net terms + PO on draft orders", starter: "✓", growth: "✓" },
  { label: "AI Magic Order Pad + one-tap reorder", starter: "✓", growth: "✓" },
  { label: "Bulk order pad (search + paste) + saved lists", starter: "3 lists", growth: "Unlimited" },
  { label: "Order-pad CSV upload", starter: "—", growth: "✓" },
  { label: "Net terms + invoice due dates", starter: "✓", growth: "✓" },
  { label: "Customer price lists", starter: "Up to 3", growth: "Unlimited" },
  { label: "AI Quote Assistant (AI counter-offers)", starter: "—", growth: "✓" },
  { label: "Credit limits, aging dashboard & auto-reminders", starter: "—", growth: "✓" },
  { label: "Volume-break pricing + CSV import", starter: "—", growth: "✓" },
  { label: "Invoice PDFs", starter: "—", growth: "✓" },
];

export default function Pricing() {
  return (
    <main
      style={{
        maxWidth: "56rem",
        margin: "0 auto",
        padding: "3rem 1.25rem 4rem",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#1b1730",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>Simple pricing</h1>
      <p style={{ color: "#5b5670", margin: "0 0 2rem", fontSize: "1.1rem" }}>
        Two plans, {TRIAL_DAYS}-day free trial on either. The whole workflow is on
        both plans — Growth adds the AI Quote Assistant and lifts the limits.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          gap: "1rem",
          marginBottom: "2.5rem",
        }}
      >
        <PlanCard
          name={STARTER_PLAN}
          price={PLAN_PRICING[STARTER_PLAN].amount}
          blurb="For a growing wholesale desk."
          accent="#eae7f2"
        />
        <PlanCard
          name={GROWTH_PLAN}
          price={PLAN_PRICING[GROWTH_PLAN].amount}
          blurb="Unlimited quotes, more seats, AI counter-offers, and credit control."
          accent="#4f46e5"
          featured
        />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
        <thead>
          <tr>
            <th style={th}>What you get</th>
            <th style={{ ...th, textAlign: "center" }}>Starter</th>
            <th style={{ ...th, textAlign: "center" }}>Growth</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={td}>{r.label}</td>
              <td style={{ ...td, textAlign: "center" }}>{r.starter}</td>
              <td style={{ ...td, textAlign: "center", fontWeight: 600 }}>{r.growth}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ color: "#5b5670", marginTop: "1.5rem", fontSize: "0.9rem" }}>
        Billed through Shopify. Totals and tax are always calculated by Shopify —
        Mannon never computes them.
      </p>
    </main>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.75rem 0.5rem",
  borderBottom: "2px solid #1b1730",
  fontWeight: 700,
};
const td: React.CSSProperties = {
  padding: "0.7rem 0.5rem",
  borderBottom: "1px solid #eae7f2",
};

function PlanCard({
  name,
  price,
  blurb,
  accent,
  featured,
}: {
  name: string;
  price: number;
  blurb: string;
  accent: string;
  featured?: boolean;
}) {
  return (
    <section
      style={{
        border: `1px solid ${featured ? accent : "#eae7f2"}`,
        borderRadius: "1rem",
        padding: "1.5rem",
        background: "#fff",
        boxShadow: featured ? "0 12px 30px -18px rgba(79,70,229,0.5)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <h2 style={{ fontSize: "1.25rem", margin: 0 }}>{name}</h2>
        {featured && (
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "#fff",
              background: accent,
              borderRadius: "999px",
              padding: "0.15rem 0.6rem",
            }}
          >
            Most popular
          </span>
        )}
      </div>
      <p style={{ fontSize: "2rem", fontWeight: 800, margin: "0.5rem 0 0" }}>
        ${price}
        <span style={{ fontSize: "1rem", fontWeight: 400, color: "#5b5670" }}> / month</span>
      </p>
      <p style={{ color: "#5b5670", margin: "0.5rem 0 0" }}>{blurb}</p>
    </section>
  );
}
