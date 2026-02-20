-- Migration: Add Strategy Engine fields to recommendations table
-- These fields support the lifecycle-aware Strategy Engine post-processing layer.
-- The StrategyEngine scores and tags each recommendation based on the book's lifecycle phase.

-- Strategy score (0-100): computed by the scoring matrix. 70+ = recommended for lifecycle.
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS strategy_score INTEGER;

-- Human-readable label for the strategy (e.g., "Recommandé en Scaling", "Trop agressif en Launch")
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS strategy_label VARCHAR(255);

-- Risk level assessed by the Strategy Engine (low / medium / high)
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20);

-- Whether this recommendation is the top-scored for its entity+lifecycle combination
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS recommended_for_lifecycle BOOLEAN DEFAULT FALSE;

-- Whether user consent is required before applying (mainly for Launch phase)
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS requires_consent BOOLEAN DEFAULT FALSE;

-- Level of consent: 'none' (no consent), 'basic' (info modal), 'reinforced' (explicit budget confirmation)
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS consent_level VARCHAR(20) DEFAULT 'none';

-- Index for quick lookup of recommended recos
CREATE INDEX IF NOT EXISTS idx_reco_strategy ON recommendations (recommended_for_lifecycle, strategy_score DESC)
WHERE status = 'pending';
