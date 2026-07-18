import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { getBuyerId } from "../services/buyer-session.server";

// Buyer home. Session-gated: no valid session → sign-in notice. For S4 this
// just confirms the buyer is authenticated; S7/S9/S10 fill in the quote
// builder, reorder cards, and quick-order pad.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const buyerId = await getBuyerId(request);
  if (!buyerId) {
    throw redirect("/portal/signin");
  }
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { company: true },
  });
  if (!buyer) {
    // Session points at a deleted buyer — treat as signed out.
    throw redirect("/portal/signin");
  }
  return { email: buyer.email, name: buyer.name, company: buyer.company.name };
};

export default function PortalHome() {
  const { email, name, company } = useLoaderData<typeof loader>();
  return (
    <section className="portal-card">
      <h1>Welcome{name ? `, ${name}` : ""}</h1>
      <p className="muted">
        Signed in as {email} · {company}
      </p>
      <p>
        Your reorder cards, quick-order pad, and quote builder will appear here.
      </p>
      <Form method="post" action="/portal/logout" style={{ marginTop: "1rem" }}>
        <button type="submit" className="portal-button">
          Sign out
        </button>
      </Form>
    </section>
  );
}
