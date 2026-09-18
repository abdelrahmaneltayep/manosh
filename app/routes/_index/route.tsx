import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";
import { isDemoEnabled } from "../../services/demo.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login), showDemo: isDemoEnabled() };
};

export default function App() {
  const { showForm, showDemo } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.blobTop} aria-hidden="true" />
      <div className={styles.blobBottom} aria-hidden="true" />

      <div className={styles.content}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            M<span className={styles.dot} />
          </span>
          <span className={styles.wordmark}>mannon</span>
        </div>

        <p className={styles.pill}>B2B wholesale, done right</p>

        <h1 className={styles.heading}>
          Wholesale quoting,
          <br />
          <span className={styles.hl}>without the email grind</span>
        </h1>

        <p className={styles.text}>
          Quote, counter with Claude, and reorder in one tap — the B2B buying
          workflow your store is missing.
        </p>
        <p className={styles.accent}>
          Built on Shopify&rsquo;s native B2B — every price comes from Shopify.
        </p>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span className={styles.labelText}>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="my-shop-domain.myshopify.com"
                aria-describedby="shop-hint"
              />
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
            <span id="shop-hint" className={styles.hint}>
              e.g. my-shop-domain.myshopify.com
            </span>
          </Form>
        )}

        {showDemo && (
          <p className={styles.demo}>
            <a className={styles.buttonSecondary} href="/demo">
              Try the demo
            </a>
            <span className={styles.demoHint}>
              A live buyer portal on our demo store, plus a guided tour of the
              merchant side. No install, no sign-up.
            </span>
          </p>
        )}

        <ul className={styles.list}>
          <li className={styles.card}>
            <span className={styles.ic} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8" />
                <path d="M20 3v5h-5" />
                <path d="M20 12a8 8 0 0 1-13.7 5.7L4 16" />
                <path d="M4 21v-5h5" />
              </svg>
            </span>
            <strong>Quote loop</strong>
            <span className={styles.cardText}>
              Buyers request, you counter, they accept — and it becomes a real
              Shopify draft order.
            </span>
          </li>
          <li className={styles.card}>
            <span className={styles.ic} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 5h2l2 11h10l2-8H7" />
                <circle cx="9" cy="20" r="1.4" />
                <circle cx="17" cy="20" r="1.4" />
              </svg>
            </span>
            <strong>One-tap reorder</strong>
            <span className={styles.cardText}>
              Past orders become reorder cards — a fresh draft, re-priced live
              by Shopify, from any phone.
            </span>
          </li>
          <li className={styles.card}>
            <span className={styles.ic} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
                <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
              </svg>
            </span>
            <strong>Draft with Claude</strong>
            <span className={styles.cardText}>
              Claude drafts counters, replies, and carts. You review and send —
              it never acts on its own.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
