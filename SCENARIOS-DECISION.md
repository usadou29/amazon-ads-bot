# Scénarios de décision — Endromède SaaS

Guide exhaustif de toutes les décisions prises par le moteur d'insights et d'actions.

---

## 1. Arbre de diagnostic d'une entité (mot-clé / produit ciblé)

Chaque entité reçoit un **diagnostic** basé sur ses métriques (impressions, clics, ventes, ACoS) sur la fenêtre de décision choisie dynamiquement.

### Pré-éligibilité (pas assez de données pour agir)

| Diagnostic | Condition | Signification |
|---|---|---|
| `no_impressions` | impressions = 0 | Amazon ne diffuse pas du tout cette entité |
| `zero_clicks_low_volume` | impressions > 0 mais < 300, clics = 0 | Pas assez de volume pour juger — peut-être juste un manque de diffusion |
| `zero_clicks` | impressions ≥ 300, clics = 0 | Beaucoup d'affichages mais personne ne clique — couverture/titre à revoir |
| `very_low_clicks` | 1 à 4 clics | Trop tôt pour décider quoi que ce soit |
| `low_clicks` | 5 à 14 clics | En cours de test, on accumule des données |

### Post-éligibilité (≥ 15 clics — assez de données pour décider)

| Diagnostic | Condition | Signification |
|---|---|---|
| `clicks_no_sales` | ≥ 15 clics, 0 vente (ou ACoS > 1.3× la cible) | Le mot-clé attire du trafic mais ne convertit pas |
| `expensive_but_valid` | ≥ 15 clics, ≥ 1 vente, ACoS entre 1× et 1.3× la cible | Rentable mais un peu cher — à optimiser |
| `winner` | ≥ 15 clics, ≥ 1 vente, ACoS ≤ cible, CTR ≤ moyenne campagne | Mot-clé rentable et performant |
| `boost_candidate` | ≥ 15 clics, ≥ 1 vente, ACoS ≤ cible, CTR > moyenne campagne | Encore meilleur qu'un winner — candidat pour booster |

---

## 2. Actions de base par diagnostic

Chaque diagnostic déclenche un ensemble d'actions ordonnées par priorité.

### `no_impressions` → **Augmenter l'enchère**
- **Action primaire** : `bid_up` (action pub ⚡)
- **Raison** : L'enchère est probablement trop basse pour que Amazon diffuse l'annonce. Monter l'enchère augmente les chances d'obtenir des impressions.

### `zero_clicks_low_volume` → **Augmenter l'enchère + Patienter**
- **Action primaire** : `bid_up` (action pub ⚡)
- **Action secondaire** : `patience` (observation 👁)
- **Raison** : Pas assez de volume pour conclure. Un boost d'enchère peut aider, sinon il faut simplement attendre.

### `zero_clicks` → **Revoir la couverture + Surveiller**
- **Action primaire** : `improve_cover` (conseil livre 📖)
- **Action secondaire** : `monitor` (observation 👁)
- **Raison** : Avec ≥ 300 impressions et 0 clic, le problème vient probablement de la couverture ou du titre, pas de l'enchère.

### `very_low_clicks` → **Patienter + Surveiller**
- **Action primaire** : `patience` (observation 👁)
- **Action secondaire** : `monitor` (observation 👁)
- **Raison** : Seulement 1 à 4 clics — beaucoup trop tôt pour prendre une décision. On attend.

### `low_clicks` → **Surveiller + Patienter**
- **Action primaire** : `monitor` (observation 👁)
- **Action secondaire** : `patience` (observation 👁)
- **Raison** : 5 à 14 clics. On commence à avoir du signal mais pas assez pour une décision ferme. Surveillance active.

### `clicks_no_sales` → **Améliorer la fiche + Bloquer ce terme**
- **Action primaire** : `improve_listing` (conseil livre 📖)
- **Action secondaire** : `add_negative` / pause (action pub ⚡)
- **Raison** : Le mot-clé attire du trafic mais zéro conversion. Soit la fiche livre ne convertit pas (listing), soit le terme est hors cible (blocage/pause).

