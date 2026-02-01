# Amazon Ads Automation Bot — Contexte projet

**Document de référence** : `ArchitectureV1.pdf` (source de vérité absolue)  
**Dernière mise à jour** : 2026-02-01

**Principe DB** : Le schéma réel est celui de Supabase (Postgres). On définit le schéma via SQL dans Supabase ; le backend NestJS s’adapte à ce schéma. Le code doit s’y conformer.

---

## 1. Synthèse du document ArchitectureV1.pdf

### 1.1 Modèle de données
- **entity_key** polymorphe : format `{entity_type}:{amazon_id}` (ex. `campaign:123456789`).
- **Search terms** : format `search_term:{amazon_ad_group_id}:{query_hash}` pour éviter les collisions entre ad_groups.
entity_key pour search_term = search_term:{query_hash}
l’ad_group est porté par la table search_terms.ad_group_id
- **search_terms** : colonnes `query_norm` (lower(trim)) et `query_hash` (md5 sur query_norm) ; dédup par `UNIQUE(ad_group_id, query_hash)`.
- **report_jobs** : statuts `pending | requested | processing | completed | failed` + timestamps associés.
- **KPIs** : calculés à la volée dans les vues (pas stockés en base).
- **marketplace_profiles** : `last_search_terms_sync_at` pour le tracking 60 jours search terms.
- **recommendations** : `rule_snapshot` JSONB pour versioning des règles.
- **action_log** : `entity_key` TEXT (pas UUID polymorphe).

### 1.2 Règles
- Types : `bid_adjustment`, `pause_keyword`, `enable_keyword`, `harvest_search_term`, `add_negative`, `budget_alert`, `acos_alert`.
- Conditions JSON (AND/OR) sur métriques : clicks, orders, acos, spend, etc.
- Garde-fous : cooldown_hours, max_daily_executions, kill switch, dry_run.

### 1.3 Workflows n8n (section 5 du PDF)
- **01-Nightly-Sync** : CRON 0 3 * * * → POST /api/sync/trigger.
- **02-Evaluate-Rules** : CRON 0 5 * * * → GET sync/status puis POST /api/rules/evaluate → Telegram si recommandations.
- **03-Execute-Approved** : CRON 0 6,18 * * * → GET recommendations?status=approved → POST /api/actions/execute.
- **04-Daily-Summary** : CRON 0 8 * * * → GET /api/metrics/summary?date=yesterday → Telegram.

### 1.4 Garde-fous (section 6 du PDF)
- Constantes : MIN_BID, MAX_BID, MAX_BID_INCREASE_PCT, MAX_BID_DECREASE_PCT, MIN_CLICKS_FOR_DECISION, MIN_SPEND_FOR_DECISION, MAX_ACTIONS_PER_DAY, etc.
- Validation avant exécution : `validateBidChange(current, proposed)`.

