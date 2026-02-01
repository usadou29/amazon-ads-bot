import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Pool de connexions PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Instance Drizzle
export const db = drizzle(pool, { schema });

// Export du pool pour des opérations directes si nécessaire
export { pool };

// Type helper pour la base de données
export type Database = typeof db;
