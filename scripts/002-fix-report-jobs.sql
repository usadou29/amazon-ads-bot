-- ============================================================
-- Migration 002: Align report_jobs table with Drizzle schema
--
-- Problem: report_jobs table exists but is missing columns
-- that the ReportsService needs (completed_at, downloaded_at,
-- ingested_at, download_url, records_processed, error_message).
--
-- This script is idempotent: each ADD COLUMN uses IF NOT EXISTS.
-- Safe to run multiple times.
-- ============================================================

-- Lifecycle timestamps
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ;
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ;

-- Report data
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS amazon_report_id VARCHAR(200);
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS download_url TEXT;
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS records_processed INTEGER DEFAULT 0;
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Date range
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS date_from DATE;
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS date_to DATE;

-- Status (with default)
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending';

-- Timestamps
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Profile FK
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES marketplace_profiles(id) ON DELETE CASCADE;

-- Report type
ALTER TABLE report_jobs ADD COLUMN IF NOT EXISTS report_type VARCHAR(50);

-- ── Indexes (IF NOT EXISTS) ───────────────────────────────

CREATE INDEX IF NOT EXISTS idx_report_jobs_status ON report_jobs(status);

-- Unique constraint: one report per (profile, type, date range)
-- This may fail if duplicates exist; wrapped in DO block
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_jobs_profile_id_report_type_date_from_date_to_key'
  ) THEN
    ALTER TABLE report_jobs
      ADD CONSTRAINT report_jobs_profile_id_report_type_date_from_date_to_key
      UNIQUE (profile_id, report_type, date_from, date_to);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Unique constraint already exists or cannot be created: %', SQLERRM;
END $$;

-- ── Also ensure daily_metrics table has all columns ───────

ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS entity_key TEXT;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES marketplace_profiles(id) ON DELETE CASCADE;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS marketplace VARCHAR(10);
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS currency VARCHAR(3);
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS impressions INTEGER DEFAULT 0;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS clicks INTEGER DEFAULT 0;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS spend DECIMAL(12,4) DEFAULT 0;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS sales DECIMAL(12,4) DEFAULT 0;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS orders INTEGER DEFAULT 0;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS units INTEGER DEFAULT 0;
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS attribution_window VARCHAR(10) DEFAULT '7d';
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE daily_metrics ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- daily_metrics indexes
CREATE INDEX IF NOT EXISTS idx_metrics_entity ON daily_metrics(entity_type, entity_key);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON daily_metrics(date);
CREATE INDEX IF NOT EXISTS idx_metrics_profile_date ON daily_metrics(profile_id, date);

-- daily_metrics unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_metrics_entity_type_entity_key_date_key'
  ) THEN
    ALTER TABLE daily_metrics
      ADD CONSTRAINT daily_metrics_entity_type_entity_key_date_key
      UNIQUE (entity_type, entity_key, date);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'daily_metrics unique constraint already exists or cannot be created: %', SQLERRM;
END $$;

-- ── Done ──────────────────────────────────────────────────
-- After running this, restart the server and re-test:
-- curl -X POST http://localhost:3001/api/reports/request \
--   -H "Content-Type: application/json" \
--   -d '{"adAccountId":"b0d262f2-e05b-4414-998f-49c4e8dfcb86"}'