### 1.5 Structure du code (section 7 du PDF)
```
amazon-ads-bot/
├── src/
│   ├── config/         (database.ts, amazon.ts, guards.ts, env.ts)
│   ├── modules/        (auth, sync, rules, executor, amazon-client, alerts, api)
│   ├── db/             (connection.ts, migrations/, queries/)
│   ├── utils/          (entity-key.ts, logger.ts, helpers.ts)
│   └── index.ts
├── n8n-workflows/
├── scripts/
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 2. État du backend (vs ArchitectureV1.pdf)

### 2.1 Ce qui est déjà correctement implémenté

| Domaine | Détail |
|--------|--------|
| **Config** | `guards.ts` : GUARDS + validateBidChange conformes. `env.ts` : validation zod, variables PDF. `database.ts`, `amazon.ts` : pool, régions, marketplaces, OAuth scopes. |
| **Utils** | `entity-key.ts` : makeEntityKey, makeSearchTermEntityKey, normalizeQuery, hashQuery, extraction type/amazon_id/search_term. |
| **Backend ↔ Supabase** | Le code NestJS (Drizzle) reflète le schéma Postgres défini dans Supabase : tables du PDF alignées (entity_key TEXT, search_terms query_norm/query_hash, report_jobs statuts, recommendations.rule_snapshot, action_log.entity_key, marketplace_profiles.last_search_terms_sync_at, UNIQUE(ad_account_id, profile_id)). |
| **Auth** | GET /auth/amazon, GET /auth/amazon/callback, POST /auth/refresh ; OAuth init + callback + refresh_token stocké (pas access_token en DB). |
| **Sync** | POST /api/sync/trigger, GET /api/sync/status ; sync profiles, portfolios, campaigns, ad_groups, keywords, product_targets (UPSERT) ; sync_logs. |
| **System** | GET /api/health, GET /api/system/config, POST /api/system/kill-switch ; kill switch DB + env. |
| **Rules** | GET/POST/PATCH /api/rules, POST /api/rules/evaluate ; RuleEvaluator + GUARDS min clicks/spend. |
| **Recommendations** | GET /api/recommendations, GET /api/recommendations/:id, POST :id/approve, :id/reject ; approve/reject/skip + bulk. |
| **Executor** | POST /api/actions/execute, POST /api/actions/execute-batch, GET /api/actions/log ; validateBidChange, kill switch, action_log (entity_key, before/after, dry_run). |
| **Metrics** | GET /api/metrics/summary, GET /api/metrics/entity/:type/:key ; KPIs calculés à la volée. |
| **Books** | GET/POST /api/books, PATCH /api/books/:id, mapping campagne-livre. |
| **Alerts** | Module alerts + TelegramService. |

### 2.2 Ce qui est partiellement présent

| Élément | État | À faire |
|--------|------|--------|
| **Reports** | AmazonClient : requestReport, getReportStatus, downloadReport. Pas de module ni endpoints. | Module Reports : POST /api/reports/request, GET /api/reports/:id/status ; report_jobs UPSERT, poll, download, ingestion daily_metrics (entity_key search_term:adGroupId:query_hash). |
| **Sync search terms** | Table search_terms + query_norm/query_hash. Aucune synchro depuis reports. | Après ingestion report search_terms : peupler search_terms, last_search_terms_sync_at. |
| **Vues / fonctions SQL (Migration 002)** | Absentes. | Appliquer 002 sur Supabase : vues v_daily_metrics_with_kpi, v_book_performance, v_keywords_needing_attention, v_search_terms_to_promote, v_search_terms_to_negate, v_daily_summary ; fonctions make_entity_key, extract_amazon_id, is_in_cooldown, count_daily_rule_executions, is_kill_switch_active. |
| **Schéma Supabase** | Schéma défini via SQL dans Supabase (001, 002, 003). Le backend s’y conforme. | Exécuter 001 sur Supabase (schéma PDF) ; exécuter 002 (vues, fonctions) et 003 (seed règles). S’assurer que le code NestJS reste aligné sur ce schéma. |
| **Règles par défaut (003)** | Non chargées. | Seed 003 avec workspace_id réel (script seed-workspace). |
| **Payload sync** | PDF : profile_ids (array). Code : profileId (string). | Optionnel : accepter profile_ids[]. |
| **Payload execute** | PDF : recommendation_ids, dry_run. Code : recommendationIds, dryRun. | Alias ou doc (comportement OK). |
| **Bug** | recommendations.service utilise rules.type. | Remplacer par rules.ruleType. |

### 2.3 Ce qui est totalement manquant

| Élément | Détail |
|--------|--------|
| **Bootstrap NestJS** | Pas de main.ts ni AppModule → serveur ne démarre pas. Créer main.ts + app.module.ts, enregistrer tous les modules. |
| **Module Reports** | Aucun controller/service exposant request + poll. Voir Phase D. |
| **Ingestion reports → daily_metrics** | Aucun code qui remplit report_jobs (ingested) et daily_metrics (entity_key search_term correct). |
| **n8n-workflows** | Dossier / JSON des 4 workflows (section 5 PDF). |
| **Script seed workspace** | Remplacer workspace_id placeholder dans règles après création workspace. |
| **Alertes depuis règles** | Règles acos_alert → incident + Telegram. |
| **Fonctions SQL utilisées** | is_in_cooldown, is_kill_switch_active (optionnel si logique en TS). |

### 2.4 Ce qui est hors scope ou redondant pour la V1

| Élément | Commentaire |
|--------|-------------|
| System : POST /api/system/settings, features, limits, reset | Pas dans la liste PDF ; utiles admin, optionnel. |
| Executor : GET/POST /api/actions/kill-switch | Doublon avec /api/system/kill-switch ; centraliser ou documenter. |
| Rules : GET recommendations/pending, PATCH recommendations/:id/status | Doublon module recommendations ; supprimer ou déléguer. |
| Auth : POST /auth/amazon/init, POST callback JSON, POST revoke | Extras PDF ; garder si besoin SPA/revocation. |

---

## 3. Plan d'implémentation V1

### Phase A — Minimum backend viable (health, DB, bootstrap)
- **Fichiers** : `src/main.ts`, `src/app.module.ts`.
- **Endpoints** : GET /api/health, /health, /ready, /live (déjà dans SystemModule).
- **Actions** : Créer main.ts (NestFactory.create(AppModule), listen(PORT)), app.module.ts (imports tous les modules). Vérifier health + DB. Optionnel : script ou doc pour appliquer schéma 001 sur Supabase.

### Phase B — Auth Amazon
- Déjà en place. Tester flux OAuth (init → callback → refresh). Vérifier stockage refresh_token_encrypted.

### Phase C — Sync structure (campaigns, ad_groups, keywords)
- Déjà en place. Exécuter migration 001 sur Supabase. Tester sync complète après connexion Amazon.

### Phase D — Reports & metrics
- **Fichiers** : `src/modules/reports/reports.module.ts`, `reports.controller.ts`, `reports.service.ts`.
- **Endpoints** : POST /api/reports/request, GET /api/reports/:id/status.
- **Service** : requestReport (créer/update report_job), poll getReportStatus, downloadReport, ingestion → daily_metrics (entity_key dont search_term:adGroupId:query_hash) + search_terms.
- **Dépendances** : AmazonClientService, report_jobs, daily_metrics, search_terms, entity-key (makeEntityKey, makeSearchTermEntityKey, hashQuery, normalizeQuery).

### Phase E — Rules engine
- Corriger bug rules.type → rules.ruleType dans recommendations.service. Exécuter 003 (règles par défaut) avec workspace_id réel. Vérifier rule_snapshot dans recommandations. Règles acos_alert → incident + Telegram.

### Phase F — Executor & action log
- Déjà en place. Tester execute (bid_adjustment, pause_keyword) en dry_run puis réel. Vérifier action_log. Optionnel : utiliser is_in_cooldown, count_daily_rule_executions (SQL 002).

### Phase G — Alerts & n8n
- **Fichiers** : `n8n-workflows/01-Nightly-Sync.json`, `02-Evaluate-Rules.json`, `03-Execute-Approved.json`, `04-Daily-Summary.json`.
- S'assurer que GET /api/metrics/summary accepte `date=yesterday`. Documenter API_URL, DRY_RUN, Telegram pour n8n.

---

## 4. Règle critique

Aucun code n'est écrit tant que l'utilisateur n'a pas validé le plan. Attendre explicitement : **« OK Phase X, code »** avant d'implémenter la phase X.

---

## 5. Contraintes techniques

- **Schéma DB** : Le schéma réel est celui de Supabase (Postgres). Défini via SQL dans Supabase ; le backend NestJS s'y conforme. Conforme au PDF (pas de tables ni règles inventées).
- **NestJS** : structure modules/controllers/services ; s'adapte au schéma Supabase (ex. Drizzle pour les requêtes).
- **Supabase** : PostgreSQL distant (pas Docker DB prod).
- **Entity keys** : `type:amazon_id` et `search_term:adGroupId:hash` partout (metrics, recommendations, action_log).
- **Garde-fous** : DRY_RUN par défaut, kill switch, cooldown, max_daily_executions, validateBidChange avant toute modification d'enchère.

---

## 6. Historique des mises à jour

| Date | Modification |
|------|--------------|
| 2026-02-01 | Création du fichier ; rapport initial (analyse PDF + état backend + plan V1). |
| 2026-02-01 | Clarification : schéma réel = Supabase (Postgres) ; SQL dans Supabase, backend NestJS s'adapte. Suppression de « Drizzle génère migrations ». |

---

*Ce fichier est la référence de contexte du projet. Le mettre à jour après chaque phase implémentée ou décision importante pour garder une vision cohérente.*
