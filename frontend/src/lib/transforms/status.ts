import { StatusType } from '@/lib/theme/tokens';

export interface StatusResult {
  type: StatusType;
  label: string;
  emoji: string;
  description: string;
}

// ── Statut simplifié pour auteurs ──────────────────────────
// Langage: Rentable / Fragile / Perd de l'argent
// Pas de jargon Amazon Ads

interface StatusInput {
  acosTarget?: number;
  acos?: number | null;
  roas?: number | null;
  impressions?: number;
  spend?: number;
  sales?: number;
}

/**
 * Calcule le profit pub = ventes - dépenses
 * et retourne un statut orienté auteur
 */
export function computeStatus(input: StatusInput): StatusResult {
  const { acosTarget = 40, acos, roas, impressions = 0, spend = 0, sales = 0 } = input;

  // Pas assez de données
  if (impressions < 100 || (acos === null && sales === 0 && spend === 0)) {
    return {
      type: 'warning',
      label: 'Pas encore de données',
      emoji: '📊',
      description: 'Les pubs n\'ont pas encore assez tourné pour te donner un bilan.',
    };
  }

  const profit = sales - spend;

  // Perd de l'argent : profit négatif OU ACOS très élevé
  if (profit < 0 || (acos !== null && acos !== undefined && acos > acosTarget * 1.5)) {
    return {
      type: 'danger',
      label: 'Perd de l\'argent',
      emoji: '🔴',
      description: profit < 0
        ? `Tu perds ${Math.abs(profit).toFixed(0)}€ avec la pub ce mois-ci.`
        : `Tes pubs coûtent trop cher par rapport aux ventes.`,
    };
  }

  // Fragile : petit profit OU ACOS au-dessus de la cible
  if (profit < spend * 0.3 || (acos !== null && acos !== undefined && acos > acosTarget * 1.2)) {
    return {
      type: 'warning',
      label: 'Fragile',
      emoji: '🟠',
      description: profit > 0
        ? `Tu gagnes ${profit.toFixed(0)}€, mais c'est serré. On peut améliorer ça.`
        : `La pub est à l'équilibre. Il y a de la marge pour mieux.`,
    };
  }

  // Rentable
  return {
    type: 'success',
    label: 'Rentable',
    emoji: '🟢',
    description: `Tu gagnes ${profit.toFixed(0)}€ avec la pub ce mois-ci.`,
  };
}

export function computeAuthorStatus(bookStatuses: StatusType[]): StatusResult {
  if (bookStatuses.length === 0) {
    return { type: 'warning', label: 'Aucun livre', emoji: '📊', description: 'Ajoute un livre pour commencer.' };
  }
  if (bookStatuses.includes('danger')) {
    return { type: 'danger', label: 'Attention', emoji: '🔴', description: 'Un ou plusieurs livres perdent de l\'argent.' };
  }
  if (bookStatuses.includes('warning')) {
    return { type: 'warning', label: 'À surveiller', emoji: '🟠', description: 'Certains livres pourraient faire mieux.' };
  }
  return { type: 'success', label: 'Tout va bien', emoji: '🟢', description: 'Tous tes livres sont rentables.' };
}