### `expensive_but_valid` → **Baisser l'enchère**
- **Action primaire** : `bid_down` (action pub ⚡)
- **Raison** : Le mot-clé convertit, mais l'ACoS est au-dessus de la cible (entre 1× et 1.3×). On baisse l'enchère pour ramener l'ACoS sous la cible.

### `winner` → **Augmenter l'enchère + Récolter en exact**
- **Action primaire** : `bid_up` (action pub ⚡)
- **Action secondaire** : `harvest` (action pub ⚡)
- **Raison** : Ce mot-clé est rentable ! On augmente l'enchère pour capter plus de volume et on le récolte en exact pour l'isoler.

### `boost_candidate` → **Augmenter l'enchère**
- **Action primaire** : `bid_up` (action pub ⚡)
- **Raison** : Encore meilleur qu'un winner (CTR au-dessus de la moyenne). On pousse l'enchère au max pour dominer ce terme.

---

## 3. Modificateurs par phase de cycle de vie

Le livre a une phase (`launch`, `scale`, `evergreen`, `relaunch`) qui modifie les actions suggérées.

### Phase `launch` (lancement)
- **Supprime `pause`** sauf si très gaspilleur (0 vente, ≥ 30 clics, dépense > 0)
- **Ajoute `patience`** si pas déjà présente
- **Déprioritise** les actions ads agressives (elles passent en secondaire)
- **Logique** : En lancement, on veut collecter des données, pas couper des termes trop tôt

### Phase `scale` (accélération)
- **Booste `bid_up` et `harvest`** en priorité
- **Logique** : On a des gagnants, on veut les pousser au maximum

### Phase `evergreen` (croisière)
- **Booste `bid_down` et `monitor`**
- **Ajoute `monitor`** si absent
- **Logique** : On est en mode maintenance, on optimise les coûts

### Phase `relaunch` (relance)
- **Booste les conseils livre** (`improve_listing`, `improve_cover`)
- **Ajoute `patience`** si absente
- **Logique** : On a relancé avec une nouvelle couverture/description, on veut observer l'impact

### Garde-fou break-even (toutes phases)
- **Si le mot-clé est profitable** (orders ≥ 1 ET ACoS ≤ cible) → **`pause` est TOUJOURS supprimée**
- **Logique** : On ne met jamais en pause un mot-clé qui rapporte de l'argent

---

## 4. Fenêtre de décision dynamique

Le système choisit automatiquement la fenêtre d'analyse (7j, 14j ou 30j) selon la phase.

| Phase | Fenêtre préférée | Fallback | Observe mode si… |
|---|---|---|---|
| `launch` | 7j (si ≥ 15 clics) → 14j → 30j | 7j observe | Aucune fenêtre ≥ 15 clics |
| `scale` | 14j (si ≥ 15 clics) → 30j | 14j observe | Aucune fenêtre ≥ 15 clics |
| `evergreen` | Toujours 30j | — | 30j < 20 clics |
| `relaunch` | 7j → 14j → 30j | 14j observe | Aucune fenêtre ≥ 15 clics |

**En observe mode** : toutes les actions sont remplacées par `monitor` (observation uniquement).

---

## 5. Validation multi-fenêtre (30j vs fenêtre courte)

Quand l'action est basée sur une fenêtre courte (7j ou 14j), le système valide contre la fenêtre longue (30j) pour éviter les sur-réactions.

| Situation | Fenêtre courte | 30j | Résultat |
|---|---|---|---|
| Action forte + 30j encore rentable | Mauvais (ex: ACoS haut) | ACoS ≤ cible | **Downgrade soft** : `pause` → `bid_down`, `add_negative` → `monitor` |
| Les deux fenêtres mauvaises | ACoS haut | ACoS haut | **Action confirmée** : on garde l'action forte |
| Fenêtre courte bonne mais 30j mauvais | ACoS ≤ cible | ACoS haut | **Observe** : tout remplacé par `monitor` (amélioration récente à confirmer) |
| Pas d'action forte | — | — | **Pas de validation** |

### Guardrail par phase de cycle de vie

