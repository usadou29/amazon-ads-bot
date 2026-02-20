-- Migration: Ajout de nouvelles règles budget, visibilité et tendances
-- Date: 2026-02-20
-- Description: Ajoute 4 nouvelles règles de recommandation pour compléter les 5 existantes

-- ═══════════════════════════════════════════════════════════
-- Étape 1 : Mettre à jour la contrainte CHECK sur rule_type
-- pour autoriser les nouveaux types de règles
-- ═══════════════════════════════════════════════════════════
ALTER TABLE rules DROP CONSTRAINT IF EXISTS rules_rule_type_check;
ALTER TABLE rules ADD CONSTRAINT rules_rule_type_check CHECK (
  rule_type IN (
    'bid_adjustment',
    'pause_keyword',
    'enable_keyword',
    'harvest_search_term',
    'add_negative',
    'budget_alert',
    'acos_alert',
    'low_impressions',
    'performance_trend',
    'acos_above_royalty'
  )
);

-- ═══════════════════════════════════════════════════════════
-- Étape 2 : Insérer les nouvelles règles
-- ═══════════════════════════════════════════════════════════

-- Règle 6: Budget épuisé quotidiennement
-- Campagne qui atteint son budget max régulièrement
-- ═══════════════════════════════════════════════════════════
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'budget_capped',
  'Alerte quand une campagne atteint son budget quotidien (opportunités manquées)',
  'budget_alert',
  'campaign',
  '{"operator": "AND", "conditions": [{"metric": "budget_utilization", "operator": ">=", "value": 95, "period_days": 7}, {"metric": "cvr", "operator": ">=", "value": 2, "period_days": 7}]}',
  '{"action_type": "alert", "severity": "info", "level": "campaign"}',
  'recommend',
  85,
  2,
  72
);

-- ═══════════════════════════════════════════════════════════
-- Règle 7: Faible visibilité (peu d'impressions)
-- Mot-clé ou campagne qui ne s'affiche presque pas
-- ═══════════════════════════════════════════════════════════
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'low_impressions',
  'Alerte quand un mot-clé a très peu d''impressions — enchère trop basse',
  'low_impressions',
  'keyword',
  '{"operator": "AND", "conditions": [{"metric": "impressions", "operator": "<", "value": 100, "period_days": 14}, {"metric": "spend", "operator": ">", "value": 0, "period_days": 14}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": 20}',
  'recommend',
  95,
  5,
  72
);

-- ═══════════════════════════════════════════════════════════
-- Règle 8: Performance en baisse
-- ACoS en hausse significative sur 7 jours vs les 7 précédents
-- ═══════════════════════════════════════════════════════════
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'performance_declining',
  'Alerte quand l''ACoS augmente significativement — performances en baisse',
  'performance_trend',
  'campaign',
  '{"operator": "AND", "conditions": [{"metric": "acos_change", "operator": ">", "value": 20, "period_days": 7}, {"metric": "spend", "operator": ">=", "value": 10, "period_days": 7}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": -15}',
  'recommend',
  80,
  3,
  48
);

-- ═══════════════════════════════════════════════════════════
-- Règle 9: ACoS supérieur au taux de redevance
-- Chaque vente pub fait perdre de l'argent
-- ═══════════════════════════════════════════════════════════
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'acos_above_royalty',
  'Alerte critique quand l''ACoS dépasse le taux de redevance — perte sur chaque vente',
  'acos_above_royalty',
  'campaign',
  '{"operator": "AND", "conditions": [{"metric": "acos_vs_royalty", "operator": ">", "value": 0, "period_days": 14}, {"metric": "orders", "operator": ">=", "value": 3, "period_days": 14}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": -20}',
  'recommend',
  75,
  3,
  48
);
