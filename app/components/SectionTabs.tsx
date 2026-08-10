import { useNavigate, useRouteLoaderData } from "@remix-run/react";
import { Tabs } from "@shopify/polaris";
import { SECTION_GROUPS, GROUP_OF_TAB, type NavFlags } from "../lib/nav";

/**
 * In-page tab bar for the merged information architecture (NAV-MIGRATION.md):
 * the 22 old pages fold into 7 nav parents, and each old page becomes a tab.
 * Rendered INSIDE each page's own <Page> (right under <TitleBar>), so every page
 * keeps its own loader/action/primaryAction/ErrorBoundary untouched — this is a
 * navigation layer, not a rewrite.
 *
 * The group/tab data + flags come from shared, unit-tested sources (lib/nav.ts +
 * the app-shell loader), so a tab is shown only when its MANNON_FF_* flag is on —
 * exactly the same gate the left-nav uses, so we never link to a route that
 * 404s. Selection is URL-driven; Polaris sets aria-selected and handles keyboard.
 */
export function SectionTabs({ active }: { active: string }) {
  const navigate = useNavigate();
  const shell = useRouteLoaderData("routes/app") as { nav?: NavFlags } | undefined;
  const flags = shell?.nav;

  const group = GROUP_OF_TAB[active];
  const items = group ? SECTION_GROUPS[group] : [];
  // Show a tab when it's the active one, is core (no flag), or its flag is on.
  const shown = items.filter((t) => t.id === active || !t.flag || flags?.[t.flag]);
  if (shown.length <= 1) return null; // nothing to switch between

  const selected = Math.max(0, shown.findIndex((t) => t.id === active));
  const tabs = shown.map((t) => ({
    id: t.id,
    content: t.label,
    accessibilityLabel: t.label,
    panelID: `${t.id}-panel`,
  }));

  return (
    <div style={{ marginBottom: "var(--p-space-400)" }}>
      <Tabs tabs={tabs} selected={selected} onSelect={(i) => navigate(shown[i].url)} fitted={shown.length <= 4} />
    </div>
  );
}
