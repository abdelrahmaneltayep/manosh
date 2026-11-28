import type { EmailMessage } from "./mailer.server";

/**
 * Postmark transport (Phase 2). Sends one message through Postmark's single-
 * email API. Configuration, never committed:
 *   POSTMARK_SERVER_TOKEN   Fly secret — the server API token.
 *   MANNON_MAIL_FROM        the sender, e.g. quotes@support-mannon.com. Replies
 *                           go to the same address (a mailbox the owner reads).
 *   POSTMARK_MESSAGE_STREAM optional, defaults to Postmark's "outbound".
 *   POSTMARK_API_URL        optional, for tests and the local mock.
 *
 * Throws on anything but an accepted message, with Postmark's own error text,
 * so the caller records the failure and shows the merchant the copy link.
 */
export interface PostmarkResult {
  messageId: string | null;
}

export class PostmarkError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode: number | null,
  ) {
    super(message);
    this.name = "PostmarkError";
  }
}

const DEFAULT_API_URL = "https://api.postmarkapp.com/email";

/** "Acme Wholesale" <quotes@…> — quotes stripped from the display name. */
export function formatFrom(address: string, displayName?: string | null): string {
  const name = (displayName ?? "").replace(/["\r\n<>]/g, "").trim();
  return name ? `"${name}" <${address}>` : address;
}

export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function postmarkPayload(message: EmailMessage, from: string, stream: string) {
  return {
    From: formatFrom(from, message.fromName),
    To: message.to,
    ReplyTo: message.replyTo ?? from,
    Subject: message.subject,
    // Some callers pass plain text as the HTML part; keep its line breaks.
    HtmlBody: isPlainText(message) ? escapeHtml(plainSource(message)).replace(/\r?\n/g, "<br>") : message.html,
    TextBody: message.text ?? message.html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
    MessageStream: stream,
    ...(message.tag ? { Tag: message.tag } : {}),
    ...(message.attachments?.length
      ? {
          Attachments: message.attachments.map((a) => ({
            Name: a.filename,
            Content: base64(a.content),
            ContentType: a.contentType,
          })),
        }
      : {}),
  };
}

export function postmarkTransport(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
) {
  return async (message: EmailMessage, from: string): Promise<PostmarkResult> => {
    const token = env.POSTMARK_SERVER_TOKEN;
    if (!token) throw new PostmarkError("Postmark isn’t configured.", 0, null);
    const response = await fetchImpl(env.POSTMARK_API_URL || DEFAULT_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify(postmarkPayload(message, from, env.POSTMARK_MESSAGE_STREAM || "outbound")),
    });
    let body: { ErrorCode?: number; Message?: string; MessageID?: string } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      /* non-JSON error page */
    }
    if (!response.ok || (body.ErrorCode ?? 0) !== 0) {
      throw new PostmarkError(body.Message || `Postmark answered ${response.status}.`, response.status, body.ErrorCode ?? null);
    }
    return { messageId: body.MessageID ?? null };
  };
}

/**
 * Most Mannon emails are plain-text templates filled with buyer and merchant
 * text, passed as both html and text. Those are always escaped, so nothing a
 * buyer types can become markup. HTML is sent as-is only when the caller wrote
 * real HTML (different from the text body, with real tags).
 */
function isPlainText(message: { html: string; text?: string | null }): boolean {
  if (message.text != null) {
    // The same text, or the same text with new lines turned into <br>.
    if (message.html === message.text || message.html === message.text.replace(/\r?\n/g, "<br>")) return true;
  }
  return !/<\/?(p|br|div|a|table|tr|td|th|tbody|strong|em|b|i|u|ul|ol|li|h[1-6]|span|img|html|body|hr)\b[^>]*>/i.test(message.html);
}

/** The plain text to escape: the text body when the html is a copy of it. */
function plainSource(message: { html: string; text?: string | null }): string {
  return message.text != null && message.html !== message.text && message.html === message.text.replace(/\r?\n/g, "<br>")
    ? message.text
    : message.html;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
