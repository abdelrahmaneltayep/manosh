import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Button,
  Badge,
  Banner,
  BlockStack,
  InlineStack,
  Select,
  EmptyState,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { DraftedByClaude } from "../components/DraftedByClaude";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { issueMagicLink } from "../services/magic-link.server";
import { claudeAccess, CLAUDE_UNAVAILABLE_COPY, CLAUDE_UPGRADE_COPY, CLAUDE_TRIAL_ENDED_COPY, type ClaudeAccess } from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draftBuyerSummary, draftReorderPrediction } from "../services/insights-ai.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const buyers = await prisma.buyer.findMany({
    where: { company: { shop: { shopifyDomain: session.shop } } },
    include: { company: true },
    orderBy: { createdAt: "asc" },
  });
  const companies = await prisma.company.findMany({
    where: { shop: { shopifyDomain: session.shop } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const shopRow = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
  });
  const access = claudeAccess(shopRow ?? { plan: "FREE" }, new Date());
  return {
    access,
    companies,
    buyers: buyers.map((b) => ({
      id: b.id,
      email: b.email,
      name: b.name,
      company: b.company.name,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "magic-link");

  // AI-13 buyer summary + AI-11 reorder prediction — per-company relationship
  // reads from quote history. Dual-mode: advisory, nothing is written.
  if (intent === "ai-buyer-summary" || intent === "ai-reorder-predict") {
    const { access } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return { kind: "ai" as const, error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY };
    }
    const companyId = String(form.get("companyId") ?? "");
    try {
      if (intent === "ai-buyer-summary") {
        const summary = await draftBuyerSummary(session.shop, companyId);
        if (!summary) return { kind: "ai" as const, error: "Not enough history for that company yet." };
        return { kind: "summary" as const, summary };
      }
      const r = await draftReorderPrediction(session.shop, companyId);
      if (!r) return { kind: "ai" as const, error: "That company has no orders to predict from yet." };
      return { kind: "reorder" as const, likelihood: r.likelihood, message: r.message };
    } catch {
      return { kind: "ai" as const, error: CLAUDE_UNAVAILABLE_COPY };
    }
  }

  const buyerId = String(form.get("buyerId") ?? "");

  // Only issue links for buyers under the authenticated shop.
  const buyer = await prisma.buyer.findFirst({
    where: { id: buyerId, company: { shop: { shopifyDomain: session.shop } } },
  });
  if (!buyer) {
    return { error: "That buyer could not be found." };
  }

  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const { url, expiresAt } = await issueMagicLink(buyer.id, { baseUrl });
  return { url, email: buyer.email, expiresAt: expiresAt.toISOString() };
};

function RelationshipInsights({
  companies,
  access,
}: {
  companies: { id: string; name: string }[];
  access: Pick<ClaudeAccess, "allowed">;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const fetcher = useFetcher<typeof action>();
  if (!access.allowed || companies.length === 0) return null;
  const busy = fetcher.state !== "idle";
  const d = fetcher.data;
  const summary = d && "kind" in d && d.kind === "summary" ? d.summary : null;
  const reorder = d && "kind" in d && d.kind === "reorder" ? d : null;
  const err = d && "kind" in d && d.kind === "ai" ? d.error : null;
  const pending = busy ? String(fetcher.formData?.get("intent") ?? "") : "";
  const reorderLabel =
    reorder?.likelihood === "due" ? "Likely due to reorder" : reorder?.likelihood === "soon" ? "Reorder coming soon" : "Not due yet";
  const reorderTone = reorder?.likelihood === "due" ? "attention" : reorder?.likelihood === "soon" ? "info" : "success";
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Relationship insights</Text>
        <Select
          label="Company"
          options={companies.map((c) => ({ label: c.name, value: c.id }))}
          value={companyId}
          onChange={setCompanyId}
        />
        <InlineStack gap="200" wrap>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="ai-buyer-summary" />
            <input type="hidden" name="companyId" value={companyId} />
            <Button submit disabled={busy} loading={pending === "ai-buyer-summary"}>
              ✦ Summarize with Claude
            </Button>
          </fetcher.Form>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="ai-reorder-predict" />
            <input type="hidden" name="companyId" value={companyId} />
            <Button submit disabled={busy} loading={pending === "ai-reorder-predict"}>
              ✦ Predict reorder
            </Button>
          </fetcher.Form>
        </InlineStack>
        {err && <Banner tone="warning">{err}</Banner>}
        {summary && (
          <DraftedByClaude>
            <Text as="p" variant="bodyMd">{summary}</Text>
          </DraftedByClaude>
        )}
        {reorder && (
          <DraftedByClaude>
            <BlockStack gap="200">
              <Badge tone={reorderTone}>{reorderLabel}</Badge>
              <Text as="p" variant="bodyMd">{reorder.message}</Text>
            </BlockStack>
          </DraftedByClaude>
        )}
      </BlockStack>
    </Card>
  );
}

export default function BuyersPage() {
  const { buyers, companies, access } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [copied, setCopied] = useState(false);

  const generatedUrl = fetcher.data && "url" in fetcher.data ? fetcher.data.url : null;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  useEffect(() => {
    if (generatedUrl) {
      setCopied(false);
      shopify.toast.show("Magic link generated");
    }
  }, [generatedUrl, shopify]);

  const resourceName = { singular: "buyer", plural: "buyers" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(buyers);

  const rows = buyers.map((buyer, index) => (
    <IndexTable.Row
      id={buyer.id}
      key={buyer.id}
      position={index}
      selected={selectedResources.includes(buyer.id)}
    >
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">
          {buyer.name ?? "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{buyer.email}</IndexTable.Cell>
      <IndexTable.Cell>{buyer.company}</IndexTable.Cell>
      <IndexTable.Cell>
        <fetcher.Form method="post">
          <input type="hidden" name="buyerId" value={buyer.id} />
          <Button
            submit
            loading={
              fetcher.state !== "idle" &&
              fetcher.formData?.get("buyerId") === buyer.id
            }
          >
            Generate link
          </Button>
        </fetcher.Form>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title="Buyers" />
      <SectionTabs active="buyers" />
      <BlockStack gap="400">
        <RelationshipInsights companies={companies} access={access} />
        {error && (
          <Banner tone="critical" title="Couldn’t generate a link">
            <p>{error}</p>
          </Banner>
        )}
        {generatedUrl && (
          <Banner
            tone="success"
            title="Magic link ready to send"
            onDismiss={() => fetcher.load("/app/buyers")}
          >
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Copy this link and email it to the buyer. It expires
                automatically and can be used once.
              </Text>
              <Text as="p" variant="bodyMd" breakWord>
                <code>{generatedUrl}</code>
              </Text>
              <div>
                <Button
                  onClick={async () => {
                    await navigator.clipboard?.writeText(generatedUrl);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            </BlockStack>
          </Banner>
        )}

        <Card padding="0">
          {buyers.length === 0 ? (
            <EmptyState
              heading="No buyers yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Buyers appear here once they belong to a B2B company on your
                store. Then you can send each one a secure sign-in link.
              </p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={resourceName}
              itemCount={buyers.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              selectable={false}
              headings={[
                { title: "Name" },
                { title: "Email" },
                { title: "Company" },
                { title: "Magic link" },
              ]}
            >
              {rows}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
