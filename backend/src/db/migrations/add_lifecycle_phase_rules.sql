-- Migration: Ajout des règles par phase de cycle de vie
-- Date: 2026-02-20
-- Description: 12 nouvelles règles organisées par phase (launch, scale, evergreen, relaunch)
-- IMPORTANT: Exécuter APRÈS add_lifecycle_phases.sql
-- Remplacer be210084-a293-4159-939e-a54f9e1ff031 par l'ID du workspace cible

-- ═══════════════════════════════════════════════════════════
-- PHASE LANCEMENT (launch) — 4 règles
-- Tolérance haute, focus exploration et collecte de données
-- ═══════════════════════════════════════════════════════════

-- L1: Manque d'impressions en lancement → bid up
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'launch_low_impressions_bid_up',
  'En lancement, le livre n''est pas assez montré. On augmente les enchères pour gagner en visibilité.',
  'bid_adjustment',
  'keyword',
  '{"operator": "AND", "conditions": [{"metric": "impressions", "operator": "<", "value": 200, "period_days": 7}, {"metric": "spend", "operator": ">", "value": 0, "period_days": 7}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": 25}',
  'recommend',
  90,
  5,
  48,
  '["launch"]'
);

-- L2: Beaucoup d'impressions mais CTR trop bas → problème de couverture
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'launch_low_ctr_cover_issue',
  'Les lecteurs voient le livre mais ne cliquent pas. La couverture ou le titre ne les attirent pas assez.',
  'bid_adjustment',
  'keyword',
  '{"operator": "AND", "conditions": [{"metric": "impressions", "operator": ">=", "value": 1000, "period_days": 7}, {"metric": "ctr", "operator": "<", "value": 0.15, "period_days": 7}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": -20}',
  'recommend',
  85,
  5,
  72,
  '["launch"]'
);

-- L3: Bon CTR mais aucune vente → problème de page produit
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'launch_good_ctr_no_sales',
  'Les lecteurs cliquent (couverture OK) mais n''achètent pas. Le résumé ou le prix les bloque.',
  'bid_adjustment',
  'keyword',
  '{"operator": "AND", "conditions": [{"metric": "ctr", "operator": ">=", "value": 0.3, "period_days": 7}, {"metric": "clicks", "operator": ">=", "value": 15, "period_days": 7}, {"metric": "orders", "operator": "=", "value": 0, "period_days": 7}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": -15}',
  'recommend',
  88,
  5,
  72,
  '["launch"]'
);

-- L4: ACoS élevé mais pas assez de data → patience
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'launch_high_acos_patience',
  'L''ACoS est élevé mais on n''a pas encore assez de données en lancement pour trancher.',
  'acos_alert',
  'campaign',
  '{"operator": "AND", "conditions": [{"metric": "acos", "operator": ">", "value": 80, "period_days": 7}, {"metric": "orders", "operator": "<", "value": 5, "period_days": 7}, {"metric": "spend", "operator": ">=", "value": 5, "period_days": 7}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": -10}',
  'recommend',
  80,
  3,
  96,
  '["launch"]'
);

-- ═══════════════════════════════════════════════════════════
-- PHASE SCALING (scale) — 4 règles
-- Nettoyage agressif, redistribution budget vers les winners
-- ═══════════════════════════════════════════════════════════

-- S1: Redistribuer le budget vers les winners
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'scale_shift_budget_to_winners',
  'Ce ciblage vend bien et est rentable. On peut être plus agressif pour capter plus de ventes.',
  'bid_adjustment',
  'keyword',
  '{"operator": "AND", "conditions": [{"metric": "orders", "operator": ">=", "value": 5, "period_days": 14}, {"metric": "acos", "operator": "<=", "value": 30, "period_days": 14}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": 15}',
  'recommend',
  90,
  5,
  72,
  '["scale"]'
);

-- S2: Nettoyage agressif des termes perdants
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'scale_cut_unprofitable_terms',
  'Ce terme dépense du budget sans jamais convertir. Les lecteurs attirés par cette recherche ne sont pas le bon public.',
  'add_negative',
  'search_term',
  '{"operator": "AND", "conditions": [{"metric": "clicks", "operator": ">=", "value": 20, "period_days": 14}, {"metric": "orders", "operator": "=", "value": 0, "period_days": 14}]}',
  '{"action_type": "add_negative", "negative_type": "exact", "level": "campaign"}',
  'recommend',
  85,
  10,
  48,
  '["scale"]'
);

