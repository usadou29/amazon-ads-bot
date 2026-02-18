-- ============================================
-- AMAZON ADS BOT — Migration 001 : Schéma complet
-- Base : Supabase (PostgreSQL 14+)
-- Source : ArchitectureV1.pdf + schéma Drizzle
-- ============================================
-- IMPORTANT : Exécuter ce script dans le SQL Editor de Supabase
-- en tant que superuser (postgres).
-- ============================================

-- Extension requise
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ──────────────────────────────────────
-- 1. USERS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) UNIQUE NOT NULL,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ──────────────────────────────────────
-- 2. WORKSPACES
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  settings    JSONB DEFAULT '{"default_acos_target": 40, "notification_channels": ["telegram"], "timezone": "Europe/Paris", "auto_mode_enabled": false, "dry_run": true}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, name)
);

-- ──────────────────────────────────────
-- 3. AD_ACCOUNTS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_accounts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  refresh_token_encrypted  TEXT NOT NULL,
  token_expires_at         TIMESTAMPTZ,
  amazon_account_id        VARCHAR(100),
  account_name             VARCHAR(255),
  status                   VARCHAR(50) DEFAULT 'active',
  last_sync_at             TIMESTAMPTZ,
  last_error               TEXT,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

-- ──────────────────────────────────────
-- 4. MARKETPLACE_PROFILES
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_profiles (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id              UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  profile_id                 BIGINT NOT NULL,
  marketplace                VARCHAR(10) NOT NULL,
  marketplace_id             VARCHAR(50),
  currency                   VARCHAR(3) NOT NULL,
  is_active                  BOOLEAN DEFAULT true,
  last_sync_at               TIMESTAMPTZ,
  last_search_terms_sync_at  TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ad_account_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_marketplace
  ON marketplace_profiles(ad_account_id, marketplace);

-- ──────────────────────────────────────
-- 5. BOOKS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS books (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asin                VARCHAR(20) NOT NULL,
  marketplace         VARCHAR(10) NOT NULL,
  title               VARCHAR(500),
  author              VARCHAR(255),
  kdp_id              VARCHAR(100),
  publication_date    DATE,
  categories          JSONB DEFAULT '[]'::jsonb,
  tags                JSONB DEFAULT '[]'::jsonb,
  acos_target         DECIMAL(5,2),
  daily_budget_target DECIMAL(10,2),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, asin, marketplace)
);

-- ──────────────────────────────────────
-- 6. PORTFOLIOS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            UUID NOT NULL REFERENCES marketplace_profiles(id) ON DELETE CASCADE,
  amazon_portfolio_id   BIGINT NOT NULL,
  name                  VARCHAR(255) NOT NULL,
  state                 VARCHAR(50),
  budget_amount         DECIMAL(10,2),
  budget_currency       VARCHAR(3),
  budget_policy         VARCHAR(50),
  last_synced_at        TIMESTAMPTZ,
  raw_data              JSONB,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(profile_id, amazon_portfolio_id)
);