| Phase | Fenêtre 7j | Fenêtre 14j | Fenêtre 30j |
|---|---|---|---|
| `launch` | Actions fortes interdites → soft | Actions fortes interdites → soft | Actions fortes autorisées |
| `relaunch` | Actions fortes interdites → soft | Autorisé seulement si 2× le seuil de clics ET ACoS très mauvais ET 30j confirme | Autorisé |
| `scale` | Autorisé (validation 30j gère) | Autorisé | Autorisé |
| `evergreen` | N/A (toujours 30j) | N/A | Autorisé |

**Actions fortes** = `pause`, `add_negative`
**Actions soft** = `bid_up`, `bid_down`

---

## 6. Calcul de l'enchère recommandée

### Éligibilité

| Niveau | Condition | Ce qui se passe |
|---|---|---|
| `insufficient_data` | < 5 clics | Aucune action d'enchère possible |
| `observe_only` | 5–14 clics, 0 vente | Patience recommandée, pas de modification d'enchère |
| `small_tweak_max` | 5–14 clics, ≥ 1 vente | Ajustement limité à ±10% |
| `full_calculation` | ≥ 15 clics | Formule complète |

### Formule complète (`full_calculation`)

```
CPC_cible = ACoS_cible × CVR × AOV
k_factor  = spend / (clics × CPC_cible)    [clampé entre 0.3 et 0.95]
bid_brut  = (CPC_cible / k_factor) × facteur_positionnement
bid_final = bid_brut × 0.70 + bid_Amazon × 0.30    [si bid Amazon disponible]
```

### Facteur de positionnement (basé sur l'ACoS actuel vs cible)

| Positionnement | ACoS actuel | Facteur | Effet |
|---|---|---|---|
| `top` | ≤ 70% de la cible | 0.85 | Réduit l'enchère — déjà très rentable, pas besoin de payer plus |
| `bon` | ≤ 100% de la cible | 1.00 | Neutre |
| `moyen` | ≤ 130% de la cible | 1.05 | Légère hausse pour rester compétitif |
| `faible` | > 130% de la cible | 1.15 | Hausse significative pour tenter d'améliorer la position |

### Cas spécial : ≥ 15 clics mais 0 vente
- Baisse automatique au maximum autorisé (−30%)
- **Logique** : Beaucoup de trafic sans conversion = enchère trop haute

### Direction forcée

Le diagnostic force une direction qui empêche la formule de contredire le diagnostic :

| Diagnostic | Direction forcée | Si la formule va dans le mauvais sens… |
|---|---|---|
| `clicks_no_sales` | ↓ down | Force −5% minimum |
| `expensive_but_valid` | ↓ down | Force −5% minimum |
| `winner` | ↑ up | Force +5% minimum |
| `boost_candidate` | ↑ up | Force +5% minimum |
| Autres | Aucune | La formule décide librement |

### Garde-fous sur l'enchère

| Garde-fou | Valeur |
|---|---|
| Enchère minimum | 0,10 € |
| Enchère maximum | 2,00 € |
| Hausse max par action | +20% |
| Baisse max par action | −30% |
| Max actions par jour | 50 |

---

## 7. Override par état de l'entité (nouveau)

L'état actuel de l'entité dans Amazon/DB **override toutes les actions ci-dessus** :

| État | Action affichée | Comportement au clic |
|---|---|---|
| `enabled` (actif) | Action normale (bid_up, bid_down, pause, bloquer, etc.) | Comportement standard |
| `paused` (en pause) | **Réactiver** (vert ▶️) | Modale de confirmation → remet en `enabled` sur Amazon |
| `archived` | Aucune action | — |

**Raison** : Un mot-clé en pause n'a pas besoin qu'on lui propose de baisser l'enchère ou de le bloquer — l'action logique est de le réactiver si on veut le retester.

---

## 8. Sélection de l'action affichée dans la colonne

Le moteur de scoring choisit la meilleure action parmi celles disponibles :

```
Score = poids_catégorie + (confiance / 2) + bonus_urgence + bonus_primary + bonus_éligible
```

| Composante | Valeur |
|---|---|
| Poids ACTION_PUB | 100 |
| Poids OBSERVATION | 30 |
| Poids BOOK_ADVICE | 10 |
| Confiance (0–100 → 0–50) | confiance × 0.5 |
| Bonus urgence (si diagnostic + action match) | +20 |
| Bonus primary | +15 |
| Bonus éligible | +30 |

