-- Phase 2 (5.4): how many days before expiry the "about to expire" email goes out; 0 = off.
ALTER TABLE "FollowupPolicy" ADD COLUMN     "expiryWarningDays" INTEGER NOT NULL DEFAULT 1;
