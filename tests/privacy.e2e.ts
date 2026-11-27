import { describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

// The public privacy policy the App Store listing links to. Its contact
// address must be one that receives mail: the old mannon.app domain was never
// registered, so mail to it bounced.
describe("privacy policy", { tags: ["smoke", "public"] }, () => {
  test("names a working support address and no mannon.app address", async ({ app, screen }) => {
    await app.open("/privacy");
    await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
    await expect(screen.getByText(/eltayep@support-mannon\.com/)).toBeVisible();
    await expect(screen.getByText(/mannon\.app/)).toHaveCount(0);
  });
});
