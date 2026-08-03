import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField, Checkbox,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getShopCapabilities } from "../services/billing.server";
import { MAKE_AN_OFFER_ENABLED, getWidgetConfig, saveWidgetConfig } from "../services/offers.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!MAKE_AN_OFFER_ENABLED()) throw new Response("Not found", { status: 404 });
  const caps = await getShopCapabilities(session.shop);
  if (caps.makeAnOffer === "teaser") throw redirect("/app/offers");
  const cfg = await getWidgetConfig(session.shop);
  const surfaces = (cfg?.surfaces as Record<string, boolean> | undefined) ?? { button: true, banner: false, inlineForm: true, exitPopup: false };
  return {
    allSurfaces: caps.makeAnOffer === "auto", // Scale unlocks banner + exit popup
    buttonLabel: cfg?.buttonLabel ?? "Make an offer",
    hideAtcUntilOffer: cfg?.hideAtcUntilOffer ?? false,
    surfaces: { button: surfaces.button ?? true, banner: surfaces.banner ?? false, inlineForm: surfaces.inlineForm ?? true, exitPopup: surfaces.exitPopup ?? false },
  };
};

type ActionResult = { ok: boolean; message?: string; error?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  if (!MAKE_AN_OFFER_ENABLED()) throw new Response("Not found", { status: 404 });
  const caps = await getShopCapabilities(session.shop);
  if (caps.makeAnOffer === "teaser") return { ok: false, error: "Upgrade to Growth to configure the widget." };
  const scale = caps.makeAnOffer === "auto";
  const form = await request.formData();
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

export default function OfferWidget() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const [s, setS] = useState(data.surfaces);
  const [label, setLabel] = useState(data.buttonLabel);
  const [hideAtc, setHideAtc] = useState(data.hideAtcUntilOffer);

  return (
    <Page backAction={{ url: "/app/offers" }}>
      <TitleBar title="Make-an-Offer widget" />
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Where buyers can make an offer</Text>
              <Text as="p" tone="subdued" variant="bodyMd">
                The storefront surface ships as a theme app extension (added in your theme editor).
                Growth includes the button + inline form; Scale adds the banner and exit popup.
              </Text>
              <Checkbox label="Product/cart button" name="button" checked={s.button} onChange={(v) => setS({ ...s, button: v })} />
              <input type="hidden" name="button" value={s.button ? "on" : "off"} />
              <Checkbox label="Inline form" name="inlineForm" checked={s.inlineForm} onChange={(v) => setS({ ...s, inlineForm: v })} />
              <input type="hidden" name="inlineForm" value={s.inlineForm ? "on" : "off"} />
              <InlineStack gap="200" blockAlign="center">
                <Checkbox label="Banner" name="banner" checked={s.banner} disabled={!data.allSurfaces} onChange={(v) => setS({ ...s, banner: v })} />
                {!data.allSurfaces && <Badge tone="info">Scale</Badge>}
              </InlineStack>
              <input type="hidden" name="banner" value={s.banner ? "on" : "off"} />
              <InlineStack gap="200" blockAlign="center">
                <Checkbox label="Exit-intent popup" name="exitPopup" checked={s.exitPopup} disabled={!data.allSurfaces} onChange={(v) => setS({ ...s, exitPopup: v })} />
                {!data.allSurfaces && <Badge tone="info">Scale</Badge>}
              </InlineStack>
              <input type="hidden" name="exitPopup" value={s.exitPopup ? "on" : "off"} />

              <TextField label="Button label" name="buttonLabel" value={label} onChange={setLabel} autoComplete="off" />
              <Checkbox label="Hide Add to cart until an offer is made" name="hideAtcUntilOffer" checked={hideAtc} onChange={setHideAtc} />
              <input type="hidden" name="hideAtcUntilOffer" value={hideAtc ? "on" : "off"} />

              <Box><Button submit variant="primary" disabled={busy}>Save</Button></Box>
            </BlockStack>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}