-- S3: Harvest des termes rentables vers campagnes manuelles
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'scale_harvest_profitable_terms',
  'Ce terme a prouvé qu''il vend. Il mérite un mot-clé dédié avec une enchère contrôlée.',
  'harvest_search_term',
  'search_term',
  '{"operator": "AND", "conditions": [{"metric": "orders", "operator": ">=", "value": 3, "period_days": 14}, {"metric": "acos", "operator": "<=", "value": 40, "period_days": 14}]}',
  '{"action_type": "harvest_search_term", "match_type": "exact"}',
  'recommend',
  92,
  5,
  72,
  '["scale"]'
);

-- S4: Optimisation par placement (Top of Search rentable)
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'scale_optimize_placements',
  'Les données par placement montrent une opportunité d''optimisation. Certaines positions sont plus rentables que d''autres.',
  'bid_adjustment',
  'campaign',
  '{"operator": "AND", "conditions": [{"metric": "orders", "operator": ">=", "value": 10, "period_days": 14}, {"metric": "acos", "operator": "<=", "value": 35, "period_days": 14}, {"metric": "impressions", "operator": ">=", "value": 2000, "period_days": 14}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": 20, "placement": "top_of_search"}',
  'recommend',
  88,
  3,
  96,
  '["scale"]'
);

-- ═══════════════════════════════════════════════════════════
-- PHASE EVERGREEN — 3 règles
-- Micro-ajustements, focus rentabilité et entretien
-- ═══════════════════════════════════════════════════════════

-- E1: Serrage progressif de l'ACoS
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'evergreen_gradual_acos_tightening',
  'Les campagnes tournent bien mais pourraient être un peu plus rentables. On resserre doucement.',
  'bid_adjustment',
  'campaign',
  '{"operator": "AND", "conditions": [{"metric": "acos", "operator": ">", "value": 35, "period_days": 14}, {"metric": "acos", "operator": "<=", "value": 50, "period_days": 14}, {"metric": "orders", "operator": ">=", "value": 5, "period_days": 14}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": -7}',
  'recommend',
  80,
  3,
  96,
  '["evergreen"]'
);

-- E2: Hygiène régulière des search terms
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'evergreen_periodic_cleanup',
  'Sur la durée, ce terme ne vend jamais. Il vaut mieux l''exclure pour garder les campagnes propres.',
  'add_negative',
  'search_term',
  '{"operator": "AND", "conditions": [{"metric": "clicks", "operator": ">=", "value": 10, "period_days": 14}, {"metric": "orders", "operator": "=", "value": 0, "period_days": 14}]}',
  '{"action_type": "add_negative", "negative_type": "exact", "level": "campaign"}',
  'recommend',
  75,
  10,
  96,
  '["evergreen"]'
);

-- E3: Sur-dépendance à un petit nombre de mots-clés
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'evergreen_concentration_risk',
  'La majorité des ventes pub repose sur très peu de mots-clés. C''est efficace mais fragile si la concurrence augmente.',
  'budget_alert',
  'campaign',
  '{"operator": "AND", "conditions": [{"metric": "orders", "operator": ">=", "value": 10, "period_days": 14}, {"metric": "spend", "operator": ">=", "value": 20, "period_days": 14}]}',
  '{"action_type": "alert", "severity": "info", "level": "campaign"}',
  'recommend',
  70,
  2,
  168,
  '["evergreen"]'
);

-- ═══════════════════════════════════════════════════════════
-- PHASE RELAUNCH — 1 règle
-- Traiter comme un lancement frais
-- ═══════════════════════════════════════════════════════════

-- R1: Nouvelle couverture, CTR en hausse mais CVR faible
INSERT INTO rules (workspace_id, name, description, rule_type, applies_to, conditions, actions, mode, priority, max_daily_executions, cooldown_hours, phases)
VALUES (
  'be210084-a293-4159-939e-a54f9e1ff031',
  'relaunch_cover_refresh',
  'La nouvelle approche attire plus de clics mais les ventes ne suivent pas encore. La page produit doit s''aligner.',
  'bid_adjustment',
  'campaign',
  '{"operator": "AND", "conditions": [{"metric": "ctr", "operator": ">=", "value": 0.3, "period_days": 7}, {"metric": "cvr", "operator": "<", "value": 3, "period_days": 7}, {"metric": "clicks", "operator": ">=", "value": 20, "period_days": 7}]}',
  '{"action_type": "bid_adjustment", "adjustment_type": "percentage", "adjustment_value": 10}',
  'recommend',
  85,
  3,
  72,
  '["relaunch"]'
);
