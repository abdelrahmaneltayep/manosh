import { Badge, BlockStack, Box, Button, InlineStack, Text } from "@shopify/polaris";
import {
  CLAUDE_UPGRADE_COPY,
  CLAUDE_TRIAL_ENDED_COPY,
  type ClaudeAccess,
} from "../config/plans";

/**
 * Shown in place of the Claude controls when a shop can't use Claude — Free from
 * the start, or a Starter whose 7-day trial has ended. Honest copy (guardrail:
 * Shopify "Trustworthy"): it says exactly what Claude does and where it's
 * included, never oversells. The only accent is the primary Button fill (Polaris
 * fill, never coloured text).
 */
export function UpgradeToClaude({
  access,
  upgradeUrl = "/app/settings?upgrade=growth",
}: {
  access: Pick<ClaudeAccess, "reason">;
  upgradeUrl?: string;
}) {
  const trialEnded = access.reason === "trial-ended";
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
          {trialEnded ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY}
        </Text>
        <div>
          <Button variant="primary" url={upgradeUrl}>
            Upgrade to Growth
          </Button>
        </div>
      </BlockStack>
    </Box>
  );
}
