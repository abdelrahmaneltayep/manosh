-- App Store review 5.1.2: a theme app block must display in the storefront as
-- soon as a merchant adds it. The Request-a-Quote / Add-to-Quote / cart→quote
-- blocks read the merchant's widget toggle, which defaulted to OFF, so a fresh
-- install showed nothing. New shops start ON; existing rows are switched on too
-- (the app has no published merchants yet — only dev and review stores).
ALTER TABLE "Shop" ALTER COLUMN "quoteWidgetEnabled" SET DEFAULT true;
UPDATE "Shop" SET "quoteWidgetEnabled" = true;