-- ──────────────────────────────────────
-- 7. CAMPAIGNS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id           UUID NOT NULL REFERENCES marketplace_profiles(id) ON DELETE CASCADE,
  portfolio_id         UUID REFERENCES portfolios(id) ON DELETE SET NULL,
  amazon_campaign_id   BIGINT NOT NULL,
  name                 VARCHAR(500) NOT NULL,
  campaign_type        VARCHAR(50) NOT NULL DEFAULT 'sponsoredProducts',
  state                VARCHAR(50) NOT NULL,
  targeting_type       VARCHAR(50),
  budget_type          VARCHAR(50) DEFAULT 'daily',
  daily_budget         DECIMAL(10,2),
  bidding_strategy     VARCHAR(50),
  start_date           DATE,
  end_date             DATE,
  last_synced_at       TIMESTAMPTZ,
  raw_data             JSONB,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(profile_id, amazon_campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_profile ON campaigns(profile_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_state ON campaigns(state);

-- ──────────────────────────────────────
-- 8. AD_GROUPS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_groups (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id          UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  amazon_ad_group_id   BIGINT NOT NULL,
  name                 VARCHAR(500) NOT NULL,
  state                VARCHAR(50) NOT NULL,
  default_bid          DECIMAL(10,4),
  last_synced_at       TIMESTAMPTZ,
  raw_data             JSONB,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(campaign_id, amazon_ad_group_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_groups_campaign ON ad_groups(campaign_id);

-- ──────────────────────────────────────
-- 9. KEYWORDS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS keywords (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_group_id         UUID NOT NULL REFERENCES ad_groups(id) ON DELETE CASCADE,
  amazon_keyword_id   BIGINT NOT NULL,
  keyword_text        VARCHAR(500) NOT NULL,
  match_type          VARCHAR(50) NOT NULL,
  state               VARCHAR(50) NOT NULL,
  bid                 DECIMAL(10,4),
  last_synced_at      TIMESTAMPTZ,
  raw_data            JSONB,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ad_group_id, amazon_keyword_id)
);

CREATE INDEX IF NOT EXISTS idx_keywords_ad_group ON keywords(ad_group_id);
CREATE INDEX IF NOT EXISTS idx_keywords_text ON keywords(keyword_text);
CREATE INDEX IF NOT EXISTS idx_keywords_state ON keywords(state);

-- ──────────────────────────────────────
-- 10. NEGATIVE_KEYWORDS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS negative_keywords (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                  UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  ad_group_id                  UUID REFERENCES ad_groups(id) ON DELETE CASCADE,
  amazon_negative_keyword_id   BIGINT NOT NULL,
  keyword_text                 VARCHAR(500) NOT NULL,
  match_type                   VARCHAR(50) NOT NULL,
  state                        VARCHAR(50) NOT NULL DEFAULT 'enabled',
  last_synced_at               TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ DEFAULT now(),
  -- Au moins un des deux doit être renseigné
  CONSTRAINT chk_negative_keyword_parent CHECK (campaign_id IS NOT NULL OR ad_group_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_negatives_campaign ON negative_keywords(campaign_id);
CREATE INDEX IF NOT EXISTS idx_negatives_ad_group ON negative_keywords(ad_group_id);

-- ──────────────────────────────────────
-- 11. PRODUCT_TARGETS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_targets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_group_id       UUID NOT NULL REFERENCES ad_groups(id) ON DELETE CASCADE,
  amazon_target_id  BIGINT NOT NULL,
  expression_type   VARCHAR(50) NOT NULL,
  expression        JSONB NOT NULL,
  state             VARCHAR(50) NOT NULL,
  bid               DECIMAL(10,4),
  last_synced_at    TIMESTAMPTZ,
  raw_data          JSONB,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ad_group_id, amazon_target_id)
);

-- ──────────────────────────────────────
-- 12. SEARCH_TERMS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_terms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          UUID NOT NULL REFERENCES marketplace_profiles(id) ON DELETE CASCADE,
  campaign_id         UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  ad_group_id         UUID NOT NULL REFERENCES ad_groups(id) ON DELETE CASCADE,
  keyword_id          UUID REFERENCES keywords(id) ON DELETE SET NULL,
  product_target_id   UUID REFERENCES product_targets(id) ON DELETE SET NULL,
  amazon_campaign_id  BIGINT,
  amazon_ad_group_id  BIGINT,
  amazon_keyword_id   BIGINT,
  amazon_target_id    BIGINT,
  query               VARCHAR(500) NOT NULL,
  -- Colonnes calculées pour dédup
  query_norm          VARCHAR(500) GENERATED ALWAYS AS (lower(trim(query))) STORED,
  query_hash          VARCHAR(32) GENERATED ALWAYS AS (md5(lower(trim(query)))) STORED,
  match_type          VARCHAR(50),
  targeting_type      VARCHAR(50),
  first_seen_at       TIMESTAMPTZ DEFAULT now(),
  last_seen_at        TIMESTAMPTZ DEFAULT now(),
  status              VARCHAR(50) DEFAULT 'new',
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ad_group_id, query_hash)
);

CREATE INDEX IF NOT EXISTS idx_search_terms_status ON search_terms(status);
CREATE INDEX IF NOT EXISTS idx_search_terms_campaign ON search_terms(campaign_id);
CREATE INDEX IF NOT EXISTS idx_search_terms_query ON search_terms(query);
CREATE INDEX IF NOT EXISTS idx_search_terms_query_norm ON search_terms(query_norm);

-- ──────────────────────────────────────
-- 13. CAMPAIGN_BOOK_MAPPING
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_book_mapping (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id       UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  is_primary    BOOLEAN DEFAULT false,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(book_id, campaign_id)
);

-- ──────────────────────────────────────
-- 14. DAILY_METRICS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_metrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         VARCHAR(50) NOT NULL,
  entity_key          TEXT NOT NULL,
  profile_id          UUID NOT NULL REFERENCES marketplace_profiles(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  marketplace         VARCHAR(10) NOT NULL,
  currency            VARCHAR(3) NOT NULL,
  impressions         INTEGER DEFAULT 0,
  clicks              INTEGER DEFAULT 0,
  spend               DECIMAL(12,4) DEFAULT 0,
  sales               DECIMAL(12,4) DEFAULT 0,
  orders              INTEGER DEFAULT 0,
  units               INTEGER DEFAULT 0,
  attribution_window  VARCHAR(10) DEFAULT '7d',
  synced_at           TIMESTAMPTZ DEFAULT now(),
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_type, entity_key, date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_entity ON daily_metrics(entity_type, entity_key);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON daily_metrics(date);
CREATE INDEX IF NOT EXISTS idx_metrics_profile_date ON daily_metrics(profile_id, date);

-- ──────────────────────────────────────
-- 15. REPORT_JOBS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          UUID NOT NULL REFERENCES marketplace_profiles(id) ON DELETE CASCADE,
  report_type         VARCHAR(50) NOT NULL,
  amazon_report_id    VARCHAR(200),
  date_from           DATE NOT NULL,
  date_to             DATE NOT NULL,
  status              VARCHAR(50) NOT NULL DEFAULT 'pending',
  requested_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  downloaded_at       TIMESTAMPTZ,
  ingested_at         TIMESTAMPTZ,
  download_url        TEXT,
  records_processed   INTEGER DEFAULT 0,
  error_message       TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(profile_id, report_type, date_from, date_to)
);

CREATE INDEX IF NOT EXISTS idx_report_jobs_status ON report_jobs(status);

-- ──────────────────────────────────────
-- 16. RULES
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                  VARCHAR(255) NOT NULL,
  description           TEXT,
  rule_type             VARCHAR(50) NOT NULL,
  applies_to            VARCHAR(50) NOT NULL,
  conditions            JSONB NOT NULL,
  actions               JSONB NOT NULL,
  mode                  VARCHAR(50) DEFAULT 'recommend',
  priority              INTEGER DEFAULT 100,
  max_daily_executions  INTEGER DEFAULT 10,
  cooldown_hours        INTEGER DEFAULT 48,
  is_active             BOOLEAN DEFAULT true,
  version               INTEGER DEFAULT 1,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rules_workspace ON rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_rules_active ON rules(is_active, priority);

-- ──────────────────────────────────────
-- 17. RECOMMENDATIONS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id           UUID REFERENCES rules(id) ON DELETE SET NULL,
  entity_type       VARCHAR(50) NOT NULL,
  entity_key        TEXT NOT NULL,
  action_type       VARCHAR(50) NOT NULL,
  suggested_action  JSONB NOT NULL,
  context_data      JSONB,
  confidence_score  DECIMAL(5,4),
  rule_snapshot     JSONB,
  status            VARCHAR(50) DEFAULT 'pending',
  created_at        TIMESTAMPTZ DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       VARCHAR(50),
  action_id         UUID
);

