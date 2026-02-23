// ═══════════════════════════════════════════════════════════
// Decision Window v2 — Fonctions pures (pas de service injectable)
// Résout dynamiquement la fenêtre de décision et valide
// les actions fortes contre la fenêtre longue (30j).
// ═══════════════════════════════════════════════════════════

import type { LifecyclePhase } from '@/db/schema/books';
import type { WindowMetrics, MetricsByWindow } from '@/modules/insights/types';
import { GUARDS } from '@/config/guards';

// ── Types ─────────────────────────────────────────────────

export type DecisionWindowDays = 7 | 14 | 30;

export type ActionIntensity = 'observe' | 'soft' | 'strong';

export interface DecisionWindowResult {
  chosenWindow: DecisionWindowDays;
  isObserveMode: boolean;   // true = seuil hard non atteint sur aucune fenêtre
  reason: string;           // ex: 'clicks_7d_sufficient', 'insufficient_clicks_observe_mode'
  metricsOnWindow: WindowMetrics;
}

export interface ValidationResult {
  applied: boolean;
  reason: string;
  downgradeLevel?: 'soft_adjust' | 'observe' | 'no_change';
}

export interface GuardrailResult {
  applied: boolean;
  reason: string;
  downgradeLevel?: 'soft_adjust' | 'observe';
  explanation?: string;     // Message UI à afficher
}

// ── Helpers internes ──────────────────────────────────────

function getClicksForWindow(metricsByWindow: MetricsByWindow, window: DecisionWindowDays): number {
  switch (window) {
    case 7:  return metricsByWindow.window_7d?.clicks ?? 0;
    case 14: return metricsByWindow.window_14d?.clicks ?? 0;
    case 30: return metricsByWindow.window_30d?.clicks ?? 0;
  }
}

function getMetricsForWindow(metricsByWindow: MetricsByWindow, window: DecisionWindowDays): WindowMetrics {
  switch (window) {
    case 7:  return metricsByWindow.window_7d;
    case 14: return metricsByWindow.window_14d;
    case 30: return metricsByWindow.window_30d;
  }
}

function computeAcos(metrics: WindowMetrics): number {
  if (!metrics || metrics.sales <= 0) return Infinity;
  return (metrics.spend / metrics.sales) * 100;
}

// ── resolveDecisionWindow ─────────────────────────────────

/**
 * Résout dynamiquement la fenêtre de décision optimale
 * basée sur la suffisance des clics par phase de cycle de vie.
 *
 * Principe : choisir la fenêtre la plus courte ayant assez de données
 * pour une décision confiante (>= hard threshold).
 * Si aucune fenêtre n'a assez de données → fallback en observe mode.
 *
 * IMPORTANT: ne jamais mélanger des métriques de fenêtres différentes.
 * Une fois la fenêtre choisie, TOUTES les métriques retournées viennent
 * exclusivement de cette fenêtre.
 */
export function resolveDecisionWindow(
  lifecycle: LifecyclePhase,
  metricsByWindow: MetricsByWindow,
): DecisionWindowResult {
  const thresholds = GUARDS.DECISION_CLICK_THRESHOLDS[lifecycle] ?? { hard: 15, soft: 8 };
  const hard = thresholds.hard;

  const clicks7  = getClicksForWindow(metricsByWindow, 7);
  const clicks14 = getClicksForWindow(metricsByWindow, 14);
  const clicks30 = getClicksForWindow(metricsByWindow, 30);

  switch (lifecycle) {
    case 'launch':
      return resolveLaunch(metricsByWindow, hard, clicks7, clicks14, clicks30);

    case 'scale':
      return resolveScale(metricsByWindow, hard, clicks14, clicks30);

    case 'evergreen':
      return {
        chosenWindow: 30,
        isObserveMode: clicks30 < hard,
        reason: 'evergreen_always_30d',
        metricsOnWindow: getMetricsForWindow(metricsByWindow, 30),
      };

    case 'relaunch':
      return resolveRelaunch(metricsByWindow, hard, clicks7, clicks14, clicks30);

    default:
      return {
        chosenWindow: 14,
        isObserveMode: true,
        reason: 'unknown_phase_fallback',
        metricsOnWindow: getMetricsForWindow(metricsByWindow, 14),
      };
  }
}

function resolveLaunch(
  m: MetricsByWindow, hard: number,
  clicks7: number, clicks14: number, clicks30: number,
): DecisionWindowResult {
  if (clicks7 >= hard) {
    return { chosenWindow: 7, isObserveMode: false, reason: 'clicks_7d_sufficient', metricsOnWindow: m.window_7d };
  }
  if (clicks14 >= hard) {
    return { chosenWindow: 14, isObserveMode: false, reason: 'clicks_14d_sufficient', metricsOnWindow: m.window_14d };
  }
  if (clicks30 >= hard) {
    return { chosenWindow: 30, isObserveMode: false, reason: 'clicks_30d_sufficient', metricsOnWindow: m.window_30d };
  }
  // Fallback: 7j en observe mode — ne jamais bloquer indéfiniment en launch
  return { chosenWindow: 7, isObserveMode: true, reason: 'insufficient_clicks_observe_mode', metricsOnWindow: m.window_7d };
}

