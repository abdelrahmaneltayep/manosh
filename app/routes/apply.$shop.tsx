import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { getPublicForm, submitApplication } from "../services/wholesale.server";
import { HONEYPOT_FIELD } from "../lib/wholesale";

const ENABLED = () => process.env.MANNON_FF_WHOLESALE_REG === "true";

export const meta: MetaFunction = () => [{ title: "Apply to buy wholesale" }];

export const loader = async ({ params }: LoaderFunctionArgs) => {
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const shop = params.shop!;
  const form = await getPublicForm(shop);
  if (!form) {
    return { shop, form: null as null };
  }
  return {
    shop,
    form: {
      name: form.name,
      fields: form.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        options: Array.isArray(f.options) ? (f.options as string[]) : [],
      })),
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const shop = params.shop!;
  const body = await request.formData();
  const values: Record<string, string> = {};
  for (const [k, v] of body.entries()) {
    if (k === HONEYPOT_FIELD || k === "intent") continue;
    if (typeof v === "string") values[k] = v;
    else values[k] = v.name; // file: capture the filename only (binary not stored in this slice)
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  const result = await submitApplication(shop, {
    values,
    honeypot: body.get(HONEYPOT_FIELD),
    rateKey: `${shop}:${ip}`,
    baseUrl,
  });
  return result;
};

export default function Apply() {
  const { shop, form } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const wrap: React.CSSProperties = {
    maxWidth: "34rem",
    margin: "0 auto",
    padding: "3rem 1.25rem 4rem",
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: "#1a1a2e",
    lineHeight: 1.5,
  };
  const field: React.CSSProperties = { display: "grid", gap: "0.35rem", marginBottom: "1rem" };
  const input: React.CSSProperties = {
    padding: "0.7rem 0.85rem",
    fontSize: "1rem",
    border: "1px solid #d9d6e5",
    borderRadius: "0.6rem",
    fontFamily: "inherit",
  };

  const done = actionData && "ok" in actionData && actionData.ok;
  const errs = actionData && "fieldErrors" in actionData ? actionData.fieldErrors : undefined;
  const topError = actionData && "ok" in actionData && !actionData.ok ? actionData.error : null;

  return (
    <main style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <svg width="30" height="30" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M9 28.5V12.5l9.5 9 9.5-9v16" fill="none" stroke="#4F46E5" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="32" cy="25.5" r="3" fill="#B6E02F" />
        </svg>
        <strong style={{ fontSize: "1.15rem" }}>Apply to buy wholesale</strong>
      </div>

      {!form ? (
        <p style={{ color: "#5b5670" }}>
          {shop} isn’t accepting wholesale applications right now. Please check back
          later.
        </p>
      ) : done ? (
        <div style={{ background: "#f0f7d6", border: "1px solid #dbe9a8", borderRadius: "0.8rem", padding: "1.25rem" }}>
          <h1 style={{ fontSize: "1.3rem", margin: "0 0 0.5rem" }}>
            {actionData && "status" in actionData && actionData.status === "APPROVED"
              ? "You're approved 🎉"
              : "Application received"}
          </h1>
          <p style={{ margin: 0, color: "#3a4a12" }}>
            {actionData && "status" in actionData && actionData.status === "APPROVED"
              ? "Check your email for a secure link to start ordering at your trade prices."
              : "Thanks — we’ll review your application and email you a decision. Your trade pricing unlocks once you’re approved."}
          </p>
        </div>
      ) : (
        <>
          <p style={{ color: "#5b5670", marginTop: 0 }}>
            Tell us about your business. We review each application before unlocking
            trade pricing — no password needed, we’ll email you a secure link.
          </p>
          {topError && <p style={{ color: "#8a1f11" }} role="alert">{topError}</p>}
          {errs && errs.length > 0 && (
            <ul style={{ color: "#8a1f11" }}>
              {errs.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <Form method="post">
            {/* Honeypot — hidden from humans, tempting to bots. */}
            <input
              type="text"
              name={HONEYPOT_FIELD}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
            />
            {form.fields.map((f) => (
              <label key={f.key} style={field}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  {f.label}{f.required ? " *" : ""}
                </span>
                {f.type === "SELECT" ? (
                  <select name={f.key} style={input} required={f.required} defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.type === "CHECKBOX" ? (
                  <input type="checkbox" name={f.key} required={f.required} />
                ) : f.type === "FILE" ? (
                  <input type="file" name={f.key} />
                ) : (
                  <input type={f.type === "EMAIL" ? "email" : "text"} name={f.key} style={input} required={f.required} />
                )}
              </label>
            ))}
            <button
              type="submit"
              disabled={busy}
              style={{ background: "#4f46e5", color: "#fff", border: "none", borderRadius: "0.6rem", padding: "0.8rem 1.4rem", fontSize: "1rem", fontWeight: 700, cursor: "pointer" }}
            >
              {busy ? "Submitting…" : "Submit application"}
            </button>
          </Form>
        </>
      )}
    </main>
  );
}
