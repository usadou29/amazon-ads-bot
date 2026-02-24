-- ============================================
-- Migration: Add bid cooldown tracking fields
-- ============================================
-- Adds fields to keywords and product_targets tables
-- to track the last bid modification and enable cooldown logic.

-- Keywords table
ALTER TABLE keywords
  ADD COLUMN IF NOT EXISTS last_bid_change_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_bid_change_type VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS previous_bid DECIMAL(10, 4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS new_bid DECIMAL(10, 4) DEFAULT NULL;

-- Product targets table
ALTER TABLE product_targets
  ADD COLUMN IF NOT EXISTS last_bid_change_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_bid_change_type VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS previous_bid DECIMAL(10, 4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS new_bid DECIMAL(10, 4) DEFAULT NULL;

-- Index on last_bid_change_at for quick cooldown lookups
CREATE INDEX IF NOT EXISTS idx_keywords_last_bid_change ON keywords (last_bid_change_at) WHERE last_bid_change_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_targets_last_bid_change ON product_targets (last_bid_change_at) WHERE last_bid_change_at IS NOT NULL;
