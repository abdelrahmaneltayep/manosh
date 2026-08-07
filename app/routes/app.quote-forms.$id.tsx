import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField, Select, Checkbox, Divider, Tooltip,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { quoteFormFeatures, quoteCaptureAllowed } from "../lib/billing";
import { FIELD_TYPES, SURFACES, emptyField, moveField, type QuoteFormField, type QuoteFieldType, type Translations, type LocaleTranslation } from "../lib/quote-form";
import { QUOTE_CAPTURE_ENABLED, getForm, saveForm, type SuccessMode } from "../services/quote-form.server";
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!QUOTE_CAPTURE_ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const form = await getForm(session.shop, params.id!);
  if (!form) throw new Response("Form not found", { status: 404 });
  const shopRow = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true },
  });
  const access = claudeAccess(shopRow ?? { plan: "FREE" }, new Date());
  return { form, features: quoteFormFeatures(status.plan), paid: quoteCaptureAllowed(status.plan), access };
};

type ActionResult = { ok: boolean; message?: string; error?: string; draft?: string; upgrade?: boolean };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  if (!QUOTE_CAPTURE_ENABLED()) throw new Response("Not found", { status: 404 });
  const form = await request.formData();

  // --- F24.1 dual-mode: Claude drafts the thank-you copy; merchant saves ------
  if (String(form.get("intent") ?? "") === "ai-thankyou") {
    const { access, shop } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return { ok: false, upgrade: true, error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY };
    }
    let fieldLabels: string[] = [];
    try {
      const parsed = JSON.parse(String(form.get("fields") ?? "[]"));
      if (Array.isArray(parsed)) fieldLabels = parsed.map((f: { label?: unknown }) => String(f?.label ?? "")).filter(Boolean);
    } catch {
      fieldLabels = [];
    }
    const { output } = await draft({
      feature: "thankyou_message",
      shopId: shop.id,
      input: {
        formName: String(form.get("name") ?? ""),
        surface: String(form.get("surface") ?? "PRODUCT"),
        fieldLabels,
      },
    });
    const message = typeof output.message === "string" ? output.message.trim() : "";
    return { ok: true, draft: message };
  }

  let fields: unknown = [];
  let translations: unknown = {};
  try {
    fields = JSON.parse(String(form.get("fields") ?? "[]"));
    translations = JSON.parse(String(form.get("translations") ?? "{}"));
  } catch {
    return { ok: false, error: "Couldn’t read the form — please try again." };
  }
  const res = await saveForm(session.shop, {
    id: params.id!,
    name: String(form.get("name") ?? ""),
    surface: (String(form.get("surface") ?? "PRODUCT") as "PRODUCT" | "COLLECTION" | "CART" | "PAGE"),
    fields,
    active: form.get("active") === "on",
    successMode: (String(form.get("successMode") ?? "MESSAGE") as SuccessMode),
    successValue: String(form.get("successValue") ?? ""),
    translations,
  });
  return "error" in res ? { ok: false, error: res.error } : { ok: true, message: "Form saved." };
};

