// Config health — pure, value-free summary of runtime configuration. Used by the
// owner-only /app/debug/config route and shares its placeholder detection with the
// boot guard. It NEVER returns secret values — only presence booleans, counts, and
// safe derived signals — so it's safe to render in the admin UI.

export type EnvLike = Record<string, string | undefined>;

/** True when a value is still a copy-paste placeholder rather than a real secret. */
export function isPlaceholder(v: string | undefined): boolean {
  return !!v && /^<.*>$|from partners|changeme|placeholder|your-|example\.com/i.test(v);
}

function present(v: string | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}

export interface VarStatus {
  name: string;
  set: boolean;
  placeholder: boolean;
}

export interface FlagStatus {
  flag: string;
  feature: string;
  on: boolean;
}

export interface ConfigHealth {
  ok: boolean;
  core: VarStatus[];
  integrations: VarStatus[];
  flags: FlagStatus[];
  requiredMissing: string[];
  requiredPlaceholder: string[];
  /** SHOPIFY_API_KEY matches the client_id shape (32 hex) — checked without revealing it. */
  apiKeyLooksValid: boolean;
}

// Required for the embedded admin to load at all.
export const CORE_REQUIRED = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "SESSION_SECRET",
  "DATABASE_URL",
] as const;

// Optional — only needed by the feature that uses them.
export const OPTIONAL_INTEGRATIONS = [
  "ANTHROPIC_API_KEY",
  "MANNON_ENCRYPTION_KEY",
  "MANNON_VAPID_PUBLIC_KEY",
  "MANNON_VAPID_PRIVATE_KEY",
  "QBO_CLIENT_ID",
  "QBO_CLIENT_SECRET",
  "XERO_CLIENT_ID",
  "XERO_CLIENT_SECRET",
  "CRON_SECRET",
  "MANNON_MAIL_FROM",
  "MANNON_MERCHANT_ALERT_EMAIL",
  "SENTRY_DSN",
  "POSTHOG_API_KEY",
] as const;

// Feature flags → the feature they gate.
export const FEATURE_FLAGS: Array<{ flag: string; feature: string }> = [
  { flag: "MANNON_FF_AI_QUOTE", feature: "F1 AI Quote Assistant" },
  { flag: "MANNON_FF_CREDIT", feature: "F2 Net terms + credit" },
  { flag: "MANNON_FF_PRICELISTS", feature: "F3 Price lists" },
  { flag: "MANNON_FF_ORDERPAD", feature: "F4 Quick/AI order pad" },
  { flag: "MANNON_FF_COMPANY_ACCOUNTS", feature: "F5 Company accounts" },
  { flag: "MANNON_FF_WHOLESALE_REG", feature: "F6 Wholesale registration" },
  { flag: "MANNON_FF_QUOTE_ANALYTICS", feature: "F7 Quote analytics" },
  { flag: "MANNON_FF_FOLLOWUPS", feature: "F8 Follow-ups & expiry" },
  { flag: "MANNON_FF_MOQ", feature: "F9 MOQ / order rules" },
  { flag: "MANNON_FF_ACCOUNTING_SYNC", feature: "F10 Accounting sync" },
  { flag: "MANNON_FF_CUSTOM_CATALOGS", feature: "F11 Custom catalogs" },
  { flag: "MANNON_FF_REP_PORTAL", feature: "F12 Sales-rep portal" },
  { flag: "MANNON_FF_FLEX_PAY", feature: "F13 Flexible payments" },
  { flag: "MANNON_FF_TAX_VAT", feature: "F14 Tax / VAT" },
  { flag: "MANNON_FF_ERP_SYNC", feature: "F15 ERP / inventory sync" },
  { flag: "MANNON_FF_I18N", feature: "F16 Multi-currency & language" },
  { flag: "MANNON_FF_QUOTE_WIDGET", feature: "F17 Storefront quote widget" },
  { flag: "MANNON_FF_BUYER_PWA", feature: "F18 Buyer PWA & one-tap reorder" },
  { flag: "MANNON_FF_CATALOG_SHARE", feature: "F19 Catalog sharing & discovery" },
  { flag: "MANNON_FF_WHITE_LABEL", feature: "F20 White-label / agency" },
];

function statusOf(name: string, env: EnvLike): VarStatus {
  return { name, set: present(env[name]), placeholder: isPlaceholder(env[name]) };
}

/** Build a value-free config health summary from an env map. Pure. */
export function summarizeConfigHealth(env: EnvLike): ConfigHealth {
  const core = CORE_REQUIRED.map((n) => statusOf(n, env));
  const integrations = OPTIONAL_INTEGRATIONS.map((n) => statusOf(n, env));
  const flags: FlagStatus[] = FEATURE_FLAGS.map((f) => ({ ...f, on: env[f.flag] === "true" }));

  const requiredMissing = core.filter((s) => !s.set).map((s) => s.name);
  const requiredPlaceholder = core.filter((s) => s.placeholder).map((s) => s.name);
  const apiKeyLooksValid = /^[0-9a-f]{32}$/i.test((env.SHOPIFY_API_KEY ?? "").trim());

  return {
    ok: requiredMissing.length === 0 && requiredPlaceholder.length === 0,
    core,
    integrations,
    flags,
    requiredMissing,
    requiredPlaceholder,
    apiKeyLooksValid,
  };
}
