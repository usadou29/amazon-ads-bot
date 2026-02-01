// ============================================
// UTILITAIRES ENTITY_KEY (POLYMORPHE)
// ============================================

import * as crypto from 'crypto';

export type EntityType = 'campaign' | 'ad_group' | 'keyword' | 'target' | 'search_term';

/**
 * Crée une entity_key standard
 * Format: {entity_type}:{amazon_id}
 * Exemple: campaign:123456789
 */
export function makeEntityKey(entityType: EntityType, amazonId: number | string): string {
  return `${entityType}:${amazonId}`;
}

/**
 * Crée une entity_key pour search_term (contextuel)
 * Format: search_term:{amazon_ad_group_id}:{query_hash}
 * IMPORTANT: Évite les collisions entre ad_groups
 */
export function makeSearchTermEntityKey(amazonAdGroupId: number | string, queryHash: string): string {
  return `search_term:${amazonAdGroupId}:${queryHash}`;
}

/**
 * Extrait l'entity_type d'une entity_key
 */
export function extractEntityType(entityKey: string): EntityType | null {
  const parts = entityKey.split(':');
  if (parts.length < 2) return null;
  return parts[0] as EntityType;
}

/**
 * Extrait l'amazon_id d'une entity_key standard
 * Ne fonctionne PAS pour les search_terms
 */
export function extractAmazonId(entityKey: string): number | null {
  const parts = entityKey.split(':');
  if (parts.length < 2) return null;
  const id = parseInt(parts[1], 10);
  return isNaN(id) ? null : id;
}

/**
 * Extrait les composants d'une entity_key search_term
 */
export function extractSearchTermComponents(entityKey: string): {
  amazonAdGroupId: number;
  queryHash: string;
} | null {
  const parts = entityKey.split(':');
  if (parts.length !== 3 || parts[0] !== 'search_term') return null;

  const amazonAdGroupId = parseInt(parts[1], 10);
  if (isNaN(amazonAdGroupId)) return null;

  return {
    amazonAdGroupId,
    queryHash: parts[2],
  };
}

/**
 * Normalise une query search_term
 * - Lowercase
 * - Trim
 */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim();
}

/**
 * Calcule le hash MD5 d'une query normalisée
 */
export function hashQuery(query: string): string {
  const normalized = normalizeQuery(query);
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Vérifie si une entity_key est valide
 */
export function isValidEntityKey(entityKey: string): boolean {
  const entityType = extractEntityType(entityKey);
  if (!entityType) return false;

  if (entityType === 'search_term') {
    return extractSearchTermComponents(entityKey) !== null;
  }

  return extractAmazonId(entityKey) !== null;
}