### Priorité de sélection
1. **ACTION_PUB éligible** avec le score le plus haut
2. **OBSERVATION** : `watch` si 5–14 clics, sinon `wait`/`patience`
3. **BOOK_ADVICE** en fallback
4. Première action disponible (catch-all)

---

## 9. Scénarios concrets bout en bout

### Scénario A — Mot-clé neuf, pas encore d'impressions
- **Données** : 0 impressions, 0 clics, 0 vente
- **Diagnostic** : `no_impressions`
- **Action** : ⚡ Augmenter l'enchère
- **Explication** : L'enchère est probablement trop basse pour déclencher des enchères Amazon

### Scénario B — Mot-clé avec quelques impressions mais aucun clic
- **Données** : 150 impressions, 0 clics (< 300 seuil CTR)
- **Diagnostic** : `zero_clicks_low_volume`
- **Action** : ⚡ Augmenter l'enchère (primaire), 👁 Patienter (secondaire)
- **Explication** : Pas assez de volume pour juger, on tente une hausse d'enchère

### Scénario C — Beaucoup d'impressions, zéro clic
- **Données** : 500 impressions, 0 clics
- **Diagnostic** : `zero_clicks`
- **Action** : 📖 Revoir ta couverture (primaire), 👁 Surveiller (secondaire)
- **Explication** : L'annonce est vue mais personne ne clique — problème de couverture/titre

### Scénario D — Phase de test, très peu de clics
- **Données** : 200 impressions, 3 clics, 0 vente
- **Diagnostic** : `very_low_clicks`
- **Éligibilité enchère** : `insufficient_data` (< 5 clics)
- **Action** : 👁 Patienter
- **Explication** : Trop tôt, il faut au minimum 5 clics pour envisager une action

### Scénario E — Phase de test, début de signal
- **Données** : 800 impressions, 8 clics, 0 vente
- **Diagnostic** : `low_clicks`
- **Éligibilité enchère** : `observe_only` (5–14 clics, 0 vente)
- **Action** : 👁 Surveiller
- **Explication** : On a un début de signal mais pas assez pour conclure

### Scénario F — Phase de test avec une vente
- **Données** : 500 impressions, 10 clics, 1 vente, ACoS 25% (cible 40%)
- **Diagnostic** : `low_clicks` (< 15 clics)
- **Éligibilité enchère** : `small_tweak_max` (5–14 clics, ≥ 1 vente)
- **Action** : ⚡ Augmenter l'enchère (+10% max car small_tweak)
- **Explication** : On a une vente et un bon ACoS, mais pas assez de données pour la formule complète

### Scénario G — Beaucoup de clics, zéro vente (le classique)
- **Données** : 2000 impressions, 25 clics, 0 vente, 8€ dépensés
- **Diagnostic** : `clicks_no_sales`
- **Éligibilité enchère** : `full_calculation` (≥ 15 clics)
- **Action affichée** : ⚡ Bloquer ce terme / 📖 Améliorer ta fiche livre
- **Calcul enchère** : Baisse maximale de −30% (cas spécial 0 vente)
- **Direction forcée** : ↓ down
- **Explication** : Le terme attire du trafic mais ne convertit pas. Soit le terme est hors cible (bloquer), soit la fiche ne convertit pas (améliorer)

### Scénario H — Rentable mais un peu cher
- **Données** : 1500 impressions, 20 clics, 2 ventes, ACoS 48% (cible 40%)
- **Diagnostic** : `expensive_but_valid` (ACoS entre 1× et 1.3× cible)
- **Action** : ⚡ Baisser l'enchère
- **Calcul enchère** : Formule complète, direction forcée ↓ down
- **Explication** : Le mot-clé convertit mais coûte trop cher. On baisse l'enchère pour ramener l'ACoS sous la cible

### Scénario I — Mot-clé gagnant
- **Données** : 3000 impressions, 40 clics, 5 ventes, ACoS 28% (cible 40%)
- **Diagnostic** : `winner`
- **Action** : ⚡ Augmenter l'enchère (primaire), ⚡ Récolter en exact (secondaire)
- **Calcul enchère** : Formule complète, direction forcée ↑ up, positionnement `bon` (facteur 1.0)
- **Explication** : Mot-clé rentable, on augmente pour capter plus de volume

