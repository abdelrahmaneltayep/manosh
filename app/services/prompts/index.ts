// Per-feature Claude prompt registry — the aggregator.
//
// The core (types, SHARED_RULES, registerFeature, getFeaturePrompt) lives in
// registry.ts. Each dual-mode feature (F1–F15) registers itself in its own file
// under this directory; importing them here (for their registration side-effect)
// is what makes them resolvable via getFeaturePrompt. Adding feature N =
// dropping a new file + one import line here.

export {
  SHARED_RULES,
  withSharedRules,
  registerFeature,
  getFeaturePrompt,
  listFeatureKeys,
  type FeaturePrompt,
} from "./registry";

// --- registered features (import for side-effect registration) ---------------
import "./draft-text"; // F0 seed — generic drafting helper
import "./offer-counter"; // F21 Make an Offer — counter draft
import "./portal-translations"; // F16 i18n — portal string translations
import "./followup-message"; // F8 follow-ups — reminder body draft
import "./wholesale-decision"; // F6 wholesale — decision note draft
import "./thankyou-message"; // F24.1 quote-form — thank-you copy draft
import "./email-template"; // F2 invoice/reminder email copy draft
import "./quote-request-reply"; // F17 quote requests — acknowledgement reply draft

export { draftTextFeature, type DraftTextInput } from "./draft-text";
export { offerCounterFeature, type OfferCounterInput } from "./offer-counter";
export { portalTranslationsFeature, type TranslationsInput } from "./portal-translations";
export { followupMessageFeature, type FollowupMessageInput } from "./followup-message";
export { wholesaleDecisionFeature, type WholesaleDecisionInput, type WholesaleDecision } from "./wholesale-decision";
export { thankYouFeature, type ThankYouInput } from "./thankyou-message";
export { emailTemplateFeature, type EmailTemplateInput } from "./email-template";
export { quoteRequestReplyFeature, type QuoteRequestReplyInput } from "./quote-request-reply";
