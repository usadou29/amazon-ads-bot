// ============================================
// CONFIGURATION DATABASE
// ============================================

export const DATABASE_CONFIG = {
  // Pool configuration
  pool: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },

  // Retry configuration
  retry: {
    maxAttempts: 3,
    initialDelayMs: 500,
    maxDelayMs: 5000,
  },

  // Query timeouts
  timeouts: {
    default: 30000, // 30 seconds
    long: 120000, // 2 minutes for reports
    short: 5000, // 5 seconds for simple queries
  },
} as const;
