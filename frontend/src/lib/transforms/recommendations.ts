export interface HumanRecommendation {
  id: string;
  title: string;
  why: string;
  impact: string;
  risk: string;
  riskLevel: 'low' | 'medium' | 'high';
  canSimulate: boolean;
  canApply: boolean;
}

const RULE_TEMPLATES: Record<string, { title: string; why: string; impact: string; risk: string; riskLevel: 'low' | 'medium' | 'high' }> = {
  pause_high_acos: { title: 'Mettre en pause un mot-clé coûteux', why: 'Ce mot-clé dépense beaucoup sans générer assez de ventes.', impact: 'Réduction immédiate des dépenses inutiles.', risk: 'Légère perte de visibilité sur ce terme.', riskLevel: 'low' },
  bid_down_no_sales: { title: 'Baisser l\'enchère', why: 'L\'enchère actuelle est trop élevée par rapport aux résultats.', impact: 'Meilleur ratio dépense-ventes.', risk: 'Possible baisse de position dans les résultats.', riskLevel: 'low' },
  bid_up_high_performer: { title: 'Augmenter l\'enchère', why: 'Ce mot-clé convertit bien, il mérite plus de visibilité.', impact: 'Plus de ventes potentielles.', risk: 'Augmentation modérée des dépenses.', riskLevel: 'medium' },
  negative_unprofitable_search_term: { title: 'Bloquer un terme de recherche', why: 'Ce terme génère des clics mais aucune vente.', impact: 'Arrêt des dépenses inutiles.', risk: 'Aucun — ce terme ne convertit pas.', riskLevel: 'low' },
  harvest_profitable_search_term: { title: 'Créer un nouveau mot-clé', why: 'Ce terme de recherche génère des ventes régulières.', impact: 'Meilleur contrôle des enchères.', risk: 'Léger doublon temporaire.', riskLevel: 'low' },
};

const DEFAULT_TEMPLATE = { title: 'Optimisation suggérée', why: 'L\'analyse automatique a détecté une opportunité.', impact: 'Amélioration potentielle des performances.', risk: 'Risque modéré.', riskLevel: 'medium' as const };

export function transformRecommendation(raw: any, safetyMode: boolean): HumanRecommendation {
  const ruleId = raw.ruleSnapshot?.name || raw.actionType || '';
  const tmpl = Object.entries(RULE_TEMPLATES).find(([k]) => ruleId.toLowerCase().includes(k))?.[1] || DEFAULT_TEMPLATE;
  return { id: raw.id, ...tmpl, canSimulate: true, canApply: !safetyMode };
}
