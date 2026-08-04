// F25 Quote Ops & Conversion dark-launch flag. Gates the merchant-side
// convert-to-order, quote PDF (download + resend), duplicate, bulk CSV import,
// and the native customer-account quotes endpoint. Off by default so the whole
// pack can be dark-launched independently of plan gating. When off, the F25
// routes 404 / return not-available and their admin UI is hidden.
export const QUOTE_OPS_ENABLED = () => process.env.MANNON_FF_QUOTE_OPS === "true";
