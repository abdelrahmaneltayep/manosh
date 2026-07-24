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
        <h1 className={styles.heading}>Wholesale quoting, without the email grind</h1>
        <p className={styles.text}>
          Mannon gives your B2B buyers a quote inbox, a passwordless portal, and
          one-tap reorder — priced on real Shopify draft orders, no spreadsheets.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Quote loop</strong>. Buyers request, you counter, they
            accept — and it becomes a real Shopify draft order.
          </li>
          <li>
            <strong>One-tap reorder</strong>. Past orders become reorder cards
            your buyers can send from their phone.
          </li>
          <li>
            <strong>Passwordless buyer portal</strong>. Buyers accept, counter,
            or reorder from a secure magic link — no password, no login wall.
          </li>
        </ul>
      </div>
    </div>
  );
}
