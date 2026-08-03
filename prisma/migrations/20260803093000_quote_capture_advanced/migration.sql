-- Feature 24 PR-8b: advanced form builder — per-form success message.
-- (Conditional logic lives inside the QuoteForm.fields JSON as an optional
-- per-field `showIf`, so it needs no column.)

ALTER TABLE "QuoteForm" ADD COLUMN "successMessage" TEXT;
