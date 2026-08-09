import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Banner,
  Button,
  Box,
  TextField,
  Select,
  IndexTable,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { repPortalAllowed, getPlanLimits, repSeatCapMessage, GROWTH_PLAN } from "../lib/billing";
import {
  listReps,
  inviteRep,
  assignCompany,
  unassignCompany,
  removeRep,
  listCompaniesForShop,
  repLeaderboard,
  RepSeatCapError,
} from "../services/rep.server";
import prisma from "../db.server";
import {
  claudeAccess,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_UPGRADE_COPY,
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draft } from "../services/claude.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_REP_PORTAL === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const isGrowth = repPortalAllowed(status.plan);
  const shopRow = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
  });
  const access = claudeAccess(shopRow ?? { plan: "FREE" }, new Date());
  if (!isGrowth) {
    return { isGrowth, reps: [], companies: [], leaderboard: [], seatCap: 0, access };
  }
  const [reps, companies, leaderboard] = await Promise.all([
    listReps(session.shop),
    listCompaniesForShop(session.shop),
    repLeaderboard(session.shop),
  ]);
  return { isGrowth, reps, companies, leaderboard, seatCap: getPlanLimits(status.plan).repSeatCap, access };
};

type ActionResult =
  | { ok: true; message?: string; inviteUrl?: string; draft?: string }
  | { ok: false; error: string; upgrade?: boolean };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!repPortalAllowed(status.plan)) return { ok: false, error: "The sales-rep portal is a Growth feature." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  // --- F12 dual-mode: Claude drafts a personal invite note; merchant sends ----
  if (intent === "ai-invite-note") {
    const { access, shop } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return { ok: false, upgrade: true, error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY };
    }
    const { output } = await draft({
      feature: "rep_invite_note",
      shopId: shop.id,
      input: { repName: String(form.get("name") ?? "").trim() || "there", shopName: session.shop },
    });
    return { ok: true, draft: typeof output.note === "string" ? output.note.trim() : "" };
  }

  try {
    if (intent === "invite") {
      const email = String(form.get("email") ?? "").trim();
      if (!email) return { ok: false, error: "Enter an email." };
      const note = String(form.get("note") ?? "").trim() || undefined;
      const { url } = await inviteRep(session.shop, { email, name: String(form.get("name") ?? ""), note }, status.plan, baseUrl);
      return { ok: true, message: "Rep invited.", inviteUrl: url };
    }
    if (intent === "assign") {
      await assignCompany(session.shop, String(form.get("repId") ?? ""), String(form.get("companyId") ?? ""));
      return { ok: true, message: "Company assigned." };
    }
    if (intent === "unassign") {
      await unassignCompany(session.shop, String(form.get("repId") ?? ""), String(form.get("companyId") ?? ""));
      return { ok: true, message: "Assignment removed." };
    }
    if (intent === "remove") {
      await removeRep(session.shop, String(form.get("repId") ?? ""));
      return { ok: true, message: "Rep removed." };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof RepSeatCapError) return { ok: false, error: repSeatCapMessage(error.cap) };
    throw error;
  }
};

