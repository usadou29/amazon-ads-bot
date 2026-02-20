# ENDROMEDE — Plan d'implémentation Frontend

## Résumé

Construire l'interface "Auteur-first" d'ENDROMEDE : un SaaS qui traduit Amazon Ads en langage humain pour les auteurs KDP. Mobile-first, français naturel, thémable, avec les safety guards backend visibles.

---

## Phase 1 : Fondations (Next.js + Design System + API Layer)

### 1.1 — Setup projet Next.js

**Tech stack :**
- **Next.js 14 App Router** — SSR natif, routing par dossier, API routes pour proxy
- **Tailwind CSS** — utility-first, mobile-first natif, design tokens via config
- **Zustand** — state léger (workspace context, safety mode)
- **SWR** — data fetching + cache + revalidation
- **Recharts** — charts légers pour les graphiques 30 jours
- **next-intl** — i18n prêt, français par défaut

**Pourquoi Next.js plutôt que Vite+React Router :** le backend est séparé (NestJS port 3001), mais Next.js permet un proxy API clean via `next.config.js`, du SSR pour le SEO/perf mobile, et une structure i18n native. Pas besoin de deux serveurs à gérer en prod.

**Structure du projet :**
```
endromede-ui/
├── next.config.js              # Proxy API vers localhost:3001
├── tailwind.config.ts          # Design tokens centralisés
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout (providers, navbar, SafetyBanner)
│   │   ├── page.tsx            # Redirect → /authors
│   │   ├── authors/
│   │   │   ├── page.tsx        # Liste auteurs (cartes)
│   │   │   └── [authorId]/
│   │   │       └── page.tsx    # Livres d'un auteur (cartes)
│   │   ├── books/
│   │   │   └── [bookId]/
│   │   │       └── page.tsx    # Détail livre (diagnostic + reco + chart + timeline)
│   │   ├── onboarding/
│   │   │   └── page.tsx        # Wizard mapping campagnes ↔ livres
│   │   └── settings/
│   │       └── page.tsx        # Paramètres workspace
│   │
│   ├── components/
│   │   ├── ui/                 # Design system réutilisable
│   │   ├── features/           # Composants métier (AuthorCard, BookCard, RecoCard...)
│   │   └── layout/             # Navbar, AppShell, SafetyBanner
│   │
│   ├── lib/
│   │   ├── api/                # Client API + endpoints typés
│   │   ├── hooks/              # useAuthors, useBooks, useRecommendations, useSafety
│   │   ├── transforms/         # Technique → humain (ACOS → "Ratio dépense-ventes")
│   │   ├── i18n/               # Dictionnaires fr.json / en.json
│   │   └── theme/              # Design tokens exportés
│   │
│   └── types/                  # Types API + domain + UI
```

### 1.2 — Design Tokens (thémable)

Fichier unique `src/lib/theme/tokens.ts` + intégration dans `tailwind.config.ts`.

