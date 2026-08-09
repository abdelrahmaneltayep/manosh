-- Dual-mode: merchant on/off toggle for Claude drafting. Default true so
-- existing shops keep Claude on wherever their plan grants it.
ALTER TABLE "Shop" ADD COLUMN "claudeEnabled" BOOLEAN NOT NULL DEFAULT true;
