/**
 * Rule Evaluator - Classe pour evaluer les conditions JSON des regles
 * Supporte: clicks, orders, acos, spend, impressions, ctr, cpc, etc.
 */

import { GUARDS } from '@/config/guards';

// Types pour les conditions
export type ComparisonOperator = '>=' | '>' | '<=' | '<' | '=' | '!=';

export interface RuleCondition {
  metric: string;
  operator: ComparisonOperator;
  value: number;
  period_days?: number;
}

export interface RuleConditions {
  operator: 'AND' | 'OR';
  conditions: RuleCondition[];
}

// Metriques aggregees sur une periode
export interface AggregatedMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
  // KPIs calcules
  ctr: number;
  cpc: number;
  acos: number;
  roas: number;
  cvr: number;
  cpa: number;
}

export interface EvaluationResult {
  matched: boolean;
  conditionResults: ConditionResult[];
  metricsUsed: AggregatedMetrics;
  reason?: string;
}

export interface ConditionResult {
  condition: RuleCondition;
  actualValue: number;
  matched: boolean;
}

/**
 * RuleEvaluator - Evalue les conditions d'une regle contre des metriques
 */
export class RuleEvaluator {
  /**
   * Evalue un ensemble de conditions contre des metriques
   */
  evaluate(
    conditions: RuleConditions,
    metrics: AggregatedMetrics,
  ): EvaluationResult {
    const conditionResults: ConditionResult[] = [];

    for (const condition of conditions.conditions) {
      const actualValue = this.getMetricValue(condition.metric, metrics);
      const matched = this.compareValues(actualValue, condition.operator, condition.value);

      conditionResults.push({
        condition,
        actualValue,
        matched,
      });
    }

    // Evaluer selon l'operateur logique
    let matched: boolean;
    if (conditions.operator === 'AND') {
      matched = conditionResults.every((r) => r.matched);
    } else {
      matched = conditionResults.some((r) => r.matched);
    }

    return {
      matched,
      conditionResults,
      metricsUsed: metrics,
      reason: this.buildReason(conditionResults, conditions.operator),
    };
  }

  /**
   * Verifie si les metriques ont suffisamment de donnees pour prendre une decision
   */
  hasMinimumDataForDecision(metrics: AggregatedMetrics): boolean {
    return (
      metrics.clicks >= GUARDS.MIN_CLICKS_FOR_DECISION ||
      metrics.spend >= GUARDS.MIN_SPEND_FOR_DECISION
    );
  }

  /**
   * Calcule les KPIs a partir des metriques brutes
   */
  static calculateKPIs(rawMetrics: {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    units: number;
  }): AggregatedMetrics {
    const { impressions, clicks, spend, sales, orders, units } = rawMetrics;

    return {
      impressions,
      clicks,
      spend,
      sales,
      orders,
      units,
      // CTR: Click-Through Rate (%)
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      // CPC: Cost Per Click
      cpc: clicks > 0 ? spend / clicks : 0,
      // ACOS: Advertising Cost of Sales (%)
      acos: sales > 0 ? (spend / sales) * 100 : (spend > 0 ? Infinity : 0),
      // ROAS: Return on Ad Spend
      roas: spend > 0 ? sales / spend : 0,
      // CVR: Conversion Rate (%)
      cvr: clicks > 0 ? (orders / clicks) * 100 : 0,
      // CPA: Cost Per Acquisition
      cpa: orders > 0 ? spend / orders : (spend > 0 ? Infinity : 0),
    };
  }

  /**
   * Recupere la valeur d'une metrique
   */
  private getMetricValue(metric: string, metrics: AggregatedMetrics): number {
    const normalizedMetric = metric.toLowerCase().replace(/[_-]/g, '');

    const metricMap: Record<string, keyof AggregatedMetrics> = {
      impressions: 'impressions',
      clicks: 'clicks',
      spend: 'spend',
      cost: 'spend',
      sales: 'sales',
      revenue: 'sales',
      orders: 'orders',
      conversions: 'orders',
      units: 'units',
      ctr: 'ctr',
      clickthroughrate: 'ctr',
      cpc: 'cpc',
      costperclick: 'cpc',
      acos: 'acos',
      advertisingcostofsales: 'acos',
      roas: 'roas',
      returnonadspend: 'roas',
      cvr: 'cvr',
      conversionrate: 'cvr',
      cpa: 'cpa',
      costperacquisition: 'cpa',
    };

    const key = metricMap[normalizedMetric];
    if (!key) {
      throw new Error(`Unknown metric: ${metric}`);
    }

    return metrics[key];
  }

  /**
   * Compare deux valeurs selon l'operateur
   */
  private compareValues(
    actual: number,
    operator: ComparisonOperator,
    expected: number,
  ): boolean {
    // Gerer le cas Infinity pour ACOS sans ventes
    if (!isFinite(actual)) {
      // Si actual est Infinity
      switch (operator) {
        case '>':
        case '>=':
          return expected !== Infinity;
        case '<':
        case '<=':
          return false;
        case '=':
          return expected === Infinity;
        case '!=':
          return expected !== Infinity;
      }
    }

    switch (operator) {
      case '>=':
        return actual >= expected;
      case '>':
        return actual > expected;
      case '<=':
        return actual <= expected;
      case '<':
        return actual < expected;
      case '=':
        return Math.abs(actual - expected) < 0.0001; // Tolerance pour float
      case '!=':
        return Math.abs(actual - expected) >= 0.0001;
      default:
        throw new Error(`Unknown operator: ${operator}`);
    }
  }

  /**
   * Construit une raison lisible pour le resultat
   */
  private buildReason(
    results: ConditionResult[],
    operator: 'AND' | 'OR',
  ): string {
    const parts = results.map((r) => {
      const status = r.matched ? 'OK' : 'FAIL';
      return `${r.condition.metric} ${r.condition.operator} ${r.condition.value} (actual: ${this.formatValue(r.actualValue)}) [${status}]`;
    });

    return `${operator}: ${parts.join(', ')}`;
  }

  /**
   * Formate une valeur pour l'affichage
   */
  private formatValue(value: number): string {
    if (!isFinite(value)) {
      return 'Infinity';
    }
    if (Number.isInteger(value)) {
      return value.toString();
    }
    return value.toFixed(2);
  }
}

/**
 * Instance singleton pour utilisation globale
 */
export const ruleEvaluator = new RuleEvaluator();