### Scénario J — Mot-clé star (boost candidate)
- **Données** : 5000 impressions, 60 clics, 8 ventes, ACoS 20% (cible 40%), CTR au-dessus de la moyenne campagne
- **Diagnostic** : `boost_candidate`
- **Action** : ⚡ Augmenter l'enchère
- **Calcul enchère** : Formule complète, direction forcée ↑ up, positionnement `top` (facteur 0.85 — réduit car déjà très rentable, pas besoin de surenchérir)
- **Explication** : Le meilleur performeur de la campagne, on pousse au maximum

### Scénario K — Mot-clé en pause (état `paused`)
- **Données** : Peu importe les métriques
- **État** : `paused`
- **Action** : ⚡ **Réactiver** (override de toutes les autres actions)
- **Modale** : Confirmation verte "Réactiver ce ciblage"
- **Explication** : L'action logique pour un mot-clé en pause est de le réactiver si on souhaite retester

### Scénario L — En lancement, mot-clé qui perd de l'argent
- **Données** : 1000 impressions, 18 clics, 0 vente (sur 7j), phase `launch`
- **Diagnostic** : `clicks_no_sales`
- **Sans le lifecycle modifier** : Bloquer / Améliorer la fiche
- **Avec le lifecycle modifier** : `pause` est supprimée (sauf si très gaspilleur), `patience` est ajoutée
- **Avec le lifecycle guardrail** : Si fenêtre = 7j, les actions fortes (pause, negative) sont downgradées → `bid_down` au lieu de `pause`
- **Action finale** : 📖 Améliorer ta fiche livre (priorité réduite sur les actions ads)
- **Explication** : En lancement, on ne coupe pas trop vite

### Scénario M — Mot-clé mauvais sur 14j mais bon sur 30j
- **Données sur 14j** : 20 clics, 0 vente, ACoS ∞
- **Données sur 30j** : 50 clics, 3 ventes, ACoS 35% (cible 40%)
- **Phase** : `evergreen`
- **Diagnostic (sur 30j car evergreen)** : Dépend du 30j → probablement `winner`
- **Si la décision venait du 14j** : `clicks_no_sales` → pause proposée
- **Validation 30j** : Action forte MAIS 30j rentable → **downgrade** : `pause` → `bid_down`, `add_negative` → `monitor`
- **Action finale** : ⚡ Baisser l'enchère (au lieu de pause)
- **Explication** : Le mot-clé a eu une mauvaise passe récente mais reste rentable sur le long terme — on ajuste au lieu de couper

### Scénario N — Mot-clé archivé
- **État** : `archived`
- **Action** : Aucune (tiret)
- **Explication** : Un mot-clé archivé ne peut plus recevoir d'action

### Scénario O — Produit ciblé (ASIN) en pause
- **Type** : product target
- **État** : `paused`
- **Action** : ⚡ **Réactiver**
- **Explication** : Même logique que pour les mots-clés — la réactivation s'applique aussi aux produits ciblés

---

## 10. Résumé des garde-fous de sécurité

| Garde-fou | Description | Effet |
|---|---|---|
| Kill switch | Interrupteur global d'urgence | Bloque TOUTES les actions |
| Feature flag `auto_execute_enabled` | Désactivable en DB | Bloque les actions automatiques |
| Workspace `dry_run` | Mode simulation par workspace | Toutes les actions sont simulées |
| Workspace `auto_mode_enabled` | Désactivable par workspace | Bloque les actions système (user OK) |
| Break-even guard | Mot-clé profitable | Interdit `pause` |
| Daily limit | 50 actions/jour max | Bloque au-delà |
| Bid min/max | 0,10 € – 2,00 € | Cap automatique |
| Bid increase max | +20% par action | Cap automatique |
| Bid decrease max | −30% par action | Cap automatique |
| Lifecycle guardrail | Phase + fenêtre trop courte | Downgrade les actions fortes |
| Validation multi-fenêtre | 30j vs fenêtre courte | Downgrade si contradiction |
