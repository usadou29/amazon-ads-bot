# Plan d'implémentation : Micro/Macro + Lifecycle Auto-Switch

## Contexte & Découvertes

**Codebase existant :**
- Lifecycle = simple calcul `daysSincePublish` (30/180 jours) dans `books.service.ts`
- InsightsService agrège déjà les diagnostics micro en macro strategy (SCALE_WINNERS, CUT_LOSERS, etc.)
- CampaignInsightCard affiche la macro strategy mais **sans actions exécutables**
- AmazonClientService **n'a PAS de mutations campagne** (budget, bidding strategy, placements) → à ajouter
- Placements stockés dans `rawData` (jsonb) des campagnes, pas en colonnes dédiées

**Contrainte importante :** L'API Amazon SP Campaigns v3 supporte `updateCampaign` pour budget + bidding, et les placement adjustments. On doit ajouter ces méthodes.

---

## Phase 1 : Lifecycle Auto-Switch (Backend)

### 1.1 Migration SQL — `add_lifecycle_tracking_fields.sql`

Ajouter au schema `books` :
```sql
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS lifecycle_phase VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_source VARCHAR(10) DEFAULT 'auto'
    CHECK (lifecycle_source IN ('auto', 'manual')),
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_previous_phase VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_pending_phase VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_pending_since TIMESTAMPTZ DEFAULT NULL;
```

- `lifecycle_phase` : phase effective calculée (remplace le calcul à la volée)
- `lifecycle_source` : auto ou manual
- `lifecycle_changed_at` : date du dernier changement
- `lifecycle_previous_phase` : pour historique
- `lifecycle_pending_phase` + `lifecycle_pending_since` : pour hysteresis (2 checks consécutifs)

### 1.2 Schema Drizzle — `books.ts`

Ajouter les 6 colonnes au schema Drizzle. L'ancien champ `lifecyclePhaseOverride` reste pour backward compat (aliased vers lifecycle_phase quand source=manual).

### 1.3 Service — `LifecycleService` (nouveau fichier)

**Fichier :** `backend/src/modules/lifecycle/lifecycle.service.ts`

```
Méthodes :
- computePhase(bookId): LifecycleComputeResult
- overridePhase(bookId, phase, reason): void
- getPhaseInfo(bookId): LifecycleInfoDTO
- computeAllBooks(): void  (appelé par cron)
```

**Règles de détection :**

```
LAUNCH si :
  - daysSincePublish < 30
  - OU orders_total_30d < 10
  - OU data ads insuffisante (total clicks toutes campagnes < 30)

SCALE si :
  - daysSincePublish >= 30 ET <= 180
  - ET orders_total_30d >= 10
  - ET au moins 2 semaines consécutives avec orders > 0

EVERGREEN si :
  - daysSincePublish > 180
  - ET performance stable (variance ACoS < 15% sur 3 fenêtres 30j)
  - OU daysSincePublish > 180 + volume stable

RELAUNCH :
  - Manuel uniquement (override) en v1
```

**Hysteresis :**
```
1. Calculer candidatePhase selon les règles
2. Si candidatePhase !== currentPhase :
   a. Si lifecycle_pending_phase === candidatePhase
      ET lifecycle_pending_since < now - 48h :
      → Appliquer le changement
   b. Sinon :
      → Stocker en pending (lifecycle_pending_phase, lifecycle_pending_since = now)
3. Si candidatePhase === currentPhase :
   → Effacer le pending
4. Minimum cooldown : 7 jours dans la phase actuelle avant tout changement
5. Si source = 'manual' → pas de recalcul auto
```

### 1.4 Controller — Endpoints lifecycle

```
GET  /books/:bookId/lifecycle         → { phase, source, explanation, evidence }
POST /books/:bookId/lifecycle/compute → Force recalcul immédiat
POST /books/:bookId/lifecycle/override → { phase, reason } → Override manuel
```