**Palette neutre par défaut :**
- `primary`: bleu professionnel (#2563eb) — confiance, sérieux
- `success`: vert (#10b981) — ✅ sous contrôle
- `warning`: ambre (#f59e0b) — ⚠️ à optimiser
- `danger`: rouge (#ef4444) — 🛑 perdant
- `surface` / `background` / `text` : gris neutres

**Slot logo :** Header avec `{theme.logo}` ou placeholder "ENDROMEDE" en texte. Changeable sans toucher au code composant.

### 1.3 — API Layer

**Client API** (`src/lib/api/client.ts`) : Axios avec baseURL configurable, interceptors auth + error handling.

**Endpoints existants utilisés directement :**
- `GET /api/books?workspaceId=X` → liste livres (grouper par `author` côté front)
- `GET /api/books/:id` → détail livre + campagnes liées
- `GET /api/metrics/summary?workspaceId=X` → KPIs globaux
- `GET /api/recommendations?workspaceId=X` → recommandations
- `GET /api/recommendations/pending?workspaceId=X` → reco en attente
- `POST /api/recommendations/:id/approve` → approuver
- `POST /api/recommendations/:id/reject` → rejeter
- `POST /api/actions/dry-run` → simulation
- `POST /api/actions/execute` → exécution (protégée par guards)
- `GET /api/actions/kill-switch` → état kill-switch
- `GET /api/actions/log?workspaceId=X` → historique actions

**Nouveaux endpoints backend à créer :**

| Endpoint | But | Logique |
|----------|-----|---------|
| `GET /api/authors?workspaceId=X` | Liste auteurs + KPIs agrégés | GROUP BY `books.author`, SUM metrics des campagnes liées |
| `GET /api/authors/:authorId/books?workspaceId=X` | Livres d'un auteur + KPIs | Filter books par author, joindre metrics par book |
| `GET /api/books/:id/dashboard` | Dashboard complet d'un livre | KPIs + tendances + recos pending + timeline actions, en 1 appel |
| `GET /api/books/:id/metrics/daily?days=30` | Données chart journalier | SELECT depuis daily_metrics agrégé par jour |

**Note :** `authorId` = slug encodé du nom d'auteur (pen name). Pas de table `authors` séparée — on utilise le champ `books.author` existant, groupé côté backend.

### 1.4 — i18n

**Stratégie :** dictionnaires JSON par langue, hook `useT()` simple. Français par défaut, structure prête pour ajouter EN/ES plus tard.

```
src/lib/i18n/
├── fr.json    # Default — complet
├── en.json    # Squelette vide, rempli plus tard
└── index.ts   # Hook useT('metrics.spend') → "Dépense"
```

Toutes les chaînes UI passent par `useT()`. Aucun texte français hardcodé dans les composants.

---

## Phase 2 : Pages et Composants

### 2.1 — `/authors` — Liste des auteurs

**Ce que l'utilisateur voit :**
- Cartes par pen name (nom d'auteur)
- Chaque carte : nombre de livres, Dépense 30j, Ventes 30j, Statut global
- CTA "Voir les livres →"

**Composants :**
- `AuthorCard` : nom, bookCount, spend, sales, StatusBadge, lien
- `StatusBadge` : ✅ Sous contrôle / ⚠️ À optimiser / 🛑 Perdant

**Logique statut auteur :** agrégat des statuts de ses livres. Si au moins 1 livre 🛑 → auteur ⚠️. Si tous ✅ → auteur ✅.

### 2.2 — `/authors/:authorId` — Livres d'un auteur

**Ce que l'utilisateur voit :**
- Header : nom de l'auteur + KPIs agrégés
- Grille de cartes par livre (titre, ASIN, couverture si disponible)
- KPIs par livre : Dépense, Ventes, Statut
- Badge nombre de recommandations en attente
- CTA "Ouvrir →"

**Composants :**
- `BookCard` : titre, ASIN, marketplace, KPIs, StatusBadge, pendingRecoCount
- `KPISummaryBar` : barre résumé horizontale (Dépense totale / Ventes totales / ACOS moyen)

### 2.3 — `/books/:bookId` — Détail d'un livre (page principale)

**Ce que l'utilisateur voit :**

**a) Résumé verbal (1 phrase) :**
> "Ce livre dépense 45€/jour pour 92€ de ventes — c'est rentable mais il y a de la marge pour optimiser."

Généré dynamiquement depuis les KPIs + tendance.

**b) "Ce que je te conseille aujourd'hui" — Recommandations en cartes :**
```
┌─────────────────────────────────┐
│ 💡 Arrêter ce mot-clé           │
│                                  │
│ Pourquoi : 50 clics, 0 vente    │
│ Impact : -15€/jour d'économie   │
│ Risque : Faible (réversible)    │
│                                  │
│ [Simuler]  [Appliquer]          │
└─────────────────────────────────┘
```

Le bouton "Appliquer" est grisé + tooltip si guards actifs (dry_run, kill-switch, auto_execute off).

**c) Graphique 30 jours :**
- 2 courbes : Dépense (rouge) + Ventes (vert)
- Ligne ACOS en pointillé
- Mobile : scrollable horizontalement

**d) Timeline actions/recommandations :**
- Liste chronologique des actions passées
- Chaque entrée : date, action, résultat, dry-run ou réel
- Badge "Simulé" ou "Appliqué"

**Composants :**
- `VerbalSummary` : phrase dynamique
- `RecommendationCard` : pourquoi/impact/risque/actions
- `MetricsChart` : Recharts responsive
- `ActionTimeline` : liste chronologique

### 2.4 — `/onboarding` — Wizard mapping

**3 étapes :**
1. "Quel livre veux-tu suivre ?" → sélection livre (existant ou créer)
2. "Quelles campagnes lui sont associées ?" → liste des campagnes Amazon dispo, checkboxes
3. "Confirme" → résumé + bouton valider

**Composants :**
- `WizardStepper` : indicateur d'étape (1/2/3)
- `CampaignSelector` : liste avec recherche + checkbox
- `ConfirmationCard` : résumé avant validation

### 2.5 — Safety Guards (visible partout)

**`SafetyBanner`** (dans le layout root) :
- Si `dry_run: true` → bandeau bleu : "🔒 Mode test — Les changements seront simulés"
- Si kill-switch ON → bandeau rouge : "⛔ Arrêt d'urgence — Aucun changement exécuté"
- Si tout OK → pas de bandeau

**Dans RecommendationCard :**
- Bouton "Appliquer" → disabled + tooltip "Mode test activé" si guards actifs
- Bouton "Simuler" → toujours actif (dry-run est safe)

---

## Phase 3 : Backend — Nouveaux endpoints

### 3.1 — `GET /api/authors?workspaceId=X`

```typescript
// Retourne :
[{
  id: "stephen-king",           // slug du pen name
  name: "Stephen King",
  bookCount: 3,
  metrics: { spend: 450, sales: 920, acos: 48.9, roas: 2.04 },
  status: "warning",            // agrégé des livres
  pendingRecommendations: 4
}]
```

**Logique :** SELECT books GROUP BY author, JOIN daily_metrics agrégées via campaign_book_mapping.

### 3.2 — `GET /api/books/:id/dashboard`

```typescript
// Retourne tout en 1 appel :
{
  book: { id, title, asin, author, marketplace, acosTarget },
  metrics: { spend, sales, acos, roas, impressions, clicks, orders },
  trends: { previous: {...}, changes: { spend: +12%, sales: -3% } },
  verbalSummary: "Ce livre dépense 45€/jour...",  // généré backend
  recommendations: [{ id, title, why, impact, risk, actionType, status }],
  recentActions: [{ date, action, result, dryRun }],
  dailyMetrics: [{ date, spend, sales, acos }]     // 30 jours pour chart
}
```

### 3.3 — `GET /api/books/:id/metrics/daily?days=30`

```typescript
// Données pour le graphique
[
  { date: "2026-01-20", spend: 12.5, sales: 28.3, acos: 44.2, impressions: 5200, clicks: 58 },
  { date: "2026-01-21", ... },
  ...
]
```

---

## Phase 4 : Séquence d'implémentation

### Étape 1 — Setup projet + Design System
- Init Next.js 14 + Tailwind + structure dossiers
- Design tokens (`tokens.ts` + `tailwind.config.ts`)
- Composants UI de base : Button, Card, Badge, StatusBadge, Alert, Skeleton
- Layout : AppShell + Navbar + SafetyBanner
- API client + hook useSafety

### Étape 2 — Page `/authors`
- Nouveau endpoint backend `GET /api/authors`
- Composant AuthorCard
- Page avec grille responsive (1 col mobile, 2-3 col desktop)
- Hook useAuthors + SWR

### Étape 3 — Page `/authors/:authorId`
- Nouveau endpoint backend `GET /api/authors/:authorId/books`
- Composant BookCard avec StatusBadge
- KPISummaryBar
- Hook useAuthorBooks

### Étape 4 — Page `/books/:bookId`
- Nouveau endpoint backend `GET /api/books/:id/dashboard`
- VerbalSummary (phrase dynamique)
- RecommendationCard avec boutons Simuler/Appliquer
- MetricsChart (Recharts)
- ActionTimeline
- Intégration safety guards sur les boutons d'action

### Étape 5 — Onboarding wizard
- WizardStepper
- CampaignSelector (utilise `GET /api/books/available-campaigns` existant)
- Validation mapping

### Étape 6 — i18n + Polish
- Extraction toutes chaînes → fr.json
- Hook useT()
- Squelette en.json
- Tests responsive mobile
- Loading states + error boundaries

---

## Fichiers critiques

| Fichier | Rôle |
|---------|------|
| `tailwind.config.ts` | Design tokens centralisés — toute la palette ici |
| `src/lib/theme/tokens.ts` | Tokens exportés pour JS (composants dynamiques) |
| `src/lib/transforms/metrics.ts` | ACOS → "Ratio dépense-ventes", toute la traduction technique → humain |
| `src/lib/transforms/status.ts` | Calcul ✅ ⚠️ 🛑 basé sur ACOS target + ROAS + tendance |
| `src/lib/transforms/verbal.ts` | Génération des phrases résumé ("Ce livre dépense...") |
| `src/lib/api/client.ts` | Client Axios avec proxy + auth |
| `src/lib/i18n/fr.json` | Dictionnaire français complet |
| `src/components/ui/SafetyBanner.tsx` | Bandeau dry-run / kill-switch visible partout |

---

## Ce qui ne change PAS

- Backend NestJS existant reste en place (port 3001)
- Safety guards hard (kill-switch, auto_execute_enabled, dry_run, auto_mode_enabled) restent côté backend
- Le front ne bypass jamais les guards — il lit l'état et adapte l'UI
- La table `books` existante est utilisée telle quelle (champ `author` pour grouper)
- `campaign_book_mapping` existant pour le lien campagnes ↔ livres
