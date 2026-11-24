import { useEffect, useRef, useState } from "react";
import { Banner, BlockStack, Box, Button, InlineStack, Text } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

/** Put text on the clipboard. False when the browser refuses (no permission, no gesture). */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shows a link or message the merchant will send themselves, and copies it.
 *
 * Used wherever Mannon would email someone but no sender is connected: the
 * server prepares the text, this copies it straight away and confirms with a
 * toast. Browsers can refuse a copy that doesn't follow a click closely, so the
 * text always stays visible with its own Copy button as the fallback.
 */
export function CopyPanel({
  title,
  description,
  text,
  toast,
  copyLabel = "Copy",
  onDismiss,
}: {
  title: string;
  description: string;
  /** What goes on the clipboard, shown as-is. */
  text: string;
  /** Toast shown after a successful copy, e.g. "Buyer link copied". */
  toast: string;
  copyLabel?: string;
  onDismiss?: () => void;
}) {
  const shopify = useAppBridge();
  const [copied, setCopied] = useState(false);
  const attempted = useRef<string | null>(null);

  const copy = async () => {
    const ok = await writeClipboard(text);
    setCopied(ok);
    if (ok) shopify.toast.show(toast);
    return ok;
  };

  // Copy once when new text arrives (the merchant just pressed a Copy action).
  useEffect(() => {
    if (attempted.current === text) return;
    attempted.current = text;
    setCopied(false);
    void copy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <Banner tone="success" title={title} onDismiss={onDismiss}>
      <BlockStack gap="200">
        <Text as="p" variant="bodyMd">{description}</Text>
        <Box background="bg-surface" borderRadius="200" padding="300" borderWidth="025" borderColor="border">
          <Text as="p" variant="bodyMd" breakWord>
            <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>
          </Text>
        </Box>
        <InlineStack gap="200" blockAlign="center">
          <Button onClick={() => void copy()} accessibilityLabel={`${copyLabel}: ${title}`}>
            {copied ? "Copied" : copyLabel}
          </Button>
          <span aria-live="polite">
            {copied && <Text as="span" tone="subdued" variant="bodySm">On your clipboard.</Text>}
          </span>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
