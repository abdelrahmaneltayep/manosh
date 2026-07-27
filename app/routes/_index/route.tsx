import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <a className={styles.brand} href="/" aria-label="Mannon home">
          <Brandmark />
          <span className={styles.wordmark}>Mannon</span>
        </a>

        <span className={styles.eyebrow}>B2B wholesale, done right</span>
        <h1 className={styles.heading}>
          Wholesale quoting, without the email grind
        </h1>
        <p className={styles.text}>
          Mannon gives your B2B buyers a quote inbox, a passwordless portal, and
          one-tap reorder — priced on real Shopify draft orders, no spreadsheets.
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
              />
              <span className={styles.hint}>
                e.g: my-shop-domain.myshopify.com
              </span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}

        <ul className={styles.list}>
          <li className={styles.card}>
            <span className={styles.cardIcon} aria-hidden="true">
              ↺
            </span>
            <strong>Quote loop</strong>
            <span>
              Buyers request, you counter, they accept — and it becomes a real
              Shopify draft order.
            </span>
          </li>
          <li className={styles.card}>
            <span className={styles.cardIcon} aria-hidden="true">
              ⚡
            </span>
            <strong>One-tap reorder</strong>
            <span>
              Past orders become reorder cards your buyers can send from their
              phone.
            </span>
          </li>
          <li className={styles.card}>
            <span className={styles.cardIcon} aria-hidden="true">
              ✦
            </span>
            <strong>Passwordless buyer portal</strong>
            <span>
              Buyers accept, counter, or reorder from a secure magic link — no
              password, no login wall.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// Mannon brandmark: an "M" drawn as a rounded chevron with a lime seed — the
// clover mark from the App Store listing. Inline SVG so it needs no asset fetch.
function Brandmark() {
  return (
    <svg
      className={styles.mark}
      viewBox="0 0 40 40"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9 28.5V12.5l9.5 9 9.5-9v16"
        fill="none"
        stroke="#4F46E5"
        strokeWidth="4.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="25.5" r="3" fill="#B6E02F" />
    </svg>
  );
}
