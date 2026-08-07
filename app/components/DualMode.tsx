import { useState, type ReactNode } from "react";
import { Badge, BlockStack, Box, InlineStack, Tabs } from "@shopify/polaris";
import { WITH_CLAUDE_LABEL, type ClaudeAccess } from "../config/plans";
import { UpgradeToClaude } from "./UpgradeToClaude";

/**
 * The reusable dual-mode wrapper used on ALL 15 feature screens.
 *
 * Two tabs — "Manual" (normal B2B controls, every plan, no AI) and
 * "✦ Draft with Claude" (the AI-assist panel). The Claude panel only ever
 * PRE-FILLS the manual controls; it never sends/accepts/charges — the merchant
 * always clicks the final button (guardrail #4).
 *
 * Plan gating is driven entirely by `access` (computed in app/config/plans.ts,
 * passed from the loader):
 *   • included / trial → the Claude tab shows the assist panel; a Starter on
 *     trial also gets a "Claude trial · N days left" badge.
 *   • locked → the Claude tab shows <UpgradeToClaude/> instead of the panel, so
 *     the feature stays discoverable without unlocking the model.
 *
 * Polaris Tabs are keyboard-navigable and screen-reader-labelled out of the box.
 */
export interface DualModeProps {
  access: ClaudeAccess;
  /** The normal manual B2B controls (works on every plan). */
  manual: ReactNode;
  /** The Claude-assisted panel (rendered only when access.allowed). */
  claude: ReactNode;
  /** Override the Claude tab label (defaults to "Draft with Claude"). */
  claudeLabel?: string;
  /** Where the upgrade CTA points (defaults to the settings billing section). */
  upgradeUrl?: string;
}

export function DualMode({
  access,
  manual,
  claude,
  claudeLabel = WITH_CLAUDE_LABEL,
  upgradeUrl,
}: DualModeProps) {
  const [selected, setSelected] = useState(0);
  const onTrial = access.state === "trial" && access.daysLeft != null;

  const tabs = [
    { id: "dualmode-manual", content: "Manual", panelID: "dualmode-manual-panel" },
    {
      id: "dualmode-claude",
      content: `✦ ${claudeLabel}`,
      accessibilityLabel: `${claudeLabel} — AI assist`,
      panelID: "dualmode-claude-panel",
    },
  ];

  return (
    <BlockStack gap="300">
      {onTrial ? (
        <InlineStack gap="200" blockAlign="center">
          <Badge tone="attention">
            {`Claude trial · ${access.daysLeft} ${access.daysLeft === 1 ? "day" : "days"} left`}
          </Badge>
        </InlineStack>
      ) : null}

      <Tabs tabs={tabs} selected={selected} onSelect={setSelected} fitted>
        <Box paddingBlockStart="400">
          {selected === 0
            ? manual
            : access.allowed
              ? claude
              : <UpgradeToClaude access={access} upgradeUrl={upgradeUrl} />}
        </Box>
      </Tabs>
    </BlockStack>
  );
}