export default function Reps() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [assignRep, setAssignRep] = useState("");
  const [assignCo, setAssignCo] = useState("");

  // Dual-mode: Claude drafts a personal note into the invite below.
  const noteFetcher = useFetcher<typeof action>();
  const draftingNote = noteFetcher.state !== "idle";
  const noteData = noteFetcher.data;
  const noteDraft = noteData && noteData.ok && typeof noteData.draft === "string" ? noteData.draft : null;
  const noteErr = noteData && !noteData.ok ? noteData.error : null;
  const access = data.access as ClaudeAccess;

  if (!data.isGrowth) {
    return (
      <Page>
        <TitleBar title="Sales reps" />
        <Banner tone="info" title="Add your sales team — upgrade to Growth">
          <p>
            Give your reps a scoped login to see only their assigned accounts and
            place or negotiate orders on behalf of buyers. The sales-rep portal is
            included on the Growth plan.
          </p>
          <Box paddingBlockStart="200">
            <Button url="/app/settings?upgrade=Growth" variant="primary">See Growth</Button>
          </Box>
        </Banner>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Sales reps" />
      <BlockStack gap="500">
        {actionData?.ok === true && (
          <Banner tone="success" title={actionData.message}>
            {actionData.inviteUrl && (
              <p>Share this secure sign-in link if email isn’t configured: <code>{actionData.inviteUrl}</code></p>
            )}
          </Banner>
        )}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        <Text as="p" tone="subdued" variant="bodyMd">
          Reps sell through Mannon: they log in to a scoped portal, see only their
          assigned companies, and place or negotiate orders on behalf of buyers —
          within each buyer’s limits. They can’t change credit or company settings.
        </Text>

        {/* Invite */}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="invite" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Invite a rep</Text>
              <InlineStack gap="300" blockAlign="end" wrap>
                <Box minWidth="240px"><TextField label="Email" name="email" type="email" value={email} onChange={setEmail} autoComplete="off" /></Box>
                <Box minWidth="200px"><TextField label="Name (optional)" name="name" value={name} onChange={setName} autoComplete="off" /></Box>
              </InlineStack>

              {access.state === "trial" && access.daysLeft != null && (
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="attention">{`Claude trial · ${access.daysLeft} ${access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
                </InlineStack>
              )}
              {access.allowed ? (
                <BlockStack gap="200">
                  <TextField
                    label="Personal note (optional)"
                    name="note"
                    value={note}
                    onChange={setNote}
                    multiline={2}
                    autoComplete="off"
                    placeholder="Add a warm welcome, or draft one with Claude."
                  />
                  <InlineStack>
                    <Button
                      size="slim"
                      disabled={draftingNote}
                      loading={draftingNote}
                      onClick={() => noteFetcher.submit({ intent: "ai-invite-note", name }, { method: "post" })}
                    >
                      ✦ Draft note with Claude
                    </Button>
                  </InlineStack>
                  {noteErr && <Banner tone="warning">{noteErr}</Banner>}
                  {noteDraft && (
                    <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm">{noteDraft}</Text>
                        <InlineStack gap="200">
                          <Button size="slim" variant="primary" onClick={() => setNote(noteDraft)}>Use this</Button>
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Badge tone="info">✦ Drafted by Claude</Badge>
                          <Text as="span" variant="bodySm">{DRAFTED_BY_CLAUDE_TRUST}</Text>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              ) : (
                <>
                  <input type="hidden" name="note" value="" />
                  <UpgradeToClaude access={access} upgradeUrl="/app/settings" />
                </>
              )}

              <InlineStack>
                <Button variant="primary" submit loading={busy}>Send invite</Button>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">Seats used: {data.reps.length} of {data.seatCap}.</Text>
            </BlockStack>
          </Form>
        </Card>

        {/* Assign */}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="assign" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Assign a company</Text>
              <InlineStack gap="300" blockAlign="end" wrap>
                <Select label="Rep" name="repId" options={[{ label: "Choose…", value: "" }, ...data.reps.map((r) => ({ label: r.name ?? r.email, value: r.id }))]} value={assignRep} onChange={setAssignRep} />
                <Select label="Company" name="companyId" options={[{ label: "Choose…", value: "" }, ...data.companies.map((c) => ({ label: c.name, value: c.id }))]} value={assignCo} onChange={setAssignCo} />
                <Button submit loading={busy} disabled={!assignRep || !assignCo}>Assign</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        {/* Reps table */}
        <Card padding="0">
          <Box padding="400"><Text as="h2" variant="headingMd">Reps</Text></Box>
          {data.reps.length === 0 ? (
            <EmptyState heading="No reps yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>Invite your first rep to give them scoped access to their accounts.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "rep", plural: "reps" }}
              itemCount={data.reps.length}
              selectable={false}
              headings={[{ title: "Rep" }, { title: "Status" }, { title: "Accounts" }, { title: "" }]}
            >
              {data.reps.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell>{r.name ?? r.email}<br /><Text as="span" tone="subdued" variant="bodySm">{r.email}</Text></IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={r.status === "ACTIVE" ? "success" : "attention"}>{r.status}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>{String(r.assignmentCount)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="repId" value={r.id} />
                      <Button submit tone="critical" variant="tertiary" size="micro" loading={busy}>Remove</Button>
                    </Form>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {/* Leaderboard */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Rep leaderboard</Text>
            {data.leaderboard.length === 0 ? (
              <Text as="p" tone="subdued" variant="bodySm">No rep-placed quotes yet.</Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "row", plural: "rows" }}
                itemCount={data.leaderboard.length}
                selectable={false}
                headings={[{ title: "Rep" }, { title: "Quotes" }, { title: "Orders" }, { title: "Win rate" }]}
              >
                {data.leaderboard.map((row, i) => (
                  <IndexTable.Row id={row.repId} key={row.repId} position={i}>
                    <IndexTable.Cell>{row.name}</IndexTable.Cell>
                    <IndexTable.Cell>{String(row.quotes)}</IndexTable.Cell>
                    <IndexTable.Cell>{String(row.orders)}</IndexTable.Cell>
                    <IndexTable.Cell>{Math.round(row.winRate * 100)}%</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
