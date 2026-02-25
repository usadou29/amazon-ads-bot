-- Migration: Add lifecycle tracking fields to books table
-- Replaces the simple daysSincePublish calculation with a proper lifecycle state machine
-- Supports: auto-detection, manual override, hysteresis (pending phase), cooldown

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS lifecycle_phase VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_source VARCHAR(10) DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_previous_phase VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_pending_phase VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_pending_since TIMESTAMPTZ DEFAULT NULL;

-- Add constraint on lifecycle_source
ALTER TABLE books
  ADD CONSTRAINT chk_lifecycle_source CHECK (lifecycle_source IN ('auto', 'manual'));

-- Add constraint on lifecycle_phase values
ALTER TABLE books
  ADD CONSTRAINT chk_lifecycle_phase CHECK (
    lifecycle_phase IS NULL OR lifecycle_phase IN ('launch', 'scale', 'evergreen', 'relaunch')
  );

-- Add constraint on lifecycle_pending_phase values  
ALTER TABLE books
  ADD CONSTRAINT chk_lifecycle_pending_phase CHECK (
    lifecycle_pending_phase IS NULL OR lifecycle_pending_phase IN ('launch', 'scale', 'evergreen', 'relaunch')
  );

-- Index for cron job: find books needing lifecycle recomputation
CREATE INDEX IF NOT EXISTS idx_books_lifecycle_source ON books (lifecycle_source) WHERE lifecycle_source = 'auto';
