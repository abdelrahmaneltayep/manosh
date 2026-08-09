import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useActionData, useFetcher, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Box, Button, TextField, Checkbox,
} from "@shopify/polaris";
import { TitleBar, SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getShopCapabilities } from "../services/billing.server";
import { MAKE_AN_OFFER_ENABLED, getWidgetConfig, saveWidgetConfig } from "../services/offers.server";
import prisma from "../db.server";
import {
  claudeAccess,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_UPGRADE_COPY,
  CLAUDE_UNAVAILABLE_COPY,
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draft } from "../services/claude.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!MAKE_AN_OFFER_ENABLED()) throw new Response("Not found", { status: 404 });
  const caps = await getShopCapabilities(session.shop);
  if (caps.makeAnOffer === "teaser") throw redirect("/app/offers");
  const cfg = await getWidgetConfig(session.shop);
  const surfaces = (cfg?.surfaces as Record<string, boolean> | undefined) ?? { button: true, banner: false, inlineForm: true, exitPopup: false };
  const shopRow = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true },
  });
  const access = claudeAccess(shopRow ?? { plan: "FREE" }, new Date());
  return {
    allSurfaces: caps.makeAnOffer === "auto", // Scale unlocks banner + exit popup
    buttonLabel: cfg?.buttonLabel ?? "Make an offer",
    hideAtcUntilOffer: cfg?.hideAtcUntilOffer ?? false,
    surfaces: { button: surfaces.button ?? true, banner: surfaces.banner ?? false, inlineForm: surfaces.inlineForm ?? true, exitPopup: surfaces.exitPopup ?? false },
    access,
  };
};

type ActionResult = { ok: boolean; message?: string; error?: string; draft?: string; upgrade?: boolean };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  if (!MAKE_AN_OFFER_ENABLED()) throw new Response("Not found", { status: 404 });
  const caps = await getShopCapabilities(session.shop);
  if (caps.makeAnOffer === "teaser") return { ok: false, error: "Upgrade to Growth to configure the widget." };
  const scale = caps.makeAnOffer === "auto";
  const form = await request.formData();

  // --- F21 dual-mode: Claude drafts the storefront button label --------------
  if (String(form.get("intent") ?? "") === "ai-widget-label") {
    const { access, shop } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return { ok: false, upgrade: true, error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY };
    }
    try {
      const { output } = await draft({
        feature: "widget_label",
        shopId: shop.id,
        input: { context: "Make an Offer button on product and cart pages", currentLabel: String(form.get("currentLabel") ?? "") },
      });
      return { ok: true, draft: typeof output.label === "string" ? output.label.trim() : "" };
    } catch {
      return { ok: false, error: CLAUDE_UNAVAILABLE_COPY };
    }
  }

  const on = (k: string) => form.get(k) === "on";
  await saveWidgetConfig(session.shop, {
    surfaces: {
      button: on("button"),
      inlineForm: on("inlineForm"),
      // Scale-only surfaces are ignored on Growth (disabled in the UI too).
      banner: scale ? on("banner") : false,
      exitPopup: scale ? on("exitPopup") : false,
    },
    buttonLabel: String(form.get("buttonLabel") ?? ""),
    hideAtcUntilOffer: on("hideAtcUntilOffer"),
  });
  return { ok: true, message: "Widget settings saved." };
};

const SAVE_BAR_ID = "offer-widget-save";

export default function OfferWidget() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const busy = nav.state === "submitting";

  const [s, setS] = useState(data.surfaces);
  const [label, setLabel] = useState(data.buttonLabel);
  const [hideAtc, setHideAtc] = useState(data.hideAtcUntilOffer);

  // Dual-mode: Claude drafts the storefront button label.
  const labelFetcher = useFetcher<typeof action>();
  const draftingLabel = labelFetcher.state !== "idle";
  const labelData = labelFetcher.data;
  const labelDraft = labelData && labelData.ok && typeof labelData.draft === "string" ? labelData.draft : null;
  const labelErr = labelData && !labelData.ok ? labelData.error : null;
  const access = data.access as ClaudeAccess;

  // Dirty = the form differs from the last-loaded (saved) config. Drives the
  // App Bridge contextual Save Bar (BFS §3.3): unsaved changes are always visible.
  const dirty =
    JSON.stringify(s) !== JSON.stringify(data.surfaces) ||
    label !== data.buttonLabel ||
    hideAtc !== data.hideAtcUntilOffer;

  useEffect(() => {
    if (dirty) shopify.saveBar.show(SAVE_BAR_ID);
    else shopify.saveBar.hide(SAVE_BAR_ID);
  }, [dirty, shopify]);

  const handleSave = () => {
    const fd = new FormData();
    fd.set("button", s.button ? "on" : "off");
    fd.set("inlineForm", s.inlineForm ? "on" : "off");
    fd.set("banner", s.banner ? "on" : "off");
    fd.set("exitPopup", s.exitPopup ? "on" : "off");
    fd.set("buttonLabel", label);
    fd.set("hideAtcUntilOffer", hideAtc ? "on" : "off");
    submit(fd, { method: "post" });
  };

  const handleDiscard = () => {
    setS(data.surfaces);
    setLabel(data.buttonLabel);
    setHideAtc(data.hideAtcUntilOffer);
  };

  return (
    <Page backAction={{ url: "/app/offers" }}>
      <TitleBar title="Make-an-Offer widget" />
      <SaveBar id={SAVE_BAR_ID}>
        <button variant="primary" onClick={handleSave} disabled={busy}>Save</button>
        <button onClick={handleDiscard} disabled={busy}>Discard</button>
      </SaveBar>
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Where buyers can make an offer</Text>
            <Text as="p" tone="subdued" variant="bodyMd">
              The storefront surface ships as a theme app extension (added in your theme editor).
              Growth includes the button + inline form; Scale adds the banner and exit popup.
            </Text>
            <Checkbox label="Product/cart button" checked={s.button} onChange={(v) => setS({ ...s, button: v })} />
            <Checkbox label="Inline form" checked={s.inlineForm} onChange={(v) => setS({ ...s, inlineForm: v })} />
            <InlineStack gap="200" blockAlign="center">
              <Checkbox label="Banner" checked={s.banner} disabled={!data.allSurfaces} onChange={(v) => setS({ ...s, banner: v })} />
              {!data.allSurfaces && <Badge tone="info">Scale</Badge>}
            </InlineStack>
            <InlineStack gap="200" blockAlign="center">
              <Checkbox label="Exit-intent popup" checked={s.exitPopup} disabled={!data.allSurfaces} onChange={(v) => setS({ ...s, exitPopup: v })} />
              {!data.allSurfaces && <Badge tone="info">Scale</Badge>}
            </InlineStack>

            <TextField label="Button label" value={label} onChange={setLabel} autoComplete="off" />
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
                    disabled={draftingLabel}
                    loading={draftingLabel}
                    onClick={() => labelFetcher.submit({ intent: "ai-widget-label", currentLabel: label }, { method: "post" })}
                  >
                    ✦ Draft label with Claude
                  </Button>
                </InlineStack>
                {labelErr && <Banner tone="warning">{labelErr}</Banner>}
                {labelDraft && (
                  <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{labelDraft}</Text>
                      <InlineStack gap="200">
                        <Button size="slim" variant="primary" onClick={() => setLabel(labelDraft)}>Use this</Button>
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
              <UpgradeToClaude access={access} upgradeUrl="/app/settings" />
            )}
            <Checkbox label="Hide Add to cart until an offer is made" checked={hideAtc} onChange={setHideAtc} />
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