### 1.5 Cron — Intégration scheduler

Dans `scheduler.service.ts`, job quotidien après sync :
```
@Cron('0 5 * * *')  // 5h UTC, après le sync de 3h
async computeAllLifecycles()
```

### 1.6 Tests unitaires lifecycle (8 tests)

1. Launch → Scale quand conditions remplies + hysteresis (2 checks)
2. Scale → Evergreen après 180j + stabilité
3. Hysteresis bloque si < 48h de pending
4. Cooldown phase empêche changement si < 7j dans phase actuelle
5. Override manuel → source = 'manual', bloque auto-switch
6. Override manuel reset → retour en auto
7. Launch maintenu si orders < 10 même si > 30 jours
8. Données insuffisantes → reste Launch

---

## Phase 2 : Macro Suggestions (Backend)

### 2.1 Amazon Client — Mutations campagne

**Fichier :** `amazon-client.service.ts` — ajouter 3 méthodes :

```typescript
async updateCampaignBudget(profileId, campaignId, newBudget): Promise<void>
async updateCampaignBiddingStrategy(profileId, campaignId, strategy): Promise<void>
async updateCampaignPlacements(profileId, campaignId, placements): Promise<void>
```

Utilise l'API Amazon SP Campaigns v3 :
- PUT `/sp/campaigns` pour budget + bidding strategy
- PUT `/sp/campaigns` pour dynamic bidding + placement adjustments

### 2.2 DTO — `MacroSuggestionDTO`

**Fichier :** `backend/src/modules/macro/macro.types.ts`

```typescript
type MacroSuggestionActionType =
  | 'set_bidding_strategy'
  | 'update_placements'
  | 'increase_budget'
  | 'decrease_budget'
  | 'none';

interface MacroSuggestionDTO {
  id: string;
  campaignId: string;
  title: string;              // auteur-friendly
  why: string;                // 1-2 phrases
  bullets: string[];          // 2-3 max
  impactTag: 'stabiliser' | 'accélérer' | 'réduire dépenses' | 'protéger rentabilité';
  riskLevel: 'low' | 'medium' | 'high';
  actionType: MacroSuggestionActionType;
  executable: boolean;
  current: {
    biddingStrategy?: 'fixed' | 'down_only' | 'up_and_down';
    placements?: { topOfSearch: number; restOfSearch: number; productPages: number };
    budget?: number;
  };
  recommended?: { /* même structure */ };
  guardrails?: {
    requiresConsent: boolean;
    consentLevel: 'none' | 'basic' | 'reinforced';
    cooldownDays?: number;
  };
  evidence: {
    strategicPeriodDays: number;
    trendPeriodDays?: number;
    acosStrategic?: number;
    acosTrend?: number;
    cvrStrategic?: number;
    cvrTrend?: number;
    spendShareImpacted?: number;
    diagnosticsDistribution?: Record<string, number>;
  };
}
```

### 2.3 Service — `MacroSuggestionService`

**Fichier :** `backend/src/modules/macro/macro-suggestion.service.ts`

**Méthode principale :**
```
async getMacroSuggestions(campaignId, bookId, lifecyclePhase): MacroSuggestionDTO[]
```

**Étapes :**
1. Charger métriques campagne (strategic period + trend 7j)
2. Charger placements depuis rawData
3. Charger budget + bidding strategy
4. Charger distribution diagnostics micro (entity insights)
5. Appliquer les 4 patterns de gating
6. Retourner 0-2 suggestions max

**Pattern 1 — Dégradation globale :**
```
Conditions :
  - trendAcos > strategicAcos * 1.10 (ACoS 7j ↑ de +10%)
  - ET trendCvr < strategicCvr * 0.90 (CVR 7j ↓ de -10%)
  - ET spendShareImpacted >= 0.60 (60%+ du spend impacté)

Actions possibles :
  - biddingStrategy 'up_and_down' → suggérer 'down_only'
  - topOfSearch > 50% → réduire placements

impactTag: 'stabiliser'
riskLevel: 'medium'
```

