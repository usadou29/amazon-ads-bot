// ============================================
// BID CALCULATOR — Fonction pure, déterministe
// ============================================
// Formule : CPC_target = ACoS_target × CVR × AOV
//           recommendedBid = (CPC_target / k) × positioningFactor
// ============================================

import { GUARDS } from '@/config/guards';

// ── Types ───────────────────────────────────────────────

export type BidEligibility =
  | 'insufficient_data'   // clicks < 5 → pas d'action possible
  | 'observe_only'        // clicks 5-14, orders === 0 → patience
  | 'small_tweak_max'     // clicks 5-14, orders >= 1 → ±10% max
  | 'full_calculation';   // clicks >= 15 → formule complète

export type PositioningLabel = 'top' | 'bon' | 'moyen' | 'faible';

export type BidDirection = 'up' | 'down' | null;

export interface BidCalculationInput {
  currentBid: number;
  acosTarget: number;          // en décimal (0.40 = 40%)
  cvr: number;                 // en décimal (0.05 = 5%)
  aov: number;                 // Average Order Value (sales / orders)
  impressions: number;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  amazonSuggestedBid?: number; // bid recommandé Amazon (live)
  amazonBidRangeMin?: number;
  amazonBidRangeMax?: number;
  direction?: BidDirection;    // direction forcée par le diagnostic (empêche bid_down de monter)
}

export interface BidCalculationResult {
  eligibility: BidEligibility;
  recommendedBid: number | null;
  currentBid: number;
  cpcTarget: number | null;
  kFactor: number | null;
  positioningFactor: number;
  positioningLabel: PositioningLabel;
  bidFloor: number;
  bidCeiling: number;
  guardsCapped: boolean;
  guardsReason?: string;
  explanation: string;
}

// ── Constantes internes ─────────────────────────────────

const K_MIN = 0.3;
const K_MAX = 0.95;
const K_DEFAULT = 0.7;

const SMALL_TWEAK_MAX_PCT = 10; // ±10% pour small_tweak_max
const MIN_DIRECTION_STEP_PCT = 5; // Si la formule va dans le mauvais sens, forcer ±5% min

const POSITIONING: Record<PositioningLabel, { factor: number; maxAcosRatio: number }> = {
  top:    { factor: 0.85, maxAcosRatio: 0.7 },
  bon:    { factor: 1.0,  maxAcosRatio: 1.0 },
  moyen:  { factor: 1.05, maxAcosRatio: 1.3 },
  faible: { factor: 1.15, maxAcosRatio: Infinity },
};

// ── Helpers ─────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Applique TOUS les gardes-fous : MIN_BID, MAX_BID, MAX_INCREASE%, MAX_DECREASE%
 * validateBidChange() de guards.ts ne cap que MIN/MAX (adjustedValue),
 * mais ne cap pas au pourcentage. On le fait ici.
 */
function applyAllGuards(
  currentBid: number,
  proposedBid: number,
): { finalBid: number; capped: boolean; reason?: string } {
  const maxUp = round2(currentBid * (1 + GUARDS.MAX_BID_INCREASE_PCT / 100));
  const maxDown = round2(currentBid * (1 - GUARDS.MAX_BID_DECREASE_PCT / 100));

  let bid = proposedBid;
  const reasons: string[] = [];

  // Cap au pourcentage d'abord
  if (bid > maxUp) {
    reasons.push(`+${(((bid - currentBid) / currentBid) * 100).toFixed(1)}% > max +${GUARDS.MAX_BID_INCREASE_PCT}%`);
    bid = maxUp;
  }
  if (bid < maxDown) {
    reasons.push(`-${(((currentBid - bid) / currentBid) * 100).toFixed(1)}% > max -${GUARDS.MAX_BID_DECREASE_PCT}%`);
    bid = maxDown;
  }

  // Cap aux limites absolues
  if (bid < GUARDS.MIN_BID) {
    reasons.push(`Bid ${bid} < min ${GUARDS.MIN_BID}`);
    bid = GUARDS.MIN_BID;
  }
  if (bid > GUARDS.MAX_BID) {
    reasons.push(`Bid ${bid} > max ${GUARDS.MAX_BID}`);
    bid = GUARDS.MAX_BID;
  }

  return {
    finalBid: round2(bid),
    capped: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join('; ') : undefined,
  };
}

