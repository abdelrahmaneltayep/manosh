import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_REP_PORTAL === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const isGrowth = repPortalAllowed(status.plan);
  if (!isGrowth) {
    return { isGrowth, reps: [], companies: [], leaderboard: [], seatCap: 0 };
  }
  const [reps, companies, leaderboard] = await Promise.all([
    listReps(session.shop),
    listCompaniesForShop(session.shop),
    repLeaderboard(session.shop),
  ]);
  return { isGrowth, reps, companies, leaderboard, seatCap: getPlanLimits(status.plan).repSeatCap };
};

type ActionResult = { ok: true; message: string; inviteUrl?: string } | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!repPortalAllowed(status.plan)) return { ok: false, error: "The sales-rep portal is a Growth feature." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  try {
    if (intent === "invite") {
      const email = String(form.get("email") ?? "").trim();
      if (!email) return { ok: false, error: "Enter an email." };
      const { url } = await inviteRep(session.shop, { email, name: String(form.get("name") ?? "") }, status.plan, baseUrl);
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
  const [assignRep, setAssignRep] = useState("");
  const [assignCo, setAssignCo] = useState("");

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
