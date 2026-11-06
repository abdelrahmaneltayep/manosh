// Where every "Upgrade" / "See Growth" call to action goes. Plans live on
// /app/plans (Pricing plans in the nav); Settings no longer shows plan cards, so
// linking there was a dead end. `?upgrade=` names the plan the feature needs, so
// the plans page can say why the merchant is there and highlight that plan.
export function upgradeUrl(plan?: string | null): string {
  return plan ? `/app/plans?upgrade=${encodeURIComponent(String(plan).toLowerCase())}` : "/app/plans";
}