**Pattern 2 — Budget capped + rentable :**
```
Conditions :
  - dailySpend >= dailyBudget * 0.95
  - ET acos <= breakEvenAcos * 0.80
  - ET orders > 0

Action : increase_budget +20%
impactTag: 'accélérer'
riskLevel: 'low'
```

**Pattern 3 — Placements incohérents :**
```
Conditions :
  - topOfSearch multiplicateur > 0
  - ET topOfSearch ACoS > campaign ACoS * 1.30

Action : update_placements, réduire topOfSearch
impactTag: 'réduire dépenses'
riskLevel: 'low'
```

**Pattern 4 — Bidding strategy incohérente avec phase :**
```
Conditions :
  - Phase launch + bidding = 'up_and_down' + clicks < 50
  - OU Phase evergreen + bidding = 'up_and_down' + acos > breakEven

Action : set_bidding_strategy
  Launch → 'fixed' ou 'down_only'
  Evergreen → 'down_only'
impactTag: 'protéger rentabilité'
riskLevel: 'medium'
```

**Règle fondamentale : silence = stabilité**
Si aucun pattern → tableau vide. Pas de suggestion "tout va bien".

### 2.4 Controller — Endpoint macro

```
POST /campaigns/:campaignId/macro-suggestions
Body: { bookId, lifecyclePhase }
Returns: MacroSuggestionDTO[]

POST /campaigns/:campaignId/macro-execute
Body: { workspaceId, suggestionId, actionType, recommended }
Returns: ExecutionResult
```

### 2.5 Executor macro — `MacroExecutorService`

**Fichier :** `backend/src/modules/macro/macro-executor.service.ts`

- Vérifie kill switch + feature flags
- Applique via AmazonClientService
- Log dans action_log (avec entityType='campaign')
- Retourne résultat

### 2.6 Tests unitaires macro (8 tests)

1. Dégradation globale (60%+ spend impacté) → suggestions générées
2. Dégradation locale (1-2 lignes) → PAS de macro
3. Budget capped + rentable → increase_budget
4. Budget capped + NON rentable → PAS de suggestion
5. Placements incohérents → update_placements
6. Bidding incohérente avec phase → switch strategy
7. Aucun pattern → tableau vide
8. Maximum 2 suggestions retournées

---

## Phase 3 : Frontend — Bloc Macro + Lifecycle

### 3.1 API Client — Nouveaux endpoints

```typescript
// client.ts
export const fetchMacroSuggestions = (campaignId, bookId, lifecyclePhase) =>
  api.post(`/campaigns/${campaignId}/macro-suggestions`, { bookId, lifecyclePhase });

export const executeMacroAction = (dto) =>
  api.post('/campaigns/macro-execute', dto);

export const fetchLifecycleInfo = (bookId) =>
  api.get(`/books/${bookId}/lifecycle`);

export const overrideLifecycle = (bookId, phase, reason) =>
  api.post(`/books/${bookId}/lifecycle/override`, { phase, reason });
```

### 3.2 Composant — `MacroSuggestionsBlock`

**Fichier :** `frontend/src/components/features/MacroSuggestionsBlock.tsx`

- Ne s'affiche QUE si `suggestions.length > 0`
- Pour chaque suggestion :
  - Titre + impactTag badge
  - Paragraphe "why"
  - Bullets d'explication
  - Bouton "Voir / Ajuster" → ouvre MacroActionModal
- Couleurs par impact :
  - stabiliser → amber
  - accélérer → emerald
  - réduire dépenses → blue
  - protéger rentabilité → rose

### 3.3 Composant — `MacroActionModal`

**Fichier :** `frontend/src/components/features/MacroActionModal.tsx`

