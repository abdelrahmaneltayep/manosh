import type { HeadersFunction, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import {
  Outlet,
  Link,
  Form,
  useLoaderData,
  useLocation,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import portalStyles from "../styles/portal.css?url";
import { portalErrorContent } from "../lib/portal-error";
import { readLocaleCookie, I18N_ENABLED } from "../services/i18n.server";
import { localeDir, localeName, SUPPORTED_LOCALES, t } from "../lib/i18n";
import { PWA_ENABLED } from "../services/pwa.server";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: portalStyles },
  // F18 — installable PWA. The routes 404 when the flag is off, and the SW
  // registration below is guarded, so this is safe as a static link.
  { rel: "manifest", href: "/portal/manifest.webmanifest" },
];

// Non-embedded buyer portal shell. Deliberately light — no Polaris/App Bridge
// bundle — so it renders fast (p95 < 500ms). F16: the shell mirrors RTL for
// Arabic from the session locale cookie and offers a language switch.

// Standalone surface: forbid framing to prevent clickjacking.
export const headers: HeadersFunction = () => ({
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const locale = I18N_ENABLED() ? (await readLocaleCookie(request)) ?? "en" : "en";
  return { locale, dir: localeDir(locale), i18nOn: I18N_ENABLED(), locales: SUPPORTED_LOCALES, pwaOn: PWA_ENABLED() };
};

// F18 — progressive enhancement. Only runs when the flag is on and the browser
// supports service workers; older browsers just skip it and keep the plain
// portal. Registers the SW scoped to /portal/ and reports installs for the
// pwa_installed event. Kept inline (no bundle) to preserve the light shell.
const PWA_BOOTSTRAP = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/portal/sw.js', { scope: '/portal/' }).catch(function () {});
  });
  window.addEventListener('appinstalled', function () {
    try { fetch('/portal/pwa/installed', { method: 'POST' }); } catch (e) {}
  });
}
`;

export default function PortalLayout() {
  const { locale, dir, i18nOn, locales, pwaOn } = useLoaderData<typeof loader>();
  const location = useLocation();
  return (
    <main className="portal" dir={dir} lang={locale}>
      {pwaOn && <script dangerouslySetInnerHTML={{ __html: PWA_BOOTSTRAP }} />}
      {i18nOn && (
        <div className="portal-localebar">
          <span className="muted">{t(locale, "language")}:</span>
          {locales.map((l) => (
            <Form method="post" action="/portal/locale" key={l.code} style={{ display: "inline" }}>
              <input type="hidden" name="locale" value={l.code} />
              <input type="hidden" name="redirectTo" value={location.pathname} />
              <button type="submit" className={`portal-localebtn${l.code === locale ? " on" : ""}`} aria-current={l.code === locale ? "true" : undefined}>
                {localeName(l.code)}
              </button>
            </Form>
          ))}
        </div>
      )}
      <Outlet />
    </main>
  );
}

// Buyer-portal error boundary. Replaces the layout on any thrown error in a
// portal route (e.g. a 404 "Quote not found"), so a buyer sees friendly,
// plain-language copy instead of a raw stack trace. It re-renders the <main>
// landmark because it stands in for PortalLayout above.
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const { title, body } = portalErrorContent(status);
  return (
    <main className="portal">
      <section className="portal-card" role="alert" aria-live="assertive">
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        <p>
          <Link to="/portal" className="portal-link">
            ← Back to your portal
          </Link>
        </p>
      </section>
    </main>
  );
}