CREATE INDEX IF NOT EXISTS idx_reco_status ON recommendations(status, workspace_id);
CREATE INDEX IF NOT EXISTS idx_reco_entity ON recommendations(entity_type, entity_key);
CREATE INDEX IF NOT EXISTS idx_reco_pending ON recommendations(status, created_at);

-- ──────────────────────────────────────
-- 18. ACTION_LOG
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS action_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recommendation_id   UUID REFERENCES recommendations(id),
  rule_id             UUID REFERENCES rules(id),
  entity_type         VARCHAR(50) NOT NULL,
  entity_key          TEXT NOT NULL,
  amazon_entity_id    BIGINT,
  action_type         VARCHAR(50) NOT NULL,
  before_value        JSONB,
  after_value         JSONB,
  rationale           TEXT NOT NULL,
  executed_by         VARCHAR(50) NOT NULL,
  executed_at         TIMESTAMPTZ DEFAULT now(),
  status              VARCHAR(50) NOT NULL,
  api_request         JSONB,
  api_response        JSONB,
  error_message       TEXT,
  is_reversible       BOOLEAN DEFAULT false,
  rolled_back_at      TIMESTAMPTZ,
  rollback_action_id  UUID,
  dry_run             BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_workspace ON action_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_action_entity ON action_log(entity_type, entity_key);
