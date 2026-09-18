import type { LinksFunction, MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { useCallback, useEffect, useRef, useState } from "react";
import tourStyles from "../styles/demo-tour.css?url";
import { TOUR_SCENES } from "../demo-tour/scenes";

/**
 * Guided merchant tour: the real admin screens rendered with sample data, one
 * step at a time. The merchant app runs inside Shopify Admin, so a public demo
 * of it has to be a tour, and every frame is labelled as a sample screen.
 * Scenes are generated from the same set as the App Store screencast.
 */

const STAGE_W = 1920;
const STAGE_H = 1080;

export const links: LinksFunction = () => [{ rel: "stylesheet", href: tourStyles }];

export const meta: MetaFunction = () => [
  { title: "Mannon merchant tour — the admin, screen by screen" },
];

export default function DemoTour() {
  const [i, setI] = useState(0);
  const [scale, setScale] = useState(0.5);
  const viewport = useRef<HTMLDivElement>(null);
  const total = TOUR_SCENES.length;
  const scene = TOUR_SCENES[i];

  const go = useCallback((n: number) => setI(() => Math.min(total - 1, Math.max(0, n))), [total]);

  // Fit the 1920×1080 stage to the container width (never upscale).
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / STAGE_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go]);

  return (
    <>
      <div className="tour-top">
        <div>
          <span className="demo-pill">Merchant tour · sample data</span>
          <p className="tour-step" aria-live="polite">
            Step {i + 1} of {total}
          </p>
          <h1 className="tour-heading">{scene.title}</h1>
          <p className="tour-blurb">{scene.blurb}</p>
        </div>
        <div className="tour-btns">
          <button type="button" className="demo-btn-secondary" onClick={() => go(i - 1)} disabled={i === 0}>
            ← Previous
          </button>
          <button type="button" className="demo-btn" onClick={() => go(i + 1)} disabled={i === total - 1}>
            Next →
          </button>
        </div>
      </div>

      <div className="tour-viewport" ref={viewport} style={{ height: Math.round(STAGE_H * scale) }}>
        <span className="tour-sample">Sample screen</span>
        <div
          className="tour-stage"
          style={{ transform: `scale(${scale})` }}
          aria-hidden="true"
          // Generated from our own scene set (app/demo-tour/scenes.ts); never user content.
          dangerouslySetInnerHTML={{ __html: `<div class="tour-scene">${scene.html}</div>` }}
        />
      </div>

      <nav className="tour-nav" aria-label="Tour steps">
        <ol className="tour-dots">
          {TOUR_SCENES.map((s, n) => (
            <li key={s.id}>
              <button
                type="button"
                className="tour-dot"
                aria-label={`Step ${n + 1}: ${s.title}`}
                aria-current={n === i ? "step" : undefined}
                onClick={() => go(n)}
              />
            </li>
          ))}
        </ol>
        <span className="demo-note">Use ← → on your keyboard</span>
      </nav>

      <section className="tour-end" aria-labelledby="tour-end-h">
        <div>
          <h2 id="tour-end-h">Now try the buyer side for real</h2>
          <p>Open a live buyer portal on our demo store: accept a quote, reorder, paste an order.</p>
        </div>
        <div className="tour-btns">
          <a className="demo-btn" href="/demo/buyer">
            Open the buyer demo
          </a>
          <Link className="demo-btn-secondary" to="/">
            Install on your store
          </Link>
        </div>
      </section>
    </>
  );
}
