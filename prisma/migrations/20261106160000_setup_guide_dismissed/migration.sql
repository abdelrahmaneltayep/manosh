-- Home setup guide: the merchant hid it (append-only Event, so dismissal persists).
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'SETUP_GUIDE_DISMISSED';
