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

export { draftTextFeature, type DraftTextInput } from "./draft-text";
export { offerCounterFeature, type OfferCounterInput } from "./offer-counter";