function resolveScale(
  m: MetricsByWindow, hard: number,
  clicks14: number, clicks30: number,
): DecisionWindowResult {
  if (clicks14 >= hard) {
    return { chosenWindow: 14, isObserveMode: false, reason: 'clicks_14d_sufficient', metricsOnWindow: m.window_14d };
  }
  if (clicks30 >= hard) {
    return { chosenWindow: 30, isObserveMode: false, reason: 'clicks_30d_sufficient', metricsOnWindow: m.window_30d };
  }
  // Fallback: 14j en observe mode
  return { chosenWindow: 14, isObserveMode: true, reason: 'insufficient_clicks_observe_mode', metricsOnWindow: m.window_14d };
}

function resolveRelaunch(
  m: MetricsByWindow, hard: number,
  clicks7: number, clicks14: number, clicks30: number,
): DecisionWindowResult {
  if (clicks7 >= hard) {
    return { chosenWindow: 7, isObserveMode: false, reason: 'clicks_7d_sufficient', metricsOnWindow: m.window_7d };
  }
  if (clicks14 >= hard) {
    return { chosenWindow: 14, isObserveMode: false, reason: 'clicks_14d_sufficient', metricsOnWindow: m.window_14d };
  }
  if (clicks30 >= hard) {
    return { chosenWindow: 30, isObserveMode: false, reason: 'clicks_30d_sufficient', metricsOnWindow: m.window_30d };
  }
  // Fallback: 14j (pas 7j comme launch, car relaunch a plus de contexte historique)
  return { chosenWindow: 14, isObserveMode: true, reason: 'insufficient_clicks_observe_mode', metricsOnWindow: m.window_14d };
}

// ── validateAgainstLongWindow ─────────────────────────────

const STRONG_ACTIONS = new Set(['pause', 'add_negative', 'bid_down']);

/**
 * Valide une action issue de la decision window contre la fenêtre longue (30j).
 *
 * Objectif : éviter les sur-réactions en scale/evergreen.
 * Si un keyword est rentable sur 30j, une action forte (pause, negative)
 * basée sur une fenêtre courte est downgradée vers un ajustement soft.
 *
 * - LAUNCH: jamais de validation
 * - RELAUNCH: validation souple (uniquement pause si 30j rentable)
 * - SCALE/EVERGREEN: validation complète
 */
export function validateAgainstLongWindow(
  lifecycle: LifecyclePhase,
  decisionMetrics: WindowMetrics,
  longMetrics30d: WindowMetrics,
  actionCategory: string,
  breakEvenAcos: number,
): ValidationResult {
  // Launch: jamais de validation
  if (lifecycle === 'launch') {
    return { applied: false, reason: 'no_validation_for_launch' };
  }

  // Relaunch: validation souple (uniquement pause)
  if (lifecycle === 'relaunch') {
    if (actionCategory === 'pause') {
      const longAcos = computeAcos(longMetrics30d);
      if (longAcos <= breakEvenAcos) {
        return { applied: true, reason: 'pause_but_30d_profitable_relaunch', downgradeLevel: 'soft_adjust' };
      }
    }
    return { applied: false, reason: 'relaunch_lenient_no_validation' };
  }

  // Scale / Evergreen: validation complète
  const isStrongAction = STRONG_ACTIONS.has(actionCategory);
  const decisionAcos = computeAcos(decisionMetrics);
  const longAcos = computeAcos(longMetrics30d);
  const longIsProfitable = longAcos <= breakEvenAcos;
  const decisionIsBad = decisionAcos > breakEvenAcos;

  // Cas 1: action forte ET 30j encore rentable → downgrade
  if (isStrongAction && longIsProfitable) {
    return { applied: true, reason: 'strong_action_but_30d_profitable', downgradeLevel: 'soft_adjust' };
  }

  // Cas 2: les deux sont mauvais → action confirmée
  if (decisionIsBad && !longIsProfitable) {
    return { applied: false, reason: 'both_windows_bad_action_confirmed' };
  }

  // Cas 3: decision bonne MAIS 30j mauvais → observe (possible fatigue récente)
  if (!decisionIsBad && !longIsProfitable) {
    return { applied: true, reason: 'decision_good_but_30d_bad_observe', downgradeLevel: 'observe' };
  }

  // Cas par défaut: pas de validation nécessaire
  return { applied: false, reason: 'no_validation_needed' };
}

