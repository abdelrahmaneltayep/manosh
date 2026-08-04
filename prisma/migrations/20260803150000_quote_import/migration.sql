-- Feature 25.3: bulk CSV import (add many products to a quote / create many quotes).

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'QUOTE_IMPORTED';