CREATE INDEX IF NOT EXISTS idx_action_date ON action_log(executed_at);
CREATE INDEX IF NOT EXISTS idx_action_status ON action_log(status);

-- ──────────────────────────────────────
-- 19. SYNC_LOGS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ad_account_id     UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  profile_id        UUID REFERENCES marketplace_profiles(id) ON DELETE CASCADE,
  job_name          VARCHAR(100) NOT NULL,
  job_type          VARCHAR(50) NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL,
  finished_at       TIMESTAMPTZ,
  duration_seconds  INTEGER,
  status            VARCHAR(50) NOT NULL,
  records_fetched   INTEGER DEFAULT 0,
  records_created   INTEGER DEFAULT 0,
  records_updated   INTEGER DEFAULT 0,
  records_failed    INTEGER DEFAULT 0,
  details           JSONB,
  errors            JSONB,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_account ON sync_logs(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_sync_date ON sync_logs(started_at);

-- ──────────────────────────────────────
-- 20. INCIDENTS
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  incident_type         VARCHAR(100) NOT NULL,
  severity              VARCHAR(50) NOT NULL,
  title                 VARCHAR(500) NOT NULL,
  description           TEXT,
  context               JSONB,
  entity_type           VARCHAR(50),
  entity_key            TEXT,
  status                VARCHAR(50) DEFAULT 'open',
  occurred_at           TIMESTAMPTZ DEFAULT now(),
  acknowledged_at       TIMESTAMPTZ,
  resolved_at           TIMESTAMPTZ,
  notification_sent     BOOLEAN DEFAULT false,
  notification_channel  VARCHAR(50),
  notification_sent_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, severity);
CREATE INDEX IF NOT EXISTS idx_incidents_workspace ON incidents(workspace_id);

-- ──────────────────────────────────────
-- 21. SYSTEM_CONFIG
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_config (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ──────────────────────────────────────
-- Données initiales system_config
-- ──────────────────────────────────────
INSERT INTO system_config (key, value) VALUES
  ('kill_switch', '{"enabled": false, "reason": null, "enabled_at": null, "enabled_by": null}'::jsonb),
  ('global_settings', '{"max_actions_per_day": 50, "default_cooldown_hours": 48, "dry_run": true}'::jsonb),
  ('feature_flags', '{"sync_enabled": true, "recommendations_enabled": true, "auto_execute_enabled": false, "alerts_enabled": true, "search_terms_sync": true}'::jsonb),
  ('rate_limits', '{"default_rps": 10, "reports_rps": 1, "bulk_rps": 5}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- FIN MIGRATION 001
-- ============================================