/**
 * Force le bid dans la bonne direction.
 * Si direction === 'down' et proposedBid >= currentBid → réduire de MIN_DIRECTION_STEP_PCT
 * Si direction === 'up' et proposedBid <= currentBid → augmenter de MIN_DIRECTION_STEP_PCT
 */
function enforceDirection(
  currentBid: number,
  proposedBid: number,
  direction: BidDirection,
): { bid: number; enforced: boolean } {
  if (!direction) return { bid: proposedBid, enforced: false };

  if (direction === 'down' && proposedBid >= currentBid) {
    // La formule propose de monter ou stagne alors que le diagnostic veut baisser
    const forcedBid = round2(currentBid * (1 - MIN_DIRECTION_STEP_PCT / 100));
    return { bid: forcedBid, enforced: true };
  }

  if (direction === 'up' && proposedBid <= currentBid) {
    // La formule propose de baisser ou stagne alors que le diagnostic veut monter
    const forcedBid = round2(currentBid * (1 + MIN_DIRECTION_STEP_PCT / 100));
    return { bid: forcedBid, enforced: true };
  }

  return { bid: proposedBid, enforced: false };
}

function determinePositioning(acos: number | null, acosTarget: number): {
  label: PositioningLabel;
  factor: number;
} {
  if (acos === null || acos === 0) {
    // Pas d'ACoS (pas de ventes) → conservateur
    return { label: 'faible', factor: POSITIONING.faible.factor };
  }
  if (acos <= acosTarget * POSITIONING.top.maxAcosRatio) {
    return { label: 'top', factor: POSITIONING.top.factor };
  }
  if (acos <= acosTarget * POSITIONING.bon.maxAcosRatio) {
    return { label: 'bon', factor: POSITIONING.bon.factor };
  }
  if (acos <= acosTarget * POSITIONING.moyen.maxAcosRatio) {
    return { label: 'moyen', factor: POSITIONING.moyen.factor };
  }
  return { label: 'faible', factor: POSITIONING.faible.factor };
}

function determineEligibility(clicks: number, orders: number): BidEligibility {
  if (clicks < 5) return 'insufficient_data';
  if (clicks < GUARDS.MIN_CLICKS_FOR_DECISION) {
    return orders === 0 ? 'observe_only' : 'small_tweak_max';
  }
  return 'full_calculation';
}

// ── Fonction principale ─────────────────────────────────

