import { useState } from "react";
import { useNavigation, useSubmit } from "@remix-run/react";
import { Button, Modal, Text } from "@shopify/polaris";

/**
 * A destructive action that asks first (App Home details pattern: "confirm
 * deletes with a modal, critical-tone primary action"). The button opens a
 * Polaris Modal that says what will happen in plain language; only the modal's
 * specific verb ("Decline quote", never "OK") submits the form fields.
 *
 * `fields` are posted exactly as the old one-click <Form> did (intent + ids), so
 * route actions don't change.
 */
export function ConfirmAction({
  label,
  title,
  message,
  confirmLabel,
  fields,
  action,
  size,
  variant = "secondary",
  tone = "critical",
  disabled,
}: {
  label: string;
  title: string;
  message: string;
  confirmLabel: string;
  fields: Record<string, string>;
  action?: string;
  size?: "micro" | "slim" | "medium" | "large";
  variant?: "primary" | "secondary" | "tertiary" | "plain";
  tone?: "critical" | "success";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const confirm = () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    submit(fd, { method: "post", ...(action ? { action } : {}) });
    setOpen(false);
  };
  return (
    <>
      <Button size={size} variant={variant} tone={tone} disabled={disabled} loading={busy && open} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        primaryAction={{ content: confirmLabel, destructive: tone === "critical", onAction: confirm, loading: busy }}
        secondaryActions={[{ content: "Cancel", onAction: () => setOpen(false) }]}
      >
        <Modal.Section>
          <Text as="p">{message}</Text>
        </Modal.Section>
      </Modal>
    </>
  );
}
