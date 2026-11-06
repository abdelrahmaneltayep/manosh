import { useId, useState, type ReactNode } from "react";
import { BlockStack, Box, Button, Card, Collapsible, InlineStack, Text } from "@shopify/polaris";

/**
 * Progressive disclosure for secondary content (docs/ux-audit.md): a Card whose
 * body is collapsed behind a "Show"/"Hide" button, so the page leads with the
 * job the merchant came for and setup or advanced options stay one click away.
 *
 * - Header always visible: heading + one-line subheading (+ optional badge).
 * - The toggle is a real button with aria-expanded / aria-controls, so it is
 *   keyboard- and screen-reader-operable (Polaris Collapsible handles motion).
 * - `defaultOpen` lets a page open it when it matters (e.g. first run, or an
 *   error inside it) and keep it closed otherwise.
 */
export function DisclosureCard({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  showLabel = "Show",
  hideLabel = "Hide",
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  showLabel?: string;
  hideLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const panelId = `disclosure-${id}`;
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" wrap={false} gap="300">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {title}
              </Text>
              {badge}
            </InlineStack>
            {subtitle ? (
              <Text as="p" tone="subdued" variant="bodySm">
                {subtitle}
              </Text>
            ) : null}
          </BlockStack>
          <Button
            variant="plain"
            onClick={() => setOpen((v) => !v)}
            ariaExpanded={open}
            ariaControls={panelId}
            accessibilityLabel={`${open ? hideLabel : showLabel}: ${title}`}
          >
            {open ? hideLabel : showLabel}
          </Button>
        </InlineStack>
        <Collapsible id={panelId} open={open} transition={{ duration: "150ms", timingFunction: "ease-in-out" }}>
          <Box paddingBlockStart="100">{children}</Box>
        </Collapsible>
      </BlockStack>
    </Card>
  );
}
