import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { books } from '@/db/schema/books';
import { dailyMetrics } from '@/db/schema/daily-metrics';
import { campaignBookMapping } from '@/db/schema/campaign-book-mapping';
import { eq, sql, and, gte, desc } from 'drizzle-orm';
import type { LifecyclePhase, LifecycleSource } from '@/db/schema/books';
import { GUARDS } from '@/config/guards';

// ── Types ──────────────────────────────────────────────

export interface LifecycleComputeResult {
  phase: LifecyclePhase;
  source: LifecycleSource;
  changed: boolean;
  previousPhase: LifecyclePhase | null;
  explanation: string[];
  evidence: LifecycleEvidence;
}

export interface LifecycleEvidence {
  daysSincePublish: number;
  ordersTotalAllTime: number;
  ordersTotal30d: number;
  clicksTotalAllTime: number;
  ordersWeek1: number;
  ordersWeek2: number;
  acosVariance3x30?: number;
  currentPhase: LifecyclePhase | null;
  pendingPhase: LifecyclePhase | null;
  pendingSinceDays: number | null;
  daysInCurrentPhase: number | null;
}

export interface LifecycleInfoDTO {
  phase: LifecyclePhase;
  source: LifecycleSource;
  label: string;
  emoji: string;
  explanation: string[];
  color: string;
  evidence: LifecycleEvidence;
  changedAt: string | null;
  previousPhase: LifecyclePhase | null;
}

// ── Constants ──────────────────────────────────────────

const HYSTERESIS_HOURS = 48;
const MIN_DAYS_IN_PHASE = 7;
const ORDERS_THRESHOLD_LAUNCH_TO_SCALE = 10;
const CLICKS_THRESHOLD_INSUFFICIENT = 30;
const ACOS_VARIANCE_THRESHOLD_EVERGREEN = 0.15; // 15%

const PHASE_INFO_MAP: Record<LifecyclePhase, { label: string; emoji: string; color: string }> = {
  launch: { label: 'Lancement', emoji: '🚀', color: 'blue' },
  scale: { label: 'Croissance', emoji: '📈', color: 'amber' },
  evergreen: { label: 'Régime de croisière', emoji: '🌿', color: 'emerald' },
  relaunch: { label: 'Relance', emoji: '🔄', color: 'purple' },
};

// ── Service ────────────────────────────────────────────

