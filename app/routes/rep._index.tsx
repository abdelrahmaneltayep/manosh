import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { requireRepId } from "../services/rep-session.server";
import { getRep, listAssignedCompanies, REP_PORTAL_ENABLED } from "../services/rep.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!REP_PORTAL_ENABLED()) throw new Response("Not found", { status: 404 });
  const repId = await requireRepId(request);
  const rep = await getRep(repId);
  if (!rep) throw redirect("/rep/signin");
  const companies = await listAssignedCompanies(repId);
  return { repName: rep.name ?? rep.email, companies };
};

export default function RepHome() {
  const { repName, companies } = useLoaderData<typeof loader>();

  return (
    <section className="portal-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Your accounts</h1>
        <Form method="post" action="/rep/logout">
          <button type="submit" className="portal-link" style={{ background: "none", border: "none", cursor: "pointer" }}>
            Sign out
          </button>
        </Form>
      </div>
      <p className="muted">Signed in as {repName}. You see only the companies assigned to you.</p>

      {companies.length === 0 ? (
        <p className="muted" style={{ marginTop: "1rem" }}>
          No accounts are assigned to you yet. Your manager assigns companies from the Mannon admin.
        </p>
      ) : (
        <ul className="catalog-list" style={{ marginTop: "1rem" }}>
          {companies.map((c) => (
            <li key={c.id} className="catalog-row">
              <div className="catalog-info">
                <Link to={`/rep/company/${c.id}`} className="catalog-title">{c.name}</Link>
                <span className="muted">
                  {" "}· {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                  {c.openQuotes > 0 ? ` · ${c.openQuotes} open quote${c.openQuotes === 1 ? "" : "s"}` : ""}
                </span>
              </div>
              <Link to={`/rep/company/${c.id}`} className="portal-button">Open</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
