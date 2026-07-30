import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { summarizeConfigHealth, type VarStatus } from "../lib/config-health";

/**
 * Owner-only config health check (/app/debug/config). Gated by
 * `authenticate.admin`, so only an authenticated store admin can view it. Shows
 * whether each required/optional env var is SET, MISSING, or still a PLACEHOLDER —
 * plus feature-flag state — WITHOUT ever revealing a value. Use it to diagnose the
 * "Something went wrong" embedded-load failure (missing Shopify keys) from the
 * browser instead of shelling into `fly logs`.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const health = summarizeConfigHealth(process.env);

  // Safe derived check: does SHOPIFY_APP_URL's host match the host serving this
  // request? A mismatch causes auth-redirect breakage. Hosts are public, not secret.
  let appUrlHostMatches: boolean | null = null;
  let appUrlHost: string | null = null;
  try {
    const configured = process.env.SHOPIFY_APP_URL ? new URL(process.env.SHOPIFY_APP_URL).host : "";
    appUrlHost = configured || null;
    appUrlHostMatches = configured ? configured === new URL(request.url).host : null;
  } catch {
    appUrlHostMatches = null;
  }

  return { health, appUrlHostMatches, appUrlHost, nodeEnv: process.env.NODE_ENV ?? "unknown" };
};

function VarBadge({ s }: { s: VarStatus }) {
  if (s.placeholder) return <Badge tone="critical">Placeholder</Badge>;
  return s.set ? <Badge tone="success">Set</Badge> : <Badge tone="critical">Missing</Badge>;
}

function VarRow({ s, required }: { s: VarStatus; required?: boolean }) {
  return (
    <Box paddingBlock="150">
      <InlineStack align="space-between" blockAlign="center" gap="200">
        <Text as="span" variant="bodyMd" fontWeight={required ? "semibold" : "regular"}>
          {s.name}
        </Text>
        <VarBadge s={s} />
      </InlineStack>
    </Box>
  );
}

export default function DebugConfig() {
  const { health, appUrlHostMatches, appUrlHost, nodeEnv } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Config health" />
      <BlockStack gap="400">
        {health.ok ? (
          <Banner tone="success" title="Core configuration looks good">
            <p>All required Shopify + runtime variables are set. If the embedded app still errors, check <b>fly logs</b>.</p>
          </Banner>
        ) : (
          <Banner tone="critical" title="Core configuration problem — the embedded app will fail">
            <p>
              {health.requiredMissing.length > 0 && <>Missing: <b>{health.requiredMissing.join(", ")}</b>. </>}
              {health.requiredPlaceholder.length > 0 && <>Still a placeholder: <b>{health.requiredPlaceholder.join(", ")}</b>. </>}
              Set them with <code>fly secrets set …</code> (SHOPIFY_API_KEY must equal the app client_id).
            </p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Required — Shopify &amp; runtime</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              These must all be <b>Set</b> for the embedded admin to load. Values are never shown.
            </Text>
            <Divider />
            {health.core.map((s, i) => (
              <Box key={s.name}>
                {i > 0 && <Divider />}
                <VarRow s={s} required />
              </Box>
            ))}
            <Divider />
            <Box paddingBlock="150">
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="span" variant="bodyMd">SHOPIFY_API_KEY matches client_id format (32-hex)</Text>
                <Badge tone={health.apiKeyLooksValid ? "success" : "warning"}>{health.apiKeyLooksValid ? "Yes" : "No / unknown"}</Badge>
              </InlineStack>
            </Box>
            <Box paddingBlock="150">
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="span" variant="bodyMd">
                  SHOPIFY_APP_URL host matches this request{appUrlHost ? ` (${appUrlHost})` : ""}
                </Text>
                <Badge tone={appUrlHostMatches === true ? "success" : appUrlHostMatches === false ? "critical" : "warning"}>
                  {appUrlHostMatches === true ? "Yes" : appUrlHostMatches === false ? "Mismatch" : "Unknown"}
                </Badge>
              </InlineStack>
            </Box>
            <Box paddingBlock="150">
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="span" variant="bodyMd">NODE_ENV</Text>
                <Badge tone={nodeEnv === "production" ? "success" : undefined}>{nodeEnv}</Badge>
              </InlineStack>
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Optional integrations</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Only needed by the feature that uses them (e.g. Anthropic key for AI, encryption key for Accounting/ERP, VAPID for push).
            </Text>
            <Divider />
            {health.integrations.map((s, i) => (
              <Box key={s.name}>
                {i > 0 && <Divider />}
                <VarRow s={s} />
              </Box>
            ))}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Feature flags</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Each feature dark-launches behind its flag. Off is safe — the feature is simply hidden.
            </Text>
            <Divider />
            {health.flags.map((f, i) => (
              <Box key={f.flag}>
                {i > 0 && <Divider />}
                <Box paddingBlock="150">
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <BlockStack gap="0">
                      <Text as="span" variant="bodyMd">{f.feature}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{f.flag}</Text>
                    </BlockStack>
                    <Badge tone={f.on ? "success" : undefined}>{f.on ? "On" : "Off"}</Badge>
                  </InlineStack>
                </Box>
              </Box>
            ))}
          </BlockStack>
        </Card>

        <Text as="p" tone="subdued" variant="bodySm">
          This page shows presence only — never secret values. It's reachable by URL
          (not linked in the nav) and gated to authenticated admins.
        </Text>
      </BlockStack>
    </Page>
  );
}
