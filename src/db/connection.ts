import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { getPoolOptions } from '@/config/database';

// Pool de connexions PostgreSQL (SSL CA Supabase si DATABASE_SSL_CA_PATH défini)
const pool = new Pool(getPoolOptions());

// Instance Drizzle
export const db = drizzle(pool, { schema });

// Export du pool pour des opérations directes si nécessaire
export { pool };

// Type helper pour la base de données
export type Database = typeof db;

/**
 * Vérifie la connexion à la base (Supabase/Postgres).
 * Exécute SELECT 1. À appeler au démarrage et/ou exposé via GET /api/health/db.
 */
export async function assertDbConnection(): Promise<void> {
  const result = await pool.query('SELECT 1 as check');
  if (!result?.rows?.[0]) {
    throw new Error('DB connectivity check failed: no result');
  }
}
