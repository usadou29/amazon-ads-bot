// ============================================
// CONFIGURATION DATABASE
// ============================================

import * as fs from 'fs';
import * as path from 'path';

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

/**
 * Options pour le Pool pg (Supabase).
 * Si DATABASE_SSL_CA_PATH est défini, charge le CA et active TLS avec rejectUnauthorized: true.
 */
export function getPoolOptions(): {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  ssl?: { ca: string; rejectUnauthorized: true };
} {
  const opts: {
    connectionString: string;
    max: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
    ssl?: { ca: string; rejectUnauthorized: true };
  } = {
    connectionString: process.env.DATABASE_URL!,
    max: DATABASE_CONFIG.pool.max,
    idleTimeoutMillis: DATABASE_CONFIG.pool.idleTimeoutMillis,
    connectionTimeoutMillis: DATABASE_CONFIG.pool.connectionTimeoutMillis,
  };

  const sslCaPath = process.env.DATABASE_SSL_CA_PATH;
  if (sslCaPath) {
    const resolvedPath = path.resolve(process.cwd(), sslCaPath);
    const ca = fs.readFileSync(resolvedPath, 'utf8');
    opts.ssl = {
      ca,
      rejectUnauthorized: true,
    };

    if (process.env.LOG_SSL_DEBUG === 'true') {
      console.log('[SSL debug] DATABASE_SSL_CA_PATH:', sslCaPath);
      console.log('[SSL debug] resolvedPath:', resolvedPath);
      console.log('[SSL debug] existsSync(resolvedPath):', fs.existsSync(resolvedPath));
      console.log('[SSL debug] caLength:', ca.length);
      console.log('[SSL debug] ssl.rejectUnauthorized:', opts.ssl.rejectUnauthorized);
    }
  }

  return opts;
}
