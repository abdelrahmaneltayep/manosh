import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { requireBuyerId } from "../services/buyer-session.server";
import { submitTaxProfile, getTaxProfile, CertTooLargeError, TAX_VAT_ENABLED } from "../services/tax.server";
import { validateTaxId, type TaxIdType } from "../lib/tax";

async function loadBuyer(request: Request) {
  const buyerId = await requireBuyerId(request);
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { company: { include: { shop: true } } } });
  if (!buyer) throw redirect("/portal/signin");
  return buyer;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!TAX_VAT_ENABLED()) throw new Response("Not found", { status: 404 });
  const buyer = await loadBuyer(request);
  const profile = await getTaxProfile(buyer.company.shop.shopifyDomain, buyer.companyId);
  return { companyName: buyer.company.name, profile };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!TAX_VAT_ENABLED()) throw new Response("Not found", { status: 404 });
  const buyer = await loadBuyer(request);

  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: 5 * 1024 * 1024 });
  const form = await unstable_parseMultipartFormData(request, uploadHandler);

  const taxId = String(form.get("taxId") ?? "").trim();
  const taxIdType = String(form.get("taxIdType") ?? "OTHER") as TaxIdType;
  if (taxId) {
    const v = validateTaxId(taxIdType, taxId);
    if (!v.valid) return { error: `That ${taxIdType} number doesn’t look right: ${v.reason}. Double-check and resubmit.` };
  }

  const file = form.get("certificate");
  let cert: { name: string; type: string; data: Uint8Array<ArrayBuffer> } | null = null;
  if (file && file instanceof File && file.size > 0) {
    cert = { name: file.name, type: file.type || "application/octet-stream", data: new Uint8Array(await file.arrayBuffer()) };
  }

  if (!taxId && !cert) return { error: "Add a tax ID or upload a certificate." };

  try {
    await submitTaxProfile(buyer.companyId, { taxId: taxId || null, taxIdType, cert });
  } catch (error) {
    if (error instanceof CertTooLargeError) return { error: "That file is too large (max 5 MB)." };
    throw error;
  }
  return { ok: true };
};

export default function PortalTax() {
  const { companyName, profile } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [taxIdType, setTaxIdType] = useState("VAT");

  return (
    <section className="portal-card">
      <h1>Tax details</h1>
      <p className="muted">
        Add your VAT/GST/tax ID or upload an exemption certificate for {companyName}.
        Orders are taxed as usual until your details are verified.
      </p>

      {profile && (
        <p style={{ margin: "0.75rem 0" }}>
          Current status:{" "}
          <strong>{profile.status}{profile.exempt ? " · exempt" : ""}</strong>
          {profile.certificateExpiresAt && <span className="muted"> · certificate expires {new Date(profile.certificateExpiresAt).toISOString().slice(0, 10)}</span>}
        </p>
      )}

      {actionData && "ok" in actionData && actionData.ok && <p className="save-badge" role="status" style={{ display: "inline-block" }}>Submitted — we’ll review it shortly.</p>}
      {actionData && "error" in actionData && actionData.error && <p className="error" role="alert">{actionData.error}</p>}

      <Form method="post" encType="multipart/form-data" style={{ marginTop: "1rem" }}>
        <label className="field">
          <span className="field-label">Tax ID type</span>
          <select name="taxIdType" value={taxIdType} onChange={(e) => setTaxIdType(e.target.value)}>
            <option value="VAT">VAT</option>
            <option value="GST">GST</option>
            <option value="ABN">ABN</option>
            <option value="EIN">EIN</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Tax ID</span>
          <input type="text" name="taxId" placeholder="e.g. 300000000000003" defaultValue={profile?.taxId ?? ""} />
        </label>
        <label className="field">
          <span className="field-label">Exemption certificate (PDF/image, optional)</span>
          <input type="file" name="certificate" accept=".pdf,image/*" />
        </label>
        <button type="submit" className="portal-button">Submit tax details</button>
      </Form>
    </section>
  );
}