@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
  ) {}

  // ── Public Methods ─────────────────────────────────

  /**
   * Compute lifecycle phase for a single book.
   * Applies hysteresis: a phase change requires 2 consecutive checks (48h apart).
   * Respects manual overrides (source='manual' blocks auto-computation).
   */
  async computePhase(bookId: string): Promise<LifecycleComputeResult> {
    const book = await this.getBook(bookId);
    if (!book) throw new NotFoundException(`Book ${bookId} not found`);

    // Manual override blocks auto-computation
    if (book.lifecycleSource === 'manual') {
      const phase = (book.lifecyclePhase || 'launch') as LifecyclePhase;
      return {
        phase,
        source: 'manual',
        changed: false,
        previousPhase: book.lifecyclePreviousPhase as LifecyclePhase | null,
        explanation: ['Phase définie manuellement. Le calcul automatique est désactivé.'],
        evidence: await this.gatherEvidence(book),
      };
    }

    const evidence = await this.gatherEvidence(book);
    const candidatePhase = this.determinePhase(evidence);
    const currentPhase = (book.lifecyclePhase || this.fallbackPhase(evidence)) as LifecyclePhase;

    // Same phase → clear pending, no change
    if (candidatePhase === currentPhase) {
      if (book.lifecyclePendingPhase) {
        await this.clearPending(bookId);
      }
      return {
        phase: currentPhase,
        source: 'auto',
        changed: false,
        previousPhase: book.lifecyclePreviousPhase as LifecyclePhase | null,
        explanation: this.buildExplanation(currentPhase, evidence),
        evidence,
      };
    }

    // Different phase → check hysteresis
    const daysInCurrentPhase = evidence.daysInCurrentPhase ?? 0;
    if (daysInCurrentPhase < MIN_DAYS_IN_PHASE) {
      // Too soon to change — cooldown
      this.logger.log(
        `[Lifecycle] Book ${bookId}: candidate=${candidatePhase} but only ${daysInCurrentPhase}d in current phase (min ${MIN_DAYS_IN_PHASE}d)`,
      );
      return {
        phase: currentPhase,
        source: 'auto',
        changed: false,
        previousPhase: book.lifecyclePreviousPhase as LifecyclePhase | null,
        explanation: [
          ...this.buildExplanation(currentPhase, evidence),
          `Transition vers ${PHASE_INFO_MAP[candidatePhase].label} en attente (cooldown phase : ${daysInCurrentPhase}/${MIN_DAYS_IN_PHASE} jours).`,
        ],
        evidence,
      };
    }

    // Check if pending phase matches candidate
    if (book.lifecyclePendingPhase === candidatePhase && book.lifecyclePendingSince) {
      const pendingHours = (Date.now() - new Date(book.lifecyclePendingSince).getTime()) / (1000 * 60 * 60);
      if (pendingHours >= HYSTERESIS_HOURS) {
        // Hysteresis satisfied → apply change
        await this.applyPhaseChange(bookId, candidatePhase, currentPhase);
        this.logger.log(
          `[Lifecycle] Book ${bookId}: ${currentPhase} → ${candidatePhase} (hysteresis satisfied after ${Math.round(pendingHours)}h)`,
        );
        return {
          phase: candidatePhase,
          source: 'auto',
          changed: true,
          previousPhase: currentPhase,
          explanation: [
            `Phase passée de ${PHASE_INFO_MAP[currentPhase].label} à ${PHASE_INFO_MAP[candidatePhase].label}.`,
            ...this.buildExplanation(candidatePhase, evidence),
          ],
          evidence,
        };
      }
    }

    // Set or update pending
    if (book.lifecyclePendingPhase !== candidatePhase) {
      await this.setPending(bookId, candidatePhase);
      this.logger.log(
        `[Lifecycle] Book ${bookId}: pending phase set to ${candidatePhase} (current: ${currentPhase})`,
      );
    }

    return {
      phase: currentPhase,
      source: 'auto',
      changed: false,
      previousPhase: book.lifecyclePreviousPhase as LifecyclePhase | null,
      explanation: [
        ...this.buildExplanation(currentPhase, evidence),
        `Transition vers ${PHASE_INFO_MAP[candidatePhase].label} en cours de validation (hysteresis 48h).`,
      ],
      evidence,
    };
  }

  /**
   * Override lifecycle phase manually.
   */
  async overridePhase(bookId: string, phase: LifecyclePhase, reason?: string): Promise<void> {
    const book = await this.getBook(bookId);
    if (!book) throw new NotFoundException(`Book ${bookId} not found`);

    const currentPhase = book.lifecyclePhase as LifecyclePhase | null;

    await this.db.update(books).set({
      lifecyclePhase: phase,
      lifecycleSource: 'manual',
      lifecycleChangedAt: new Date(),
      lifecyclePreviousPhase: currentPhase,
      lifecyclePendingPhase: null,
      lifecyclePendingSince: null,
      updatedAt: new Date(),
    }).where(eq(books.id, bookId));

    this.logger.log(`[Lifecycle] Book ${bookId}: manual override to ${phase} (reason: ${reason || 'none'})`);
  }

  /**
   * Reset to auto mode (removes manual override).
   */
  async resetToAuto(bookId: string): Promise<LifecycleComputeResult> {
    const book = await this.getBook(bookId);
    if (!book) throw new NotFoundException(`Book ${bookId} not found`);

    await this.db.update(books).set({
      lifecycleSource: 'auto',
      lifecyclePendingPhase: null,
      lifecyclePendingSince: null,
      updatedAt: new Date(),
    }).where(eq(books.id, bookId));

    return this.computePhase(bookId);
  }

  /**
   * Get lifecycle info for display.
   */
  async getPhaseInfo(bookId: string): Promise<LifecycleInfoDTO> {
    const book = await this.getBook(bookId);
    if (!book) throw new NotFoundException(`Book ${bookId} not found`);

    const evidence = await this.gatherEvidence(book);
    const phase = (book.lifecyclePhase || this.fallbackPhase(evidence)) as LifecyclePhase;
    const source = (book.lifecycleSource || 'auto') as LifecycleSource;
    const info = PHASE_INFO_MAP[phase];

    return {
      phase,
      source,
      label: info.label,
      emoji: info.emoji,
      explanation: this.buildExplanation(phase, evidence),
      color: info.color,
      evidence,
      changedAt: book.lifecycleChangedAt ? new Date(book.lifecycleChangedAt).toISOString() : null,
      previousPhase: book.lifecyclePreviousPhase as LifecyclePhase | null,
    };
  }

  /**
   * Compute lifecycle for all books (cron job).
   */
  async computeAllBooks(): Promise<{ processed: number; changed: number; errors: number }> {
    const allBooks = await this.db
      .select({ id: books.id })
      .from(books)
      .where(sql`${books.lifecycleSource} IS NULL OR ${books.lifecycleSource} = 'auto'`);

    let processed = 0;
    let changed = 0;
    let errors = 0;

    for (const book of allBooks) {
      try {
        const result = await this.computePhase(book.id);
        processed++;
        if (result.changed) changed++;
      } catch (err) {
        errors++;
        this.logger.error(`[Lifecycle] Failed to compute phase for book ${book.id}: ${err}`);
      }
    }

    this.logger.log(`[Lifecycle] Batch compute: ${processed} processed, ${changed} changed, ${errors} errors`);
    return { processed, changed, errors };
  }

  // ── Private: Phase Determination ───────────────────

  /**
   * Determine lifecycle phase from evidence (pure function).
   */
  private determinePhase(evidence: LifecycleEvidence): LifecyclePhase {
    const { daysSincePublish, ordersTotalAllTime, ordersTotal30d, clicksTotalAllTime, ordersWeek1, ordersWeek2 } = evidence;

    // LAUNCH: early days, insufficient data, or very few orders
    if (daysSincePublish < 30) return 'launch';
    if (clicksTotalAllTime < CLICKS_THRESHOLD_INSUFFICIENT) return 'launch';
    if (ordersTotal30d < ORDERS_THRESHOLD_LAUNCH_TO_SCALE) return 'launch';

    // EVERGREEN: mature book with stable performance
    if (daysSincePublish > 180) {
      // Check for stability via ACoS variance
      if (evidence.acosVariance3x30 !== undefined && evidence.acosVariance3x30 < ACOS_VARIANCE_THRESHOLD_EVERGREEN) {
        return 'evergreen';
      }
      // Even without variance data, > 180 days with decent orders → evergreen
      if (ordersTotal30d >= ORDERS_THRESHOLD_LAUNCH_TO_SCALE) {
        return 'evergreen';
      }
    }

    // SCALE: growth phase (30-180 days with sufficient data)
    if (daysSincePublish >= 30 && daysSincePublish <= 180) {
      if (ordersTotal30d >= ORDERS_THRESHOLD_LAUNCH_TO_SCALE && ordersWeek1 > 0 && ordersWeek2 > 0) {
        return 'scale';
      }
      // Not enough consecutive orders → stay in launch
      return 'launch';
    }

    // Default fallback
    return 'launch';
  }

  /**
   * Fallback phase when no lifecycle_phase is stored yet.
   */
  private fallbackPhase(evidence: LifecycleEvidence): LifecyclePhase {
    return this.determinePhase(evidence);
  }

  // ── Private: Evidence Gathering ────────────────────

  /**
   * Gather all metrics needed for lifecycle determination.
   */
  private async gatherEvidence(book: any): Promise<LifecycleEvidence> {
    const daysSincePublish = this.daysSincePublication(book.publicationDate);

    // Get campaign IDs for this book
    const mappings = await this.db
      .select({ campaignId: campaignBookMapping.campaignId })
      .from(campaignBookMapping)
      .where(eq(campaignBookMapping.bookId, book.id));

    const campaignIds = mappings.map((m: any) => m.campaignId);

    if (campaignIds.length === 0) {
      return {
        daysSincePublish,
        ordersTotalAllTime: 0,
        ordersTotal30d: 0,
        clicksTotalAllTime: 0,
        ordersWeek1: 0,
        ordersWeek2: 0,
        currentPhase: book.lifecyclePhase,
        pendingPhase: book.lifecyclePendingPhase,
        pendingSinceDays: book.lifecyclePendingSince
          ? Math.floor((Date.now() - new Date(book.lifecyclePendingSince).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        daysInCurrentPhase: book.lifecycleChangedAt
          ? Math.floor((Date.now() - new Date(book.lifecycleChangedAt).getTime()) / (1000 * 60 * 60 * 24))
          : null,
      };
    }

    // Build entity keys for campaign-level metrics
    const entityKeys = campaignIds.map((id: string) => `campaign:${id}`);

    // All-time orders and clicks
    const allTimeResult = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(clicks), 0) as total_clicks
      FROM ${dailyMetrics}
      WHERE entity_key = ANY(${entityKeys})
        AND entity_type = 'campaign'
    `);
    const allTime = allTimeResult.rows?.[0] || allTimeResult[0] || {};

    // 30-day orders
    const thirtyDayResult = await this.db.execute(sql`
      SELECT COALESCE(SUM(orders), 0) as orders_30d
      FROM ${dailyMetrics}
      WHERE entity_key = ANY(${entityKeys})
        AND entity_type = 'campaign'
        AND date >= CURRENT_DATE - INTERVAL '30 days'
    `);
    const thirtyDay = thirtyDayResult.rows?.[0] || thirtyDayResult[0] || {};

    // Week 1 orders (last 7 days) and Week 2 orders (8-14 days ago)
    const weeklyResult = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '7 days' THEN orders ELSE 0 END), 0) as orders_w1,
        COALESCE(SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '14 days' AND date < CURRENT_DATE - INTERVAL '7 days' THEN orders ELSE 0 END), 0) as orders_w2
      FROM ${dailyMetrics}
      WHERE entity_key = ANY(${entityKeys})
        AND entity_type = 'campaign'
        AND date >= CURRENT_DATE - INTERVAL '14 days'
    `);
    const weekly = weeklyResult.rows?.[0] || weeklyResult[0] || {};

    // ACoS variance across 3x30-day windows (for evergreen detection)
    let acosVariance3x30: number | undefined;
    if (daysSincePublish > 90) {
      const varianceResult = await this.db.execute(sql`
        WITH windows AS (
          SELECT
            CASE
              WHEN date >= CURRENT_DATE - INTERVAL '30 days' THEN 'w1'
              WHEN date >= CURRENT_DATE - INTERVAL '60 days' THEN 'w2'
              ELSE 'w3'
            END as window,
            SUM(spend) as spend,
            SUM(sales) as sales
          FROM ${dailyMetrics}
          WHERE entity_key = ANY(${entityKeys})
            AND entity_type = 'campaign'
            AND date >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY 1
        ),
        acos_by_window AS (
          SELECT
            window,
            CASE WHEN sales > 0 THEN (spend / sales) ELSE NULL END as acos
          FROM windows
          WHERE spend > 0
        )
        SELECT
          CASE
            WHEN COUNT(*) >= 2 THEN STDDEV(acos) / NULLIF(AVG(acos), 0)
            ELSE NULL
          END as cv
        FROM acos_by_window
        WHERE acos IS NOT NULL
      `);
      const variance = varianceResult.rows?.[0] || varianceResult[0] || {};
      acosVariance3x30 = variance.cv !== null && variance.cv !== undefined ? Number(variance.cv) : undefined;
    }

    return {
      daysSincePublish,
      ordersTotalAllTime: Number(allTime.total_orders || 0),
      ordersTotal30d: Number(thirtyDay.orders_30d || 0),
      clicksTotalAllTime: Number(allTime.total_clicks || 0),
      ordersWeek1: Number(weekly.orders_w1 || 0),
      ordersWeek2: Number(weekly.orders_w2 || 0),
      acosVariance3x30,
      currentPhase: book.lifecyclePhase,
      pendingPhase: book.lifecyclePendingPhase,
      pendingSinceDays: book.lifecyclePendingSince
        ? Math.floor((Date.now() - new Date(book.lifecyclePendingSince).getTime()) / (1000 * 60 * 60 * 24))
        : null,
      daysInCurrentPhase: book.lifecycleChangedAt
        ? Math.floor((Date.now() - new Date(book.lifecycleChangedAt).getTime()) / (1000 * 60 * 60 * 24))
        : null,
    };
  }

  // ── Private: DB Operations ─────────────────────────

  private async getBook(bookId: string) {
    const result = await this.db.select().from(books).where(eq(books.id, bookId)).limit(1);
    return result[0] || null;
  }

  private async applyPhaseChange(bookId: string, newPhase: LifecyclePhase, previousPhase: LifecyclePhase): Promise<void> {
    await this.db.update(books).set({
      lifecyclePhase: newPhase,
      lifecycleSource: 'auto',
      lifecycleChangedAt: new Date(),
      lifecyclePreviousPhase: previousPhase,
      lifecyclePendingPhase: null,
      lifecyclePendingSince: null,
      updatedAt: new Date(),
    }).where(eq(books.id, bookId));
  }

  private async setPending(bookId: string, pendingPhase: LifecyclePhase): Promise<void> {
    await this.db.update(books).set({
      lifecyclePendingPhase: pendingPhase,
      lifecyclePendingSince: new Date(),
      updatedAt: new Date(),
    }).where(eq(books.id, bookId));
  }

  private async clearPending(bookId: string): Promise<void> {
    await this.db.update(books).set({
      lifecyclePendingPhase: null,
      lifecyclePendingSince: null,
      updatedAt: new Date(),
    }).where(eq(books.id, bookId));
  }

  // ── Private: Helpers ───────────────────────────────

  private daysSincePublication(publicationDate: string | null): number {
    if (!publicationDate) return Infinity;
    const pubDate = new Date(publicationDate);
    if (isNaN(pubDate.getTime())) return Infinity;
    return Math.floor((Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24));
  }

  private buildExplanation(phase: LifecyclePhase, evidence: LifecycleEvidence): string[] {
    const bullets: string[] = [];
    const daysText = evidence.daysSincePublish !== Infinity
      ? `${evidence.daysSincePublish} jour${evidence.daysSincePublish > 1 ? 's' : ''} depuis la publication`
      : 'Date de publication inconnue';

    switch (phase) {
      case 'launch':
        bullets.push(daysText);
        if (evidence.clicksTotalAllTime < CLICKS_THRESHOLD_INSUFFICIENT) {
          bullets.push(`Données insuffisantes (${evidence.clicksTotalAllTime} clics au total, minimum ${CLICKS_THRESHOLD_INSUFFICIENT}).`);
        }
        if (evidence.ordersTotal30d < ORDERS_THRESHOLD_LAUNCH_TO_SCALE) {
          bullets.push(`${evidence.ordersTotal30d} commande${evidence.ordersTotal30d > 1 ? 's' : ''} sur 30 jours (minimum ${ORDERS_THRESHOLD_LAUNCH_TO_SCALE} pour passer en Croissance).`);
        }
        bullets.push('On explore les mots-clés et on collecte des données. Tolérance haute sur l\'ACoS.');
        break;

      case 'scale':
        bullets.push(daysText);
        bullets.push(`${evidence.ordersTotal30d} commandes sur 30 jours — assez pour optimiser.`);
        if (evidence.ordersWeek1 > 0 && evidence.ordersWeek2 > 0) {
          bullets.push('Ventes régulières sur les 2 dernières semaines.');
        }
        bullets.push('On nettoie les perdants, on pousse les gagnants.');
        break;

      case 'evergreen':
        bullets.push(daysText);
        if (evidence.acosVariance3x30 !== undefined) {
          bullets.push(`Stabilité de l'ACoS : variation de ${(evidence.acosVariance3x30 * 100).toFixed(1)}% (seuil : ${ACOS_VARIANCE_THRESHOLD_EVERGREEN * 100}%).`);
        }
        bullets.push('Livre bien installé. On maintient la rentabilité et on surveille la concentration.');
        break;

      case 'relaunch':
        bullets.push('Mode relance activé manuellement.');
        bullets.push('On traite ce livre comme un nouveau lancement : exploration large, tolérance haute.');
        break;
    }

    return bullets;
  }
}
