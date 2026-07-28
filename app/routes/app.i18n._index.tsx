import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  Button,
  Box,
  TextField,
  Select,
  Checkbox,
  IndexTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { getPlanLimits, contractRatesAllowed, currencyCapMessage, GROWTH_PLAN } from "../lib/billing";
import { SUPPORTED_LOCALES, localeName } from "../lib/i18n";
import { getShopI18n, saveShopI18n, listRates, upsertRate, deleteRate, getStoreCurrency } from "../services/i18n.server";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_I18N === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const [settings, rates, storeCurrency] = await Promise.all([getShopI18n(session.shop), listRates(session.shop), getStoreCurrency(session.shop)]);
  const limits = getPlanLimits(status.plan);
  return {
    isGrowth: status.plan === GROWTH_PLAN,
    contractRates: contractRatesAllowed(status.plan),
    settings,
    rates,
    storeCurrency,
    localeCap: limits.localeCap,
    currencyCap: Number.isFinite(limits.extraCurrencyCap) ? limits.extraCurrencyCap : null,
    currencyCapMessage: currencyCapMessage(limits.extraCurrencyCap),
    locales: SUPPORTED_LOCALES,
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const limits = getPlanLimits(status.plan);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "settings") {
    const supportedLocales = SUPPORTED_LOCALES.map((l) => l.code).filter((c) => form.get(`loc_${c}`) === "on");
    const withEn = supportedLocales.includes("en") ? supportedLocales : ["en", ...supportedLocales];
    if (withEn.length > limits.localeCap) return { ok: false, error: `Your plan allows ${limits.localeCap} languages. Upgrade to Growth for all.` };
    const currencies = String(form.get("currencies") ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
    if (currencies.length > limits.extraCurrencyCap) return { ok: false, error: currencyCapMessage(limits.extraCurrencyCap) };
    await saveShopI18n(session.shop, {
      defaultLocale: String(form.get("defaultLocale") ?? "en"),
      supportedLocales: withEn,
      supportedCurrencies: currencies,
    });
    return { ok: true, message: "Language & currency settings saved." };
  }
  if (intent === "rate") {
    const base = String(form.get("base") ?? "").trim();
    const quote = String(form.get("quote") ?? "").trim();
    const rate = Number(form.get("rate"));
    if (!base || !quote || !Number.isFinite(rate) || rate <= 0) return { ok: false, error: "Enter base, quote, and a positive rate." };
    await upsertRate(session.shop, base, quote, rate, "MANUAL");
    return { ok: true, message: "Rate saved." };
  }
  if (intent === "rate-delete") {
    await deleteRate(session.shop, String(form.get("id") ?? ""));
    return { ok: true, message: "Rate removed." };
  }
  if (intent === "strings") {
    if (!contractRatesAllowed(status.plan)) return { ok: false, error: "Custom translations need Growth." };
    let parsed: Record<string, Record<string, string>>;
    try {
      parsed = JSON.parse(String(form.get("strings") ?? "{}"));
    } catch {
      return { ok: false, error: "Custom strings must be valid JSON." };
    }
    await saveShopI18n(session.shop, { i18nStrings: parsed });
    return { ok: true, message: "Custom translations saved." };
  }
  return { ok: false, error: "Unknown action." };
};

