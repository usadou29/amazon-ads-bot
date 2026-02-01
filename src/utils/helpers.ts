// ============================================
// HELPERS UTILITAIRES
// ============================================

import * as crypto from 'crypto';

/**
 * Chiffre une chaîne avec AES-256-GCM
 */
export function encrypt(text: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Déchiffre une chaîne chiffrée avec AES-256-GCM
 */
export function decrypt(encryptedText: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Calcule l'ACOS (Advertising Cost of Sale)
 */
export function calculateAcos(spend: number, sales: number): number | null {
  if (sales <= 0) return null;
  return (spend / sales) * 100;
}

/**
 * Calcule le ROAS (Return on Ad Spend)
 */
export function calculateRoas(sales: number, spend: number): number | null {
  if (spend <= 0) return null;
  return sales / spend;
}

/**
 * Calcule le CTR (Click Through Rate)
 */
export function calculateCtr(clicks: number, impressions: number): number | null {
  if (impressions <= 0) return null;
  return (clicks / impressions) * 100;
}

/**
 * Calcule le CVR (Conversion Rate)
 */
export function calculateCvr(orders: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return (orders / clicks) * 100;
}

/**
 * Calcule le CPC (Cost Per Click)
 */
export function calculateCpc(spend: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return spend / clicks;
}

/**
 * Formate une date pour l'API Amazon (YYYY-MM-DD)
 */
export function formatDateForAmazon(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Parse une date au format Amazon (YYYY-MM-DD)
 */
export function parseDateFromAmazon(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00Z');
}

/**
 * Retourne la date d'il y a N jours
 */
export function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Sleep async
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry avec backoff exponentiel
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  } = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts) break;

      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Batch processing avec concurrence limitée
 */
export async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 5,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Arrondi à N décimales
 */
export function round(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
