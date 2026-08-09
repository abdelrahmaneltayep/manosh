import { Badge, BlockStack, Box, Button, InlineStack, Text } from "@shopify/polaris";
import {
  CLAUDE_UPGRADE_COPY,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_OFF_COPY,
  type ClaudeAccess,
} from "../config/plans";

/**
 * Shown in place of the Claude controls when a shop can't use Claude right now.
 * Three cases:
 *   • locked (Free, or a Starter whose 7-day trial ended) → honest upgrade nudge.
 *   • toggled-off (plan grants Claude, merchant switched it off) → a "turn it
 *     back on in Settings" pointer, NOT an upgrade nudge (they already have it).
 * Honest copy (guardrail: Shopify "Trustworthy"): it says exactly what Claude
 * does and where it lives, never oversells. The only accent is the Button fill
 * (Polaris fill, never coloured text).
 */
export function UpgradeToClaude({
  access,
  upgradeUrl = "/app/settings?upgrade=growth",
  settingsUrl = "/app/settings",
}: {
  access: Pick<ClaudeAccess, "reason">;
  upgradeUrl?: string;
  settingsUrl?: string;
}) {
  const isOff = access.reason === "toggled-off";
  const trialEnded = access.reason === "trial-ended";
  const body = isOff
    ? CLAUDE_OFF_COPY
    : trialEnded
      ? CLAUDE_TRIAL_ENDED_COPY
      : CLAUDE_UPGRADE_COPY;
  return (
    <Box background="bg-surface-secondary" borderRadius="200" padding="400">
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Badge tone="info">✦ Claude</Badge>
          <Text as="h3" variant="headingSm">
            Draft with Claude
          </Text>
        </InlineStack>
        <Text as="p" variant="bodyMd">
          {body}
        </Text>
        <div>
          {isOff ? (
            <Button url={settingsUrl}>Turn on in Settings</Button>
          ) : (
            <Button variant="primary" url={upgradeUrl}>
              Upgrade to Growth
            </Button>
          )}
        </div>
      </BlockStack>
    </Box>
  );
}