export default function I18nSettings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const [defaultLocale, setDefaultLocale] = useState(data.settings.defaultLocale);
  const [locs, setLocs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l.code, data.settings.supportedLocales.includes(l.code)])),
  );
  const [currencies, setCurrencies] = useState(data.settings.supportedCurrencies.join(", "));
  const [base, setBase] = useState(data.storeCurrency);
  const [quote, setQuote] = useState("");
  const [rate, setRate] = useState("");
  const [strings, setStrings] = useState(JSON.stringify(data.settings.i18nStrings ?? {}, null, 2));

  return (
    <Page>
      <TitleBar title="Languages & currencies" />
      <BlockStack gap="500">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        <Text as="p" tone="subdued" variant="bodyMd">
          Buyers see the portal in their language (Arabic is full RTL) and prices in
          their currency. A quote locks its FX rate at issue, so a counter-offer never
          drifts. Store currency: <b>{data.storeCurrency}</b>.
        </Text>

        {/* Locales + currencies */}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="settings" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Languages & currencies</Text>
              <InlineStack gap="300" blockAlign="center" wrap>
                {SUPPORTED_LOCALES.map((l) => (
                  <input key={l.code} type="hidden" name={`loc_${l.code}`} value={locs[l.code] ? "on" : ""} />
                ))}
                {SUPPORTED_LOCALES.map((l) => (
                  <Checkbox key={l.code} label={`${localeName(l.code)}${l.dir === "rtl" ? " (RTL)" : ""}`} checked={l.code === "en" ? true : locs[l.code]} disabled={l.code === "en"} onChange={(v) => setLocs((p) => ({ ...p, [l.code]: v }))} />
                ))}
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">Your plan includes {data.localeCap} languages{data.localeCap <= 2 ? " (English + one more)" : ""}.</Text>
              <InlineStack gap="300" blockAlign="end" wrap>
                <Select label="Default language" name="defaultLocale" options={SUPPORTED_LOCALES.filter((l) => l.code === "en" || locs[l.code]).map((l) => ({ label: localeName(l.code), value: l.code }))} value={defaultLocale} onChange={setDefaultLocale} />
                <Box minWidth="260px"><TextField label={`Extra currencies (besides ${data.storeCurrency})`} name="currencies" value={currencies} onChange={setCurrencies} autoComplete="off" placeholder="SAR, AED" helpText={data.currencyCap == null ? "Unlimited on Growth." : `Up to ${data.currencyCap} on your plan.`} /></Box>
                <Button variant="primary" submit loading={busy}>Save</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        {/* FX rates */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Exchange rates</Text>
            <Text as="p" tone="subdued" variant="bodySm">Fixed contract rates from your store currency. A quote locks the rate at issue.</Text>
            <Form method="post">
              <input type="hidden" name="intent" value="rate" />
              <InlineStack gap="300" blockAlign="end" wrap>
                <Box minWidth="120px"><TextField label="Base" name="base" value={base} onChange={setBase} autoComplete="off" /></Box>
                <Box minWidth="120px"><TextField label="Quote" name="quote" value={quote} onChange={setQuote} autoComplete="off" placeholder="SAR" /></Box>
                <Box minWidth="140px"><TextField label="Rate" name="rate" type="number" value={rate} onChange={setRate} min={0} step={0.0001} autoComplete="off" /></Box>
                <Button submit loading={busy}>Add / update</Button>
              </InlineStack>
            </Form>
            {data.rates.length > 0 && (
              <IndexTable resourceName={{ singular: "rate", plural: "rates" }} itemCount={data.rates.length} selectable={false} headings={[{ title: "Pair" }, { title: "Rate" }, { title: "Source" }, { title: "" }]}>
                {data.rates.map((r, i) => (
                  <IndexTable.Row id={r.id} key={r.id} position={i}>
                    <IndexTable.Cell>{r.base} → {r.quote}</IndexTable.Cell>
                    <IndexTable.Cell>{r.rate}</IndexTable.Cell>
                    <IndexTable.Cell><Badge>{r.source}</Badge></IndexTable.Cell>
                    <IndexTable.Cell>
                      <Form method="post">
                        <input type="hidden" name="intent" value="rate-delete" />
                        <input type="hidden" name="id" value={r.id} />
                        <Button submit variant="tertiary" tone="critical" size="micro" loading={busy}>Remove</Button>
                      </Form>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        {/* Custom translations (Growth) */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">Custom translations</Text>
              {!data.contractRates && <Badge tone="info">Growth</Badge>}
            </InlineStack>
            {data.contractRates ? (
              <Form method="post">
                <input type="hidden" name="intent" value="strings" />
                <BlockStack gap="200">
                  <TextField label="Overrides (JSON: { locale: { key: value } })" name="strings" value={strings} onChange={setStrings} multiline={4} autoComplete="off" />
                  <InlineStack><Button submit loading={busy}>Save translations</Button></InlineStack>
                </BlockStack>
              </Form>
            ) : (
              <Text as="p" tone="subdued" variant="bodySm">Editing custom portal strings per language is a Growth feature.</Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
