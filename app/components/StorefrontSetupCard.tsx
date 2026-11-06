import { BlockStack, Box, Button, Card, InlineStack, List, Text } from "@shopify/polaris";
import type { StorefrontBlockLink } from "../lib/theme-deep-links";

/**
 * Onboarding for Mannon's theme app extension blocks (App Store 5.1.3): the
 * steps, and an "Add to theme" deep link per block that opens the theme editor
 * with the block placed. Nothing changes on the storefront until the merchant
 * clicks Save in the theme editor. No theme code is edited.
 */
export function StorefrontSetupCard({
  links,
  title = "Add it to your storefront",
  bare = false,
}: {
  links: StorefrontBlockLink[];
  title?: string;
  /** Render just the steps (no Card, no heading) — for use inside a DisclosureCard. */
  bare?: boolean;
}) {
  if (links.length === 0) return null;
  const body = (
      <BlockStack gap="300">
        {!bare && <Text as="h2" variant="headingMd">{title}</Text>}
        <List type="number">
          <List.Item>Click <strong>Add to theme</strong>. Your theme editor opens in a new tab with the block placed on the {links.every((l) => l.template === "cart") ? "cart" : "product"} page.</List.Item>
          <List.Item>Drag the block where you want it and adjust its settings in the sidebar.</List.Item>
          <List.Item>Click <strong>Save</strong>. Nothing changes on your store until you save, and you can remove the block at any time.</List.Item>
        </List>
        <BlockStack gap="200">
          {links.map((l) => (
            <Box key={l.handle} paddingBlockStart="100">
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                <BlockStack gap="050">
                  <Text as="p" fontWeight="semibold">{l.name}</Text>
                  <Text as="p" tone="subdued" variant="bodySm">{l.what} Goes on the {l.template === "cart" ? "cart page" : "product page"}.</Text>
                </BlockStack>
                {l.url ? (
                  <Button url={l.url} target="_blank" accessibilityLabel={`Add ${l.name} to your theme (opens the theme editor in a new tab)`}>
                    Add to theme
                  </Button>
                ) : (
                  <Text as="span" tone="subdued" variant="bodySm">In your theme editor: Online Store → Themes → Customize → Add block → Apps → {l.name}.</Text>
                )}
              </InlineStack>
            </Box>
          ))}
        </BlockStack>
        <Text as="p" tone="subdued" variant="bodySm">
          Works with Online Store 2.0 themes. On an older theme, add the block from Online Store → Themes → Customize → Add block → Apps.
        </Text>
      </BlockStack>
  );
  return bare ? body : <Card>{body}</Card>;
}