export function calculateRecommendedBid(input: BidCalculationInput): BidCalculationResult {
  const {
    currentBid,
    acosTarget,
    cvr,
    aov,
    clicks,
    orders,
    spend,
    sales,
  } = input;

  const eligibility = determineEligibility(clicks, orders);
  const acos = sales > 0 ? (spend / sales) : null; // ratio décimal, pas %
  const positioning = determinePositioning(
    acos !== null ? acos * 100 : null, // convertir en % pour comparaison
    acosTarget * 100,                   // acosTarget est en décimal
  );

  const base = {
    currentBid,
    bidFloor: GUARDS.MIN_BID,
    bidCeiling: GUARDS.MAX_BID,
    positioningFactor: positioning.factor,
    positioningLabel: positioning.label,
  };

  // ── insufficient_data : pas d'action possible ──
  if (eligibility === 'insufficient_data') {
    return {
      ...base,
      eligibility,
      recommendedBid: null,
      cpcTarget: null,
      kFactor: null,
      guardsCapped: false,
      explanation: `Seulement ${clicks} clic(s). Il faut au minimum 5 clics pour proposer une action.`,
    };
  }

  // ── observe_only : patience recommandée ──
  if (eligibility === 'observe_only') {
    return {
      ...base,
      eligibility,
      recommendedBid: null,
      cpcTarget: null,
      kFactor: null,
      guardsCapped: false,
      explanation: `${clicks} clics, 0 vente. Phase d'observation — patience recommandée.`,
    };
  }

  // ── small_tweak_max : ±10% max, pas de formule complète ──
  if (eligibility === 'small_tweak_max') {
    // Direction basée sur le positionnement, SAUF si une direction est forcée
    let direction: number;
    if (input.direction === 'down') {
      direction = -1;
    } else if (input.direction === 'up') {
      direction = 1;
    } else {
      direction = positioning.label === 'top' || positioning.label === 'bon' ? 1 : -1;
    }
    const tweakPct = direction * SMALL_TWEAK_MAX_PCT;
    const proposed = round2(currentBid * (1 + tweakPct / 100));

    const guards = applyAllGuards(currentBid, proposed);

    return {
      ...base,
      eligibility,
      recommendedBid: guards.finalBid,
      cpcTarget: null,
      kFactor: null,
      guardsCapped: guards.capped,
      guardsReason: guards.reason,
      explanation: `${clicks} clics, ${orders} vente(s). Ajustement limité à ±${SMALL_TWEAK_MAX_PCT}% (${direction > 0 ? 'hausse' : 'baisse'}).`,
    };
  }

  // ── full_calculation : formule CPC_target complète ──

  // Cas spécial : 0 orders malgré eligibility (clicks >= 15, orders === 0)
  // → bid down conservateur
  if (orders === 0 || cvr === 0) {
    const proposed = round2(currentBid * (1 - GUARDS.MAX_BID_DECREASE_PCT / 100));
    const guards = applyAllGuards(currentBid, proposed);

    return {
      ...base,
      eligibility,
      recommendedBid: guards.finalBid,
      cpcTarget: null,
      kFactor: null,
      guardsCapped: guards.capped,
      guardsReason: guards.reason,
      explanation: `${clicks} clics, 0 vente. Baisse maximale de -${GUARDS.MAX_BID_DECREASE_PCT}% pour limiter les pertes.`,
    };
  }

  // Calcul CPC_target
  const cpcTarget = round2(acosTarget * cvr * aov);

  // Calcul k factor
  let kFactor: number;
  if (spend === 0 || cpcTarget === 0) {
    kFactor = K_DEFAULT;
  } else {
    const rawK = spend / (clicks * cpcTarget);
    kFactor = clamp(rawK, K_MIN, K_MAX);
  }

  // Calcul bid recommandé
  let rawBid = (cpcTarget / kFactor) * positioning.factor;

  // Intégrer le bid Amazon si disponible (moyenne pondérée 70% calcul / 30% Amazon)
  if (input.amazonSuggestedBid != null && input.amazonSuggestedBid > 0) {
    rawBid = rawBid * 0.7 + input.amazonSuggestedBid * 0.3;
  }

  rawBid = round2(rawBid);

  // Forcer la direction si spécifiée (empêche bid_down de proposer plus haut)
  const directionResult = enforceDirection(currentBid, rawBid, input.direction ?? null);
  if (directionResult.enforced) {
    rawBid = directionResult.bid;
  }

  // Appliquer TOUS les gardes-fous (MIN/MAX + pourcentage)
  const guards = applyAllGuards(currentBid, rawBid);
  const finalBid = guards.finalBid;

  const changePct = ((finalBid - currentBid) / currentBid * 100).toFixed(1);
  const dirLabel = finalBid >= currentBid ? 'hausse' : 'baisse';
  const dirNote = directionResult.enforced
    ? ` Direction forcée (${input.direction}).`
    : '';

  return {
    ...base,
    eligibility,
    recommendedBid: finalBid,
    cpcTarget,
    kFactor: round2(kFactor * 100) / 100,
    guardsCapped: guards.capped,
    guardsReason: guards.reason,
    explanation: `CPC cible = ${cpcTarget}€, k = ${kFactor.toFixed(2)}, positionnement ${positioning.label}. ${dirLabel === 'hausse' ? 'Augmentation' : 'Baisse'} de ${changePct}%.${dirNote}`,
  };
}