// ── Action Intensity Classification ──────────────────────

/**
 * Actions considérées comme "fortes" (irréversibles ou agressives).
 */
const STRONG_INTENSITY_ACTIONS = new Set(['pause', 'add_negative']);
const SOFT_INTENSITY_ACTIONS = new Set(['bid_down', 'bid_up']);

/**
 * Classifie l'intensité d'une action.
 */
export function classifyActionIntensity(actionType: string): ActionIntensity {
  if (STRONG_INTENSITY_ACTIONS.has(actionType)) return 'strong';
  if (SOFT_INTENSITY_ACTIONS.has(actionType)) return 'soft';
  // monitor, patience, improve_cover, improve_listing, harvest → observe
  return 'observe';
}

// ── Lifecycle Guardrail ─────────────────────────────────

/**
 * Guardrail post-pipeline : empêche les actions trop agressives
 * quand la fenêtre de décision est courte par rapport à la phase.
 *
 * S'applique APRÈS resolveDecisionWindow + computeInsight + validateAgainstLongWindow.
 *
 * Règles :
 * - LAUNCH : strong interdit si decisionWindow < 30j → downgrade vers soft
 * - RELAUNCH :
 *     - 7j → soft only
 *     - 14j → strong autorisé seulement si clicks >= 2*hard ET longWindow confirme la tendance
 *     - 30j → strong autorisé
 * - SCALE : strong autorisé (déjà validé par validateAgainstLongWindow)
 * - EVERGREEN : strong autorisé (déjà toujours 30j)
 */
export function applyLifecycleGuardrail(
  actionType: string,
  lifecycle: LifecyclePhase,
  decisionWindowDays: DecisionWindowDays,
  metricsByWindow?: MetricsByWindow,
  breakEvenAcos?: number,
): GuardrailResult {
  const intensity = classifyActionIntensity(actionType);

  // Seules les actions "strong" peuvent être downgradées
  if (intensity !== 'strong') {
    return { applied: false, reason: 'action_not_strong' };
  }

  // ── LAUNCH : pas de strong en < 30j ──
  if (lifecycle === 'launch') {
    if (decisionWindowDays < 30) {
      return {
        applied: true,
        reason: 'launch_guardrail_short_window',
        downgradeLevel: 'soft_adjust',
        explanation: 'En phase de lancement, nous privilégions des ajustements progressifs avant toute coupure définitive.',
      };
    }
    // 30j → strong autorisé
    return { applied: false, reason: 'launch_30d_strong_allowed' };
  }

  // ── RELAUNCH ──
  if (lifecycle === 'relaunch') {
    if (decisionWindowDays === 7) {
      return {
        applied: true,
        reason: 'relaunch_guardrail_7d',
        downgradeLevel: 'soft_adjust',
        explanation: 'En phase de relance, 7 jours ne suffisent pas pour justifier une action forte. Ajustement progressif appliqué.',
      };
    }
    if (decisionWindowDays === 14) {
      // Strong autorisé uniquement si :
      //   - clicks >= 2 * hard threshold
      //   - ET ACoS très au-dessus du breakEvenAcos
      //   - ET longWindow confirme (30j aussi mauvais)
      const thresholds = GUARDS.DECISION_CLICK_THRESHOLDS['relaunch'] ?? { hard: 15, soft: 8 };
      const clicks14 = metricsByWindow ? getClicksForWindow(metricsByWindow, 14) : 0;
      const acos30 = metricsByWindow ? computeAcos(metricsByWindow.window_30d) : Infinity;
      const acos14 = metricsByWindow ? computeAcos(metricsByWindow.window_14d) : Infinity;

      const hasDoubleClicks = clicks14 >= thresholds.hard * 2;
      const acos14VeryBad = breakEvenAcos ? acos14 > breakEvenAcos * 1.5 : false;
      const longWindowConfirms = breakEvenAcos ? acos30 > breakEvenAcos : false;

      if (hasDoubleClicks && acos14VeryBad && longWindowConfirms) {
        return { applied: false, reason: 'relaunch_14d_strong_confirmed' };
      }
      return {
        applied: true,
        reason: 'relaunch_guardrail_14d_insufficient_evidence',
        downgradeLevel: 'soft_adjust',
        explanation: 'En relance, une action forte à 14 jours nécessite plus de données ou une confirmation sur 30 jours.',
      };
    }
    // 30j → strong autorisé
    return { applied: false, reason: 'relaunch_30d_strong_allowed' };
  }

  // ── SCALE : strong autorisé (validateAgainstLongWindow gère déjà) ──
  // ── EVERGREEN : toujours 30j, strong autorisé ──
  return { applied: false, reason: 'scale_evergreen_strong_allowed' };
}