- Section "Pourquoi maintenant" avec evidence
- Valeur actuelle vs recommandée
- Pour budget : input numérique
- Pour bidding strategy : radio buttons
- Pour placements : 3 sliders (topOfSearch, productPages, restOfSearch)
- Risk level badge + guardrails info
- Bouton "Appliquer" (si executable) OU "Checklist" (si non executable)

### 3.4 Intégration — `OverviewCampaignView.tsx`

Dans `OverviewCampaignCard` :
- Fetch macro suggestions par campagne (au mount/expand)
- Placer `<MacroSuggestionsBlock>` ENTRE résumé campagne et tableaux
- Ne montre que si suggestions non vides

### 3.5 Lifecycle display — Page livre

Dans `books/[bookId]/page.tsx` :
- Badge "Phase : Scale (auto)" ou "Relaunch (manuel)"
- Lien "Pourquoi ?" → popover avec explanation bullets + evidence
- Si manual → bouton "Repasser en auto"

### 3.6 Indicateur période stratégique

Petit texte dans résumé campagne : "Analyse basée sur X jours"
Si uiDays !== strategicDays : note subtile d'info

---

## Ordre d'implémentation

```
Étape 1  : Migration SQL lifecycle + schema Drizzle books.ts
Étape 2  : LifecycleService + computePhase + hysteresis + tests (8 tests)
Étape 3  : Endpoints lifecycle + intégration cron scheduler
Étape 4  : Amazon Client mutations campagne (budget, bidding, placements)
Étape 5  : macro.types.ts (DTO) + MacroSuggestionService + gating + tests (8 tests)
Étape 6  : MacroExecutorService + endpoints macro
Étape 7  : Frontend MacroSuggestionsBlock + MacroActionModal
Étape 8  : Intégration OverviewCampaignView (bloc macro entre résumé et tableaux)
Étape 9  : Frontend lifecycle display (badge + popover + override)
Étape 10 : Indicateur période stratégique + traductions fr.json
Étape 11 : tsc --noEmit backend + frontend
Étape 12 : Run tous les tests unitaires
```

## Fichiers créés (9 nouveaux)

| Fichier | Rôle |
|---------|------|
| `backend/src/db/migrations/add_lifecycle_tracking_fields.sql` | Migration DB |
| `backend/src/modules/lifecycle/lifecycle.service.ts` | Calcul lifecycle + hysteresis |
| `backend/src/modules/lifecycle/lifecycle.spec.ts` | 8 tests lifecycle |
| `backend/src/modules/macro/macro.types.ts` | DTOs macro |
| `backend/src/modules/macro/macro-suggestion.service.ts` | Gating + suggestions |
| `backend/src/modules/macro/macro-suggestion.spec.ts` | 8 tests macro |
| `backend/src/modules/macro/macro-executor.service.ts` | Exécution macro |
| `frontend/src/components/features/MacroSuggestionsBlock.tsx` | Bloc macro UI |
| `frontend/src/components/features/MacroActionModal.tsx` | Modale macro UI |

## Fichiers modifiés (10)

| Fichier | Modification |
|---------|-------------|
| `backend/src/db/schema/books.ts` | 6 colonnes lifecycle |
| `backend/src/modules/books/books.service.ts` | Utiliser LifecycleService |
| `backend/src/modules/books/books.controller.ts` | 3 endpoints lifecycle |
| `backend/src/modules/amazon-client/amazon-client.service.ts` | 3 méthodes mutation |
| `backend/src/modules/scheduler/scheduler.service.ts` | Cron lifecycle |
| `backend/src/config/guards.ts` | Seuils macro gating + lifecycle |
| `frontend/src/lib/api/client.ts` | 4 nouveaux endpoints |
| `frontend/src/components/features/OverviewCampaignView.tsx` | Intégration bloc macro |
| `frontend/src/app/books/[bookId]/page.tsx` | Lifecycle display |
| `frontend/src/lib/i18n/dictionaries/fr.json` | Traductions macro + lifecycle |
