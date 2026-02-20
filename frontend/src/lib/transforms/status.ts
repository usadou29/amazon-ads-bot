import { StatusType } from '@/lib/theme/tokens';

export interface StatusResult {
  type: StatusType;
  label: string;
  emoji: string;
  description: string;
}

interface StatusInput {
  acosTarget?: number;
  acos?: number | null;
  roas?: number | null;
  impressions?: number;
}

export function computeStatus(input: StatusInput): StatusResult {
  const { acosTarget = 40, acos, roas, impressions = 0 } = input;
  if (impressions < 500 || acos === null || acos === undefined)
    return { type: 'warning', label: 'Données insuffisantes', emoji: '📊', description: 'Pas assez de données pour évaluer.' };
  if (acos > acosTarget * 1.5 || (roas !== null && roas !== undefined && roas < 1))
    return { type: 'danger', label: 'Attention requise', emoji: '🛑', description: `ACOS ${acos.toFixed(1)}% dépasse largement la cible de ${acosTarget}%.` };
  if (acos > acosTarget * 1.2 || (roas !== null && roas !== undefined && roas < 2))
    return { type: 'warning', label: 'À optimiser', emoji: '⚠️', description: `ACOS ${acos.toFixed(1)}% au-dessus de la cible de ${acosTarget}%.` };
  return { type: 'success', label: 'Sous contrôle', emoji: '✅', description: `ACOS ${acos.toFixed(1)}% — dans la cible.` };
}

export function computeAuthorStatus(bookStatuses: StatusType[]): StatusResult {
  if (bookStatuses.length === 0) return { type: 'warning', label: 'Aucun livre', emoji: '📊', description: '' };
  if (bookStatuses.includes('danger')) return { type: 'warning', label: 'À surveiller', emoji: '⚠️', description: 'Un ou plusieurs livres nécessitent votre attention.' };
  if (bookStatuses.includes('warning')) return { type: 'warning', label: 'À optimiser', emoji: '⚠️', description: 'Des optimisations sont possibles.' };
  return { type: 'success', label: 'Sous contrôle', emoji: '✅', description: 'Tous les livres sont dans la cible.' };
}
