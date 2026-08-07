import type { ReactNode } from "react";
import { Badge, BlockStack, Box, InlineStack, Text } from "@shopify/polaris";
import { DRAFTED_BY_CLAUDE_TRUST } from "../config/plans";

/**
 * The shared Claude result block. Every "✦ Draft with Claude" output on all 15
 * dual-mode screens renders inside this so the promise reads identically
 * everywhere: a Claude draft the merchant reviews, closing with the trust line
 * "You send it, not the AI." (guardrail #4 — Claude never acts autonomously).
 *
 * Polaris-native (guardrail #5): Badge + Text + Box, no custom UI. The indigo
 * "✦ Drafted by Claude" pill uses Polaris's info tone; the trust sentence is
 * default ink for AA contrast.
 */
export function DraftedByClaude({ children }: { children?: ReactNode }) {
  return (
    <Box
      background="bg-surface-secondary"
      borderColor="border"
      borderWidth="025"
      borderRadius="200"
      padding="400"
    >
      <BlockStack gap="300">
        {children != null ? <Box>{children}</Box> : null}
        <InlineStack gap="200" blockAlign="center" wrap>
          <Badge tone="info">✦ Drafted by Claude</Badge>
          <Text as="span" variant="bodySm">
            {DRAFTED_BY_CLAUDE_TRUST}
          </Text>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}
