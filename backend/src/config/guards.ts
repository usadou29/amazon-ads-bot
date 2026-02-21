// ============================================
// GARDE-FOUS V1 - CONSTANTES DE SÉCURITÉ
// ============================================

export const GUARDS = {
  // Limites d'enchères
  MIN_BID: 0.10,
  MAX_BID: 2.00,
  MAX_BID_INCREASE_PCT: 20,
  MAX_BID_DECREASE_PCT: 30,

  // Seuils de décision
  MIN_CLICKS_FOR_DECISION: 15,
  MIN_SPEND_FOR_DECISION: 5.0,

  // Limites d'actions
  MAX_ACTIONS_PER_DAY: 50,
  MAX_ACTIONS_PER_RULE_PER_DAY: 10,
  DEFAULT_COOLDOWN_HOURS: 48,

  // Polling des reports
  REPORT_POLL_TIMEOUT_MINUTES: 30,
  REPORT_POLL_INTERVAL_SECONDS: 30,

  // Search terms
  SEARCH_TERMS_MAX_DAYS_BACK: 60,

  // ACOS par défaut
  DEFAULT_ACOS_TARGET: 40,

  // Royalty rate par défaut (break-even ACoS)
  DEFAULT_ROYALTY_RATE: 35,
} as const;

// Types pour les constantes
export type GuardsConfig = typeof GUARDS;

/**
 * Valide un changement d'enchère
 */
export function validateBidChange(
  current: number,
  proposed: number,
): { valid: boolean; errors: string[]; adjustedValue: number } {
  const errors: string[] = [];
  const changePct = ((proposed - current) / current) * 100;

  if (proposed < GUARDS.MIN_BID) {
    errors.push(`Bid ${proposed} < min ${GUARDS.MIN_BID}`);
  }
  if (proposed > GUARDS.MAX_BID) {
    errors.push(`Bid ${proposed} > max ${GUARDS.MAX_BID}`);
  }
  if (changePct > GUARDS.MAX_BID_INCREASE_PCT) {
    errors.push(
      `Increase ${changePct.toFixed(1)}% > max ${GUARDS.MAX_BID_INCREASE_PCT}%`,
    );
  }
  if (changePct < -GUARDS.MAX_BID_DECREASE_PCT) {
    errors.push(
      `Decrease ${Math.abs(changePct).toFixed(1)}% > max ${GUARDS.MAX_BID_DECREASE_PCT}%`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    adjustedValue: Math.max(
      GUARDS.MIN_BID,
      Math.min(GUARDS.MAX_BID, proposed),
    ),
  };
}

/**
 * Calcule le nouveau bid après ajustement en pourcentage
 */
export function calculateNewBid(
  currentBid: number,
  adjustmentPct: number,
): { newBid: number; capped: boolean; cappedReason?: string } {
  const proposedBid = currentBid * (1 + adjustmentPct / 100);
  const validation = validateBidChange(currentBid, proposedBid);

  return {
    newBid: validation.adjustedValue,
    capped: !validation.valid,
    cappedReason: validation.errors.length > 0 ? validation.errors.join('; ') : undefined,
  };
}
