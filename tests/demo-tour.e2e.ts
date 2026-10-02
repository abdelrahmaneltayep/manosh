import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

// /demo/tour — the guided merchant tour: a stepper over sample screens with
// buttons, dots and arrow keys. Keyboard-navigable end to end (CLAUDE.md DoD).
describe("merchant tour", { tags: ["smoke", "public", "demo", "a11y"] }, () => {
  test("steps forward and back with the buttons", async ({ app, screen }) => {
    await app.open("/demo/tour");
    const step = screen.getByText(/^Step \d+ of \d+$/);
    await expect(step).toHaveText(/^Step 1 of \d+$/);
    await expect(screen.getByRole("button", "← Previous")).toBeDisabled();
    await expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(screen.getByText("Sample screen")).toBeVisible();

    await screen.getByRole("button", "Next →").tap();
    await expect(step).toHaveText(/^Step 2 of \d+$/);
    await expect(screen.getByRole("button", "← Previous")).toBeEnabled();

    await screen.getByRole("button", "← Previous").tap();
    await expect(step).toHaveText(/^Step 1 of \d+$/);
  });

  test("arrow keys move between steps", async ({ app, screen, browser }) => {
    await app.open("/demo/tour");
    const step = screen.getByText(/^Step \d+ of \d+$/);
    await browser.keyboard.press("ArrowRight");
    await expect(step).toHaveText(/^Step 2 of \d+$/);
    await browser.keyboard.press("ArrowRight");
    await expect(step).toHaveText(/^Step 3 of \d+$/);
    await browser.keyboard.press("ArrowLeft");
    await expect(step).toHaveText(/^Step 2 of \d+$/);
  });

  test("the dots jump to a step and the last step disables Next", async ({ app, screen }) => {
    await app.open("/demo/tour");
    const dots = screen.getByRole("navigation", "Tour steps").getByRole("button");
    const total = await dots.count();
    expect(total).toBeGreaterThan(1);
    await expect(screen.getByText(`Step 1 of ${total}`)).toBeVisible();

    await dots.last().tap();
    await expect(screen.getByText(`Step ${total} of ${total}`)).toBeVisible();
    await expect(screen.getByRole("button", "Next →")).toBeDisabled();
    await expect(dots.last()).toHaveAttribute("aria-current", "step");

    // The tour ends on the hand-off to the live buyer demo.
    await expect(screen.getByRole("heading", "Now try the buyer side for real")).toBeVisible();
    await expect(screen.getByRole("link", "Open the buyer demo")).toBeVisible();
  });
});
