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
          Mannon gives your B2B buyers a quote inbox and one-tap reorder, built
          on your store&rsquo;s native B2B — no rebuilt pricing, no spreadsheets.
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
              <span className={styles.hint}>e.g. my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
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
              Past orders become reorder cards your buyers can send from their
              phone.
            </span>
          </li>
          <li className={styles.card}>
            <span className={styles.ic} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <strong>Built on native B2B</strong>
            <span className={styles.cardText}>
              Companies, catalogs, and payment terms stay Shopify&rsquo;s —
              Mannon just orchestrates.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