export default function QuoteFormBuilder() {
  const { form, features, paid, access } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  // Dual-mode: Claude drafts the thank-you copy into the field below.
  const thankyouFetcher = useFetcher<typeof action>();
  const draftingThankyou = thankyouFetcher.state !== "idle";
  const thankyouData = thankyouFetcher.data;
  const thankyouDraft = thankyouData && thankyouData.ok && typeof thankyouData.draft === "string" ? thankyouData.draft : null;
  const thankyouErr = thankyouData && !thankyouData.ok ? thankyouData.error : null;

  const [name, setName] = useState(form.name);
  const [surface, setSurface] = useState(form.surface);
  const [active, setActive] = useState(form.active);
  const [fields, setFields] = useState<QuoteFormField[]>(form.fields);
  const [newType, setNewType] = useState<QuoteFieldType>("text");
  const [successMode, setSuccessMode] = useState<SuccessMode>(form.successMode);
  const [successValue, setSuccessValue] = useState(form.successValue ?? "");
  const [translations, setTranslations] = useState<Translations>(form.translations ?? {});
  const [newLocale, setNewLocale] = useState("");
  const advanced = features.conditionalLogic; // Growth (conditional logic + translations)

  const update = (i: number, patch: Partial<QuoteFormField>) =>
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const setShowIf = (i: number, ref: string, equals: string) =>
    setFields(fields.map((f, idx) => (idx === i ? { ...f, showIf: ref ? { field: ref, equals } : undefined } : f)));
  const addField = () => setFields([...fields, emptyField(newType)]);
  const removeField = (i: number) => setFields(fields.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => setFields(moveField(fields, i, i + dir));

  // Translations (Growth): per-locale field-label + message overrides.
  const addLocale = () => {
    const loc = newLocale.trim().toLowerCase();
    if (!loc || translations[loc]) return;
    setTranslations({ ...translations, [loc]: {} });
    setNewLocale("");
  };
  const removeLocale = (loc: string) => {
    const next = { ...translations };
    delete next[loc];
    setTranslations(next);
  };
  const setLocaleField = (loc: string, key: string, label: string) => {
    const entry: LocaleTranslation = { ...(translations[loc] ?? {}) };
    const flds = { ...(entry.fields ?? {}) };
    if (label.trim()) flds[key] = { ...(flds[key] ?? {}), label: label };
    else delete flds[key];
    entry.fields = flds;
    setTranslations({ ...translations, [loc]: entry });
  };
  const setLocaleSuccess = (loc: string, value: string) =>
    setTranslations({ ...translations, [loc]: { ...(translations[loc] ?? {}), successValue: value || undefined } });

  return (
    <Page backAction={{ url: "/app/quote-forms" }}>
      <TitleBar title={`Edit — ${form.name}`} />
      <Form method="post">
        <input type="hidden" name="fields" value={JSON.stringify(fields)} />
        <input type="hidden" name="active" value={active ? "on" : "off"} />
        <input type="hidden" name="successMode" value={successMode} />
        <input type="hidden" name="successValue" value={successValue} />
        <input type="hidden" name="translations" value={JSON.stringify(translations)} />
        <BlockStack gap="400">
          {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
          {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

          <Card>
            <BlockStack gap="300">
              <InlineStack gap="300" blockAlign="end" wrap>
                <Box minWidth="16rem"><TextField label="Form name" name="name" value={name} onChange={setName} autoComplete="off" /></Box>
                <Box minWidth="14rem">
                  <Select label="Surface" name="surface" options={SURFACES.map((s) => ({ label: s.label, value: s.value }))} value={surface} onChange={(v) => setSurface(v as typeof surface)} />
                </Box>
                <Checkbox label="Active (render on the storefront)" checked={active} onChange={setActive} />
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Fields</Text>
              {fields.length === 0 && (
                <Text as="p" tone="subdued" variant="bodyMd">No fields yet. Add the first one below.</Text>
              )}
              {fields.map((f, i) => (
                <Box key={i} padding="300" borderColor="border" borderWidth="025" borderRadius="200">
                  <BlockStack gap="200">
                    <InlineStack gap="300" blockAlign="end" wrap>
                      <Box minWidth="14rem"><TextField label="Label" value={f.label} onChange={(v) => update(i, { label: v })} autoComplete="off" /></Box>
                      <Box minWidth="10rem">
                        <Select label="Type" options={FIELD_TYPES.map((t) => ({ label: t.label, value: t.value }))} value={f.type} onChange={(v) => update(i, { type: v as QuoteFieldType })} />
                      </Box>
                      <Checkbox label="Required" checked={f.required} onChange={(v) => update(i, { required: v })} />
                    </InlineStack>
                    <InlineStack gap="300" blockAlign="end" wrap>
                      <Box minWidth="14rem"><TextField label="Placeholder" value={f.placeholder ?? ""} onChange={(v) => update(i, { placeholder: v })} autoComplete="off" /></Box>
                      <Box minWidth="14rem"><TextField label="Help text" value={f.help ?? ""} onChange={(v) => update(i, { help: v })} autoComplete="off" /></Box>
                      {f.type === "dropdown" && (
                        <Box minWidth="16rem"><TextField label="Options (comma-separated)" value={(f.options ?? []).join(", ")} onChange={(v) => update(i, { options: v.split(",").map((o) => o.trim()).filter(Boolean) })} autoComplete="off" /></Box>
                      )}
                    </InlineStack>
                    {advanced && i > 0 && (
                      <InlineStack gap="300" blockAlign="end" wrap>
                        <Box minWidth="14rem">
                          <Select
                            label="Show only if"
                            options={[{ label: "Always show", value: "" }, ...fields.slice(0, i).map((pf) => ({ label: pf.label, value: pf.key }))]}
                            value={f.showIf?.field ?? ""}
                            onChange={(v) => setShowIf(i, v, f.showIf?.equals ?? "")}
                          />
                        </Box>
                        {f.showIf?.field && (
                          <Box minWidth="12rem"><TextField label="equals" value={f.showIf.equals} onChange={(v) => setShowIf(i, f.showIf!.field, v)} autoComplete="off" /></Box>
                        )}
                      </InlineStack>
                    )}
                    <InlineStack gap="200">
                      <Button size="micro" disabled={i === 0} onClick={() => move(i, -1)} accessibilityLabel="Move up">↑</Button>
                      <Button size="micro" disabled={i === fields.length - 1} onClick={() => move(i, 1)} accessibilityLabel="Move down">↓</Button>
                      <Button size="micro" tone="critical" variant="tertiary" onClick={() => removeField(i)}>Remove</Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              ))}
              <Divider />
              <InlineStack gap="300" blockAlign="end">
                <Box minWidth="12rem">
                  <Select label="Add a field" options={FIELD_TYPES.map((t) => ({ label: t.label, value: t.value }))} value={newType} onChange={(v) => setNewType(v as QuoteFieldType)} />
                </Box>
                <Button onClick={addField}>Add field</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">After submit</Text>
                {!paid && <Badge tone="info">Starter</Badge>}
              </InlineStack>
              {paid ? (
                <>
                  <Select
                    label="What happens next"
                    options={[{ label: "Show a thank-you message", value: "MESSAGE" }, { label: "Redirect to a URL", value: "REDIRECT" }]}
                    value={successMode}
                    onChange={(v) => setSuccessMode(v as SuccessMode)}
                  />
                  {successMode === "MESSAGE" ? (
                    <BlockStack gap="200">
                      <TextField label="Thank-you message" value={successValue} onChange={setSuccessValue} autoComplete="off" multiline={2}
                        placeholder="Thanks — we got your request and will reply with pricing." helpText="Shown to the buyer after they submit." />
                      {access.state === "trial" && access.daysLeft != null && (
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone="attention">{`Claude trial · ${access.daysLeft} ${access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
                        </InlineStack>
                      )}
                      {access.allowed ? (
                        <BlockStack gap="200">
                          <InlineStack>
                            <Button
                              size="slim"
                              disabled={draftingThankyou}
                              loading={draftingThankyou}
                              onClick={() => thankyouFetcher.submit({ intent: "ai-thankyou", name, surface, fields: JSON.stringify(fields) }, { method: "post" })}
                            >
                              ✦ Draft with Claude
                            </Button>
                          </InlineStack>
                          {thankyouErr && <Banner tone="warning">{thankyouErr}</Banner>}
                          {thankyouDraft && (
                            <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                              <BlockStack gap="200">
                                <Text as="p" variant="bodySm">{thankyouDraft}</Text>
                                <InlineStack gap="200">
                                  <Button size="slim" variant="primary" onClick={() => setSuccessValue(thankyouDraft)}>Use this</Button>
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
                        <UpgradeToClaude access={access as ClaudeAccess} upgradeUrl="/app/settings" />
                      )}
                    </BlockStack>
                  ) : (
                    <TextField label="Redirect URL" value={successValue} onChange={setSuccessValue} autoComplete="off" type="url"
                      placeholder="https://your-store.com/thank-you" helpText="The buyer is sent here after a successful submit." />
                  )}
                </>
              ) : (
                <Tooltip content="A custom thank-you message or redirect is available on any paid plan.">
                  <Box><TextField label="Thank-you message" value="" disabled autoComplete="off" helpText="Post-submission control is on Starter and up." /></Box>
                </Tooltip>
              )}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Translations</Text>
                {!advanced && <Badge tone="info">Growth</Badge>}
              </InlineStack>
              {advanced ? (
                <>
                  <Text as="p" tone="subdued" variant="bodySm">Override field labels + the thank-you message per storefront locale. The buyer sees their locale, falling back to the default.</Text>
                  {Object.keys(translations).map((loc) => (
                    <Box key={loc} padding="300" borderColor="border" borderWidth="025" borderRadius="200">
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingSm">{loc}</Text>
                          <Button size="micro" tone="critical" variant="tertiary" onClick={() => removeLocale(loc)}>Remove</Button>
                        </InlineStack>
                        {fields.map((f) => (
                          <TextField key={f.key} label={`Label — ${f.label}`} value={translations[loc]?.fields?.[f.key]?.label ?? ""} onChange={(v) => setLocaleField(loc, f.key, v)} autoComplete="off" placeholder={f.label} />
                        ))}
                        <TextField label="Thank-you message" value={translations[loc]?.successValue ?? ""} onChange={(v) => setLocaleSuccess(loc, v)} autoComplete="off" multiline={2} placeholder={successValue} />
                      </BlockStack>
                    </Box>
                  ))}
                  <InlineStack gap="200" blockAlign="end">
                    <Box minWidth="12rem"><TextField label="Add a locale (e.g. fr, de, ar)" value={newLocale} onChange={setNewLocale} autoComplete="off" /></Box>
                    <Button onClick={addLocale}>Add locale</Button>
                  </InlineStack>
                </>
              ) : (
                <Text as="p" tone="subdued" variant="bodyMd">Localize the form + thank-you message per storefront locale on Growth.</Text>
              )}
            </BlockStack>
          </Card>

          <InlineStack>
            <Button submit variant="primary" disabled={busy} loading={busy}>Save form</Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </Page>
  );
}

export const ErrorBoundary = () => (
  <Page><Banner tone="critical" title="Something went wrong">Couldn’t load this form. Go back and try again.</Banner></Page>
);
