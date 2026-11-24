// Wording for every place that offers to email someone.
//
// Mannon has no email provider connected yet (services/mailer.server.ts,
// emailDeliveryEnabled()). While delivery is off the app must not promise a
// message it cannot send, so each "send" action becomes a Copy action: the
// merchant gets the link or text and sends it from their own inbox. When a
// provider is connected the original labels come back; nothing here needs to
// change. Pure, so the wording is unit-tested in both states.

export interface EmailCopy {
  /** Quote detail › secondary action. */
  quotePdfAction: string;
  /** Follow-ups › per-quote button. */
  reminderAction: (hasCustomMessage: boolean) => string;
  reminderPlaceholder: string;
  reminderDone: string;
  /** Buyers › Reps. */
  repInviteAction: string;
  repInviteDone: string;
  /** Buyers › Applications. */
  applicationsIntro: string;
  decisionAction: string;
  decisionHelp: (claude: boolean) => string;
  rejectConfirm: string;
  /** Settings › Notifications. */
  notificationsIntro: string;
  notificationsRecipient: (to: string) => string;
  /** After a counter is saved on a quote. */
  counterDone: string;
}

const ON: EmailCopy = {
  quotePdfAction: "Email PDF to buyer",
  reminderAction: (custom) => (custom ? "Send this message" : "Send default reminder"),
  reminderPlaceholder: "Leave blank to send your default reminder, or draft one with Claude above.",
  reminderDone: "Reminder sent.",
  repInviteAction: "Send invite",
  repInviteDone: "Rep invited.",
  applicationsIntro: "Approve buyers before they see your wholesale prices. Each decision emails the applicant.",
  decisionAction: "Send decision",
  decisionHelp: (claude) =>
    claude
      ? "Leave blank to send the default decision email, or draft a note with Claude."
      : "Leave blank to send the default decision email.",
  rejectConfirm:
    "The applicant gets the default decline email and won't see your wholesale prices. To add a personal note, use “Respond with a note” below instead.",
  notificationsIntro:
    "The emails Mannon sends for you. Open one to change its subject and message, or draft new wording with Claude. Emails you haven’t changed use Mannon’s default wording.",
  notificationsRecipient: (to) => `Sent to: ${to}`,
  counterDone: "Counter sent to the buyer.",
};

const OFF: EmailCopy = {
  quotePdfAction: "Copy buyer link",
  reminderAction: (custom) => (custom ? "Copy this message" : "Copy reminder"),
  reminderPlaceholder: "Leave blank to copy your default reminder, or write your own.",
  reminderDone: "Reminder ready to copy.",
  repInviteAction: "Create sign-in link",
  repInviteDone: "Rep added. Copy their sign-in link below and share it with them.",
  applicationsIntro: "Approve buyers before they see your wholesale prices. You tell the applicant; Mannon prepares the message for you to copy.",
  decisionAction: "Save decision",
  decisionHelp: (claude) =>
    claude
      ? "Leave blank to use the default wording, or draft a note with Claude. You get the message to copy."
      : "Leave blank to use the default wording. You get the message to copy.",
  rejectConfirm:
    "The applicant won't see your wholesale prices. Mannon doesn't notify them, so let them know yourself. To prepare a note, use “Respond with a note” below instead.",
  notificationsIntro:
    "The wording Mannon will use once a sender is connected. You can prepare each subject and message now; nothing is delivered yet.",
  notificationsRecipient: (to) => `For: ${to}`,
  counterDone: "Counter saved. The buyer sees it in their portal. Copy the buyer link to tell them.",
};

export function emailCopy(deliveryEnabled: boolean): EmailCopy {
  return deliveryEnabled ? ON : OFF;
}

/** One sentence that explains the state, for banners and help text. */
export const EMAIL_OFF_NOTICE =
  "Mannon isn’t connected to a sender yet, so it doesn’t deliver messages. Copy the link or text and share it yourself.";

/** Words that claim a message goes out. No OFF string may contain one. */
export const DELIVERY_CLAIM = /\b(send|sends|sent|sending|e-?mail|e-?mails|e-?mailed|e-?mailing)\b/i;
