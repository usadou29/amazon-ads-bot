// ============================================
// CONFIGURATION AMAZON ADS API
// ============================================

export const AMAZON_CONFIG = {
  // URLs OAuth
  AUTH_URL: 'https://www.amazon.com/ap/oa',
  TOKEN_URL: 'https://api.amazon.com/auth/o2/token',

  // URLs API par région
  API_ENDPOINTS: {
    EU: 'https://advertising-api-eu.amazon.com',
    NA: 'https://advertising-api.amazon.com',
    FE: 'https://advertising-api-fe.amazon.com',
  },

  // Mapping marketplace -> région
  MARKETPLACE_REGIONS: {
    FR: 'EU',
    DE: 'EU',
    ES: 'EU',
    IT: 'EU',
    UK: 'EU',
    US: 'NA',
    CA: 'NA',
    AU: 'FE',
  } as const,

  // Marketplace IDs Amazon
  MARKETPLACE_IDS: {
    FR: 'A13V1IB3VIYBER',
    DE: 'A1PA6795UKMFR9',
    ES: 'A1RKKUPIHCS9HS',
    IT: 'APJ6JRA9NG5V4',
    UK: 'A1F83G8C2ARO7P',
    US: 'ATVPDKIKX0DER',
    CA: 'A2EUQ1WTGCTBG2',
    AU: 'A39IBJ37TRP1C6',
  } as const,

  // Scopes OAuth requis
  OAUTH_SCOPES: [
    'advertising::campaign_management',
    'profile',
  ],

  // API Version headers
  API_VERSION: {
    CAMPAIGNS: 'application/vnd.spCampaign.v3+json',
    AD_GROUPS: 'application/vnd.spAdGroup.v3+json',
    KEYWORDS: 'application/vnd.spKeyword.v3+json',
    TARGETS: 'application/vnd.spTargetingClause.v3+json',
    REPORTS: 'application/vnd.createasyncreportrequest.v3+json',
  },

  // Rate limiting (requests per second)
  RATE_LIMITS: {
    DEFAULT: 10,
    REPORTS: 1,
    BULK_OPERATIONS: 5,
  },

  // Retry configuration
  RETRY: {
    MAX_ATTEMPTS: 3,
    INITIAL_DELAY_MS: 1000,
    MAX_DELAY_MS: 10000,
    BACKOFF_MULTIPLIER: 2,
  },
} as const;

export type Marketplace = keyof typeof AMAZON_CONFIG.MARKETPLACE_IDS;
export type Region = keyof typeof AMAZON_CONFIG.API_ENDPOINTS;

/**
 * Obtient l'URL de base API pour un marketplace
 */
export function getApiBaseUrl(marketplace: Marketplace): string {
  const region = AMAZON_CONFIG.MARKETPLACE_REGIONS[marketplace];
  return AMAZON_CONFIG.API_ENDPOINTS[region];
}

/**
 * Obtient le marketplace ID Amazon
 */
export function getMarketplaceId(marketplace: Marketplace): string {
  return AMAZON_CONFIG.MARKETPLACE_IDS[marketplace];
}
