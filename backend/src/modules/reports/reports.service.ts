import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { AmazonClientService } from '@/modules/amazon-client';
import {
  reportJobs,
  dailyMetrics,
  searchTerms,
  marketplaceProfiles,
  campaigns,
  adGroups,
  adAccounts,
} from '@/db/schema';
import type { ReportJob, ReportType } from '@/db/schema/report-jobs';
import type { NewDailyMetric } from '@/db/schema/daily-metrics';
import {
  makeEntityKey,
  makeSearchTermEntityKey,
  hashQuery,
  normalizeQuery,
  EntityType,
} from '@/utils/entity-key';
import {
  sleep,
  formatDateForAmazon,
  daysAgo,
} from '@/utils/helpers';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { Marketplace } from '@/config/amazon';

// ── Types ──────────────────────────────────────────────────

export interface ReportRequestOptions {
  daysBack?: number;
  reportTypes?: ReportType[];
}

export interface ReportRequestResult {
  jobs: ReportJob[];
  skipped: Array<{ reportType: string; marketplace: string; reason: string }>;
}

export interface ReportProcessResult {
  processed: number;
  completed: number;
  failed: number;
  errors: Array<{ reportJobId: string; error: string }>;
}

// ── Mapping reportType → entityType pour daily_metrics ─────

const REPORT_TYPE_TO_ENTITY: Record<string, EntityType> = {
  campaigns: 'campaign',
  ad_groups: 'ad_group',
  keywords: 'keyword',
  targets: 'target',
  search_terms: 'search_term',
};

// ── Mapping reportType → champ ID Amazon dans les rows ─────

const REPORT_TYPE_ID_FIELD: Record<string, string> = {
  campaigns: 'campaignId',
  ad_groups: 'adGroupId',
  keywords: 'keywordId',
  targets: 'targetId',
  // search_terms est traité à part (adGroupId + query)
};

const ALL_REPORT_TYPES: ReportType[] = ['campaigns', 'ad_groups', 'keywords', 'targets', 'search_terms'];

const BATCH_SIZE = 500;
const POLL_INTERVAL_MS = 5_000;    // 5 secondes (réduit de 15s)
const MAX_POLL_DURATION_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
    private amazonClient: AmazonClientService,
  ) {}

  // ══════════════════════════════════════════════════════════
  // 1. REQUEST REPORTS
  // ══════════════════════════════════════════════════════════

  /**
   * Demande tous les rapports pour un ad account.
   * Crée un report_job par (profil × reportType).
   */
  async requestReportsForAccount(
    adAccountId: string,
    options?: ReportRequestOptions,
  ): Promise<ReportRequestResult> {
    const daysBack = options?.daysBack ?? 30;
    const reportTypes = options?.reportTypes ?? ALL_REPORT_TYPES;

    const startDate = formatDateForAmazon(daysAgo(daysBack));
    const endDate = formatDateForAmazon(new Date());

    // Récupérer les profils actifs
    const profiles = await this.db
      .select()
      .from(marketplaceProfiles)
      .where(
        and(
          eq(marketplaceProfiles.adAccountId, adAccountId),
          eq(marketplaceProfiles.isActive, true),
        ),
      );

    if (profiles.length === 0) {
      this.logger.warn(`No active profiles for ad account ${adAccountId}`);
      return { jobs: [], skipped: [] };
    }

    // Lookup workspace_id (requis par report_jobs NOT NULL constraint)
    const [account] = await this.db
      .select({ workspaceId: adAccounts.workspaceId })
      .from(adAccounts)
      .where(eq(adAccounts.id, adAccountId))
      .limit(1);

    if (!account?.workspaceId) {
      throw new Error(`Ad account ${adAccountId} has no workspace_id`);
    }

    const workspaceId = account.workspaceId;

    this.logger.log(
      `Requesting reports for ${profiles.length} profiles × ${reportTypes.length} types ` +
      `(${startDate} → ${endDate})`,
    );
    this.logger.log(
      `Active profiles: ${profiles.map((p: any) => `${p.profileId} (${p.marketplace})`).join(', ')}`,
    );

    const createdJobs: ReportJob[] = [];
    const skippedReports: Array<{ reportType: string; marketplace: string; reason: string }> = [];

    // Construire toutes les combinaisons profil × reportType et les envoyer en parallèle
    const requestTasks: Array<{ profile: any; reportType: string }> = [];
    for (const profile of profiles) {
      for (const reportType of reportTypes) {
        requestTasks.push({ profile, reportType });
      }
    }

    // Exécuter en parallèle par batches de 5
    const REQUEST_PARALLEL_LIMIT = 5;
    for (let i = 0; i < requestTasks.length; i += REQUEST_PARALLEL_LIMIT) {
      const batch = requestTasks.slice(i, i + REQUEST_PARALLEL_LIMIT);
      const batchResults = await Promise.allSettled(
        batch.map(async (task) => {
          this.logger.debug(
            `Requesting report: ${task.reportType} for profile ${task.profile.profileId} (${task.profile.marketplace})`,
          );
          return this.requestSingleReport(
            adAccountId,
            task.profile,
            task.reportType,
            startDate,
            endDate,
            workspaceId,
          );
        }),
      );

      for (let j = 0; j < batchResults.length; j++) {
        const batchResult = batchResults[j];
        const task = batch[j];
        if (batchResult.status === 'fulfilled') {
          if (batchResult.value) createdJobs.push(batchResult.value);
        } else {
          const err = batchResult.reason;
          const status = (err as any)?.response?.status;
          const message = (err as any)?.response?.data
            ? JSON.stringify((err as any).response.data)
            : (err instanceof Error ? err.message : String(err));
          const reason = `HTTP ${status || '?'}: ${message}`;
          if (status === 404 || status === 400) {
            this.logger.warn(
              `Report "${task.reportType}" profile ${task.profile.profileId} (${task.profile.marketplace}): ${reason}`,
            );
          } else {
            this.logger.error(
              `Report "${task.reportType}" profile ${task.profile.profileId} (${task.profile.marketplace}): ${reason}`,
            );
          }
          skippedReports.push({ reportType: task.reportType, marketplace: task.profile.marketplace, reason });
        }
      }
    }

    if (skippedReports.length > 0) {
      this.logger.warn(
        `Skipped/failed reports: ${JSON.stringify(skippedReports)}`,
      );
    }

    this.logger.log(`Reports requested: ${createdJobs.length} jobs created, ${skippedReports.length} skipped`);
    return { jobs: createdJobs, skipped: skippedReports };
  }

  /**
   * Demande un seul rapport et crée le report_job correspondant.
   */
  private async requestSingleReport(
    adAccountId: string,
    profile: any,
    reportType: string,
    startDate: string,
    endDate: string,
    workspaceId: string,
  ): Promise<ReportJob | null> {
    // Vérifier si un job existe déjà pour cette combinaison
    const existing = await this.db
      .select()
      .from(reportJobs)
      .where(
        and(
          eq(reportJobs.profileId, profile.id),
          eq(reportJobs.reportType, reportType),
          eq(reportJobs.dateFrom, startDate),
          eq(reportJobs.dateTo, endDate),
        ),
      )
      .limit(1);

    // Re-request si :
    // 1. Le job a échoué
    // 2. Le job ingéré avec 0 records (probable mauvaises colonnes)
    // 3. Le job a été ingéré il y a plus de STALE_THRESHOLD (les données changent en continu sur Amazon)
    const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 heures
    const isStale = existing.length > 0 &&
      existing[0].status === 'ingested' &&
      existing[0].ingestedAt &&
      (Date.now() - new Date(existing[0].ingestedAt).getTime()) > STALE_THRESHOLD_MS;

    const shouldReRequest = existing.length > 0 && (
      existing[0].status === 'failed' ||
      (existing[0].status === 'ingested' && (existing[0].recordsProcessed ?? 0) === 0) ||
      isStale
    );

    if (existing.length > 0 && !shouldReRequest) {
      this.logger.debug(
        `Report job already exists for ${reportType} ${profile.marketplace} (${existing[0].status}, records=${existing[0].recordsProcessed}, age=${existing[0].ingestedAt ? Math.round((Date.now() - new Date(existing[0].ingestedAt).getTime()) / 60000) + 'min' : '?'}) – skipping`,
      );
      return existing[0];
    }

    if (existing.length > 0 && shouldReRequest) {
      this.logger.log(
        `Re-requesting report ${reportType} ${profile.marketplace} (was ${existing[0].status}, records=${existing[0].recordsProcessed}${isStale ? ', STALE' : ''})`,
      );
    }

    // Appeler l'API Amazon
    const amazonReportId = await this.amazonClient.requestReport(
      adAccountId,
      profile.profileId,
      profile.marketplace as Marketplace,
      reportType,
      startDate,
      endDate,
    );

    this.logger.log(
      `Report requested: ${reportType} ${profile.marketplace} → amazonReportId=${amazonReportId}`,
    );

    // Upsert report_job
    if (existing.length > 0) {
      // Re-request d'un job failed or ingested with 0 records
      await this.db
        .update(reportJobs)
        .set({
          amazonReportId,
          status: 'requested',
          requestedAt: new Date(),
          errorMessage: null,
          completedAt: null,
          downloadedAt: null,
          ingestedAt: null,
          downloadUrl: null,
          recordsProcessed: 0,
        })
        .where(eq(reportJobs.id, existing[0].id));

      const [updated] = await this.db
        .select()
        .from(reportJobs)
        .where(eq(reportJobs.id, existing[0].id))
        .limit(1);
      return updated;
    }

    const [job] = await this.db
      .insert(reportJobs)
      .values({
        workspaceId,
        profileId: profile.id,
        reportType,
        amazonReportId,
        dateFrom: startDate,
        dateTo: endDate,
        status: 'requested',
        requestedAt: new Date(),
      })
      .returning();

    return job;
  }

  // ══════════════════════════════════════════════════════════
  // 2. PROCESS PENDING REPORTS (poll + download + ingest)
  // ══════════════════════════════════════════════════════════

  /**
   * Traite tous les rapports en attente : poll status, download, ingest.
   */
  async processAllPendingReports(options?: {
    maxAgeMinutes?: number;
  }): Promise<ReportProcessResult> {
    const maxAgeMinutes = options?.maxAgeMinutes ?? 1440; // 24h
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    // Récupérer les jobs en attente
    const pendingJobs = await this.db
      .select()
      .from(reportJobs)
      .where(
        and(
          inArray(reportJobs.status, ['requested', 'processing', 'ready', 'downloaded']),
          sql`${reportJobs.requestedAt} > ${cutoff.toISOString()}`,
        ),
      );

    if (pendingJobs.length === 0) {
      this.logger.log('No pending report jobs to process');
      return { processed: 0, completed: 0, failed: 0, errors: [] };
    }

    this.logger.log(`Processing ${pendingJobs.length} pending report jobs IN PARALLEL`);

    const result: ReportProcessResult = { processed: pendingJobs.length, completed: 0, failed: 0, errors: [] };

    // Traiter tous les rapports en parallèle (max 5 simultanés pour éviter le throttling)
    const PARALLEL_LIMIT = 5;
    for (let i = 0; i < pendingJobs.length; i += PARALLEL_LIMIT) {
      const batch = pendingJobs.slice(i, i + PARALLEL_LIMIT);
      const batchResults = await Promise.allSettled(
        batch.map((job: ReportJob) => this.pollAndProcessReport(job)),
      );

      for (let j = 0; j < batchResults.length; j++) {
        const batchResult = batchResults[j];
        if (batchResult.status === 'fulfilled') {
          result.completed++;
        } else {
          result.failed++;
          const errorMsg = batchResult.reason instanceof Error ? batchResult.reason.message : String(batchResult.reason);
          result.errors.push({ reportJobId: batch[j].id, error: errorMsg });
          this.logger.error(`Report job ${batch[j].id} failed: ${errorMsg}`);
        }
      }
    }

    this.logger.log(
      `Reports processing done: ${result.completed} completed, ${result.failed} failed`,
    );
    return result;
  }

  /**
   * Poll un seul rapport jusqu'à complétion, puis download + ingest.
   */
  private async pollAndProcessReport(job: ReportJob): Promise<void> {
    // Récupérer le profil associé pour marketplace/currency
    const [profile] = await this.db
      .select()
      .from(marketplaceProfiles)
      .where(eq(marketplaceProfiles.id, job.profileId))
      .limit(1);

    if (!profile) {
      throw new Error(`Profile ${job.profileId} not found for report job ${job.id}`);
    }

    // Si déjà downloaded → passer directement à l'ingestion
    if (job.status === 'downloaded' && job.downloadUrl) {
      await this.downloadAndIngest(job, job.downloadUrl, profile);
      return;
    }

    // Si déjà ready → passer au download
    if (job.status === 'ready' && job.downloadUrl) {
      await this.downloadAndIngest(job, job.downloadUrl, profile);
      return;
    }

    // Récupérer le ad account ID pour l'API
    const adAccountId = await this.getAdAccountIdForProfile(profile.id);

    // Poll loop
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
      const { status, url } = await this.amazonClient.getReportStatus(
        adAccountId,
        profile.profileId,
        profile.marketplace as Marketplace,
        job.amazonReportId!,
      );

      this.logger.debug(
        `Report ${job.id} (${job.reportType} ${profile.marketplace}): status=${status}`,
      );

      if (status === 'COMPLETED' && url) {
        // Mettre à jour le job avec l'URL
        await this.db
          .update(reportJobs)
          .set({ status: 'ready', completedAt: new Date(), downloadUrl: url })
          .where(eq(reportJobs.id, job.id));

        // Download et ingest
        await this.downloadAndIngest(job, url, profile);
        return;
      }

      if (status === 'FAILED') {
        await this.db
          .update(reportJobs)
          .set({ status: 'failed', errorMessage: 'Amazon reported FAILED status' })
          .where(eq(reportJobs.id, job.id));
        throw new Error(`Amazon report ${job.amazonReportId} failed`);
      }

      // PENDING ou PROCESSING → update status et attendre
      if (job.status !== 'processing') {
        await this.db
          .update(reportJobs)
          .set({ status: 'processing' })
          .where(eq(reportJobs.id, job.id));
      }

      await sleep(POLL_INTERVAL_MS);
    }

    // Timeout
    await this.db
      .update(reportJobs)
      .set({ status: 'failed', errorMessage: `Polling timeout after ${MAX_POLL_DURATION_MS / 60000}min` })
      .where(eq(reportJobs.id, job.id));
    throw new Error(`Report ${job.id} polling timeout`);
  }

  // ══════════════════════════════════════════════════════════
  // 3. DOWNLOAD & INGEST
  // ══════════════════════════════════════════════════════════

  /**
   * Télécharge un rapport et ingère les données dans daily_metrics.
   */
  private async downloadAndIngest(
    job: ReportJob,
    downloadUrl: string,
    profile: any,
  ): Promise<void> {
    this.logger.log(`Downloading report ${job.id} (${job.reportType} ${profile.marketplace})`);

    let rows: any[];
    try {
      rows = await this.amazonClient.downloadReport(downloadUrl);
    } catch (dlErr) {
      this.logger.error(
        `[DOWNLOAD] Failed to download report ${job.id}: ${dlErr instanceof Error ? dlErr.message : dlErr}`,
      );
      await this.db
        .update(reportJobs)
        .set({ status: 'failed', errorMessage: `Download error: ${dlErr instanceof Error ? dlErr.message : dlErr}` })
        .where(eq(reportJobs.id, job.id));
      throw dlErr;
    }

    await this.db
      .update(reportJobs)
      .set({ status: 'downloaded', downloadedAt: new Date() })
      .where(eq(reportJobs.id, job.id));

    this.logger.log(
      `Report ${job.id} (${job.reportType}): downloaded ${rows.length} rows, type=${typeof rows}, isArray=${Array.isArray(rows)}`,
    );
    if (rows.length > 0) {
      this.logger.log(`Report ${job.id}: first row sample = ${JSON.stringify(rows[0]).substring(0, 500)}`);
    }

    if (rows.length === 0) {
      await this.db
        .update(reportJobs)
        .set({ status: 'ingested', ingestedAt: new Date(), recordsProcessed: 0 })
        .where(eq(reportJobs.id, job.id));
      return;
    }

    let recordsProcessed = 0;

    if (job.reportType === 'search_terms') {
      recordsProcessed = await this.ingestSearchTermsReport(rows, profile, job.workspaceId);
    } else {
      recordsProcessed = await this.ingestStandardReport(rows, job.reportType, profile, job.workspaceId);
    }

    await this.db
      .update(reportJobs)
      .set({ status: 'ingested', ingestedAt: new Date(), recordsProcessed })
      .where(eq(reportJobs.id, job.id));

    this.logger.log(
      `Report ${job.id} ingested: ${recordsProcessed} records into daily_metrics`,
    );
  }

  /**
   * Ingère un rapport standard (campaigns, ad_groups, keywords, targets).
   */
  private async ingestStandardReport(
    rows: any[],
    reportType: string,
    profile: any,
    workspaceId: string,
  ): Promise<number> {
    const entityType = REPORT_TYPE_TO_ENTITY[reportType];
    const idField = REPORT_TYPE_ID_FIELD[reportType];

    if (!entityType || !idField) {
      throw new Error(`Unknown report type for ingestion: ${reportType}`);
    }

    // ── DIAGNOSTIC LOGGING ──
    this.logger.log(
      `[INGEST] reportType=${reportType}, entityType=${entityType}, idField=${idField}, totalRows=${rows.length}`,
    );
    if (rows.length > 0) {
      const sampleRow = rows[0];
      const sampleKeys = Object.keys(sampleRow);
      this.logger.log(`[INGEST] Sample row keys: ${sampleKeys.join(', ')}`);
      this.logger.log(`[INGEST] Sample row[${idField}] = ${JSON.stringify(sampleRow[idField])}`);
      this.logger.log(`[INGEST] Sample row.date = ${JSON.stringify(sampleRow.date)}`);
      this.logger.log(`[INGEST] Sample row.impressions = ${JSON.stringify(sampleRow.impressions)}`);
      this.logger.log(`[INGEST] Sample row.clicks = ${JSON.stringify(sampleRow.clicks)}`);
      this.logger.log(`[INGEST] Sample row.cost = ${JSON.stringify(sampleRow.cost)}, row.spend = ${JSON.stringify(sampleRow.spend)}`);
      this.logger.log(`[INGEST] Sample row.sales14d = ${JSON.stringify(sampleRow.sales14d)}`);
    }
    // ── END DIAGNOSTIC ──

    const metrics: NewDailyMetric[] = [];
    let skippedNoId = 0;

    for (const row of rows) {
      const amazonId = row[idField];
      if (!amazonId) {
        skippedNoId++;
        continue;
      }

      metrics.push({
        workspaceId,
        entityType,
        entityKey: makeEntityKey(entityType, amazonId),
        profileId: profile.id,
        date: row.date,
        marketplace: profile.marketplace,
        currency: profile.currency,
        impressions: parseInt(row.impressions, 10) || 0,
        clicks: parseInt(row.clicks, 10) || 0,
        spend: String(parseFloat(row.cost ?? row.spend) || 0),
        sales: String(parseFloat(row.sales14d) || 0),
        orders: parseInt(row.purchases14d, 10) || 0,
        units: parseInt(row.unitsSoldClicks14d, 10) || 0,
        attributionWindow: '14d',
      });
    }

    this.logger.log(
      `[INGEST] ${reportType}: ${metrics.length} metrics built, ${skippedNoId} rows skipped (no ${idField})`,
    );

    if (metrics.length === 0) {
      this.logger.warn(`[INGEST] ${reportType}: NO metrics to upsert! All ${rows.length} rows were skipped.`);
      return 0;
    }

    return this.batchUpsertDailyMetrics(metrics);
  }

  /**
   * Ingère un rapport search_terms → daily_metrics + search_terms table.
   */
  private async ingestSearchTermsReport(
    rows: any[],
    profile: any,
    workspaceId: string,
  ): Promise<number> {
    const metrics: NewDailyMetric[] = [];
    const searchTermRows: Array<{
      amazonAdGroupId: number;
      amazonCampaignId: number;
      query: string;
      queryHash: string;
      matchType: string | null;
      date: string;
    }> = [];

    for (const row of rows) {
      const query = row.searchTerm || row.query;
      if (!query || !row.adGroupId) continue;

      const qHash = hashQuery(query);
      const entityKey = makeSearchTermEntityKey(row.adGroupId, qHash);

      metrics.push({
        workspaceId,
        entityType: 'search_term',
        entityKey,
        profileId: profile.id,
        date: row.date,
        marketplace: profile.marketplace,
        currency: profile.currency,
        impressions: parseInt(row.impressions, 10) || 0,
        clicks: parseInt(row.clicks, 10) || 0,
        spend: String(parseFloat(row.cost ?? row.spend) || 0),
        sales: String(parseFloat(row.sales14d) || 0),
        orders: parseInt(row.purchases14d, 10) || 0,
        units: parseInt(row.unitsSoldClicks14d, 10) || 0,
        attributionWindow: '14d',
      });

      searchTermRows.push({
        amazonAdGroupId: Number(row.adGroupId),
        amazonCampaignId: Number(row.campaignId),
        query,
        queryHash: qHash,
        matchType: row.matchType || null,
        date: row.date,
      });
    }

    const metricsCount = await this.batchUpsertDailyMetrics(metrics);

    // Upsert search_terms table
    await this.batchUpsertSearchTerms(searchTermRows, profile, workspaceId);

    // Mettre à jour lastSearchTermsSyncAt sur le profil
    await this.db
      .update(marketplaceProfiles)
      .set({ lastSearchTermsSyncAt: new Date() })
      .where(eq(marketplaceProfiles.id, profile.id));

    return metricsCount;
  }

  // ══════════════════════════════════════════════════════════
  // 4. BATCH UPSERT OPERATIONS
  // ══════════════════════════════════════════════════════════

  /**
   * Batch UPSERT daily_metrics via ON CONFLICT (entity_type, entity_key, date).
   */
  private async batchUpsertDailyMetrics(metrics: NewDailyMetric[]): Promise<number> {
    if (metrics.length === 0) return 0;

    // Dédupliquer par (entity_type, entity_key, date) — garde le dernier (somme les métriques)
    const dedupMap = new Map<string, NewDailyMetric>();
    for (const m of metrics) {
      const key = `${m.entityType}|${m.entityKey}|${m.date}`;
      const existing = dedupMap.get(key);
      if (existing) {
        // Agréger les métriques pour les doublons (ex: même search term, match types différents)
        existing.impressions = (existing.impressions ?? 0) + (m.impressions ?? 0);
        existing.clicks = (existing.clicks ?? 0) + (m.clicks ?? 0);
        existing.spend = String(parseFloat(existing.spend ?? '0') + parseFloat(m.spend ?? '0'));
        existing.sales = String(parseFloat(existing.sales ?? '0') + parseFloat(m.sales ?? '0'));
        existing.orders = (existing.orders ?? 0) + (m.orders ?? 0);
        existing.units = (existing.units ?? 0) + (m.units ?? 0);
      } else {
        dedupMap.set(key, { ...m });
      }
    }
    const dedupedMetrics = Array.from(dedupMap.values());

    let totalProcessed = 0;

    for (let i = 0; i < dedupedMetrics.length; i += BATCH_SIZE) {
      const batch = dedupedMetrics.slice(i, i + BATCH_SIZE);

      // Construire les VALUES manuellement pour un batch insert
      const values = batch.map((m) =>
        sql`(
          gen_random_uuid(),
          ${m.workspaceId}::uuid,
          ${m.entityType},
          ${m.entityKey},
          ${m.profileId}::uuid,
          ${m.date},
          ${m.marketplace},
          ${m.currency},
          ${m.impressions ?? 0},
          ${m.clicks ?? 0},
          ${m.spend ?? '0'},
          ${m.sales ?? '0'},
          ${m.orders ?? 0},
          ${m.units ?? 0},
          ${m.attributionWindow ?? '14d'},
          NOW(),
          NOW()
        )`,
      );

      await this.db.execute(sql`
        INSERT INTO daily_metrics (
          id, workspace_id, entity_type, entity_key, profile_id, date, marketplace, currency,
          impressions, clicks, spend, sales, orders, units,
          attribution_window, synced_at, created_at
        )
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT (entity_type, entity_key, date) DO UPDATE SET
          impressions = EXCLUDED.impressions,
          clicks = EXCLUDED.clicks,
          spend = EXCLUDED.spend,
          sales = EXCLUDED.sales,
          orders = EXCLUDED.orders,
          units = EXCLUDED.units,
          synced_at = NOW()
      `);

      totalProcessed += batch.length;
    }

    return totalProcessed;
  }

  /**
   * Batch UPSERT search_terms via ON CONFLICT (ad_group_id, query_hash).
   * Note: query_norm et query_hash sont des colonnes GENERATED dans PostgreSQL.
   * On doit les fournir manuellement car Drizzle ne peut pas les écrire via ORM.
   */
  private async batchUpsertSearchTerms(
    rows: Array<{
      amazonAdGroupId: number;
      amazonCampaignId: number;
      query: string;
      queryHash: string;
      matchType: string | null;
      date: string;
    }>,
    profile: any,
    workspaceId: string,
  ): Promise<number> {
    if (rows.length === 0) return 0;

    // Dédupliquer par (amazonAdGroupId, queryHash) - garder le plus récent
    const dedupMap = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      const key = `${row.amazonAdGroupId}:${row.queryHash}`;
      const existing = dedupMap.get(key);
      if (!existing || row.date > existing.date) {
        dedupMap.set(key, row);
      }
    }
    const uniqueRows = Array.from(dedupMap.values());

    // Récupérer les ad_groups et campaigns DB pour les FK
    const amazonAdGroupIds = [...new Set(uniqueRows.map((r) => r.amazonAdGroupId))];
    const amazonCampaignIds = [...new Set(uniqueRows.map((r) => r.amazonCampaignId))];

    // Lookup ad_groups : amazonAdGroupId → UUID
    const dbAdGroups = await this.db
      .select({
        id: adGroups.id,
        amazonAdGroupId: adGroups.amazonAdGroupId,
        campaignId: adGroups.campaignId,
      })
      .from(adGroups)
      .where(
        sql`${adGroups.amazonAdGroupId} IN (${sql.join(
          amazonAdGroupIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );

    const adGroupMap = new Map<number, { id: string; campaignId: string }>();
    for (const ag of dbAdGroups) {
      adGroupMap.set(ag.amazonAdGroupId, { id: ag.id, campaignId: ag.campaignId });
    }

    let totalProcessed = 0;

    for (let i = 0; i < uniqueRows.length; i += BATCH_SIZE) {
      const batch = uniqueRows.slice(i, i + BATCH_SIZE);
      const validValues: any[] = [];

      for (const row of batch) {
        const ag = adGroupMap.get(row.amazonAdGroupId);
        if (!ag) {
          // Ad group pas encore synchronisé → skip
          continue;
        }

        validValues.push(
          sql`(
            gen_random_uuid(),
            ${workspaceId}::uuid,
            ${profile.id}::uuid,
            ${ag.campaignId}::uuid,
            ${ag.id}::uuid,
            ${row.amazonCampaignId}::bigint,
            ${row.amazonAdGroupId}::bigint,
            ${row.query},
            ${row.matchType},
            'keyword',
            NOW(),
            NOW(),
            'new',
            NOW()
          )`,
        );
      }

      if (validValues.length === 0) continue;

      await this.db.execute(sql`
        INSERT INTO search_terms (
          id, workspace_id, profile_id, campaign_id, ad_group_id,
          amazon_campaign_id, amazon_ad_group_id,
          query,
          match_type, targeting_type,
          first_seen_at, last_seen_at, status, created_at
        )
        VALUES ${sql.join(validValues, sql`, `)}
        ON CONFLICT (ad_group_id, query_hash) DO UPDATE SET
          last_seen_at = NOW()
      `);

      totalProcessed += validValues.length;
    }

    this.logger.log(`Search terms upserted: ${totalProcessed} rows`);
    return totalProcessed;
  }

  // ══════════════════════════════════════════════════════════
  // 5. UTILITY METHODS
  // ══════════════════════════════════════════════════════════

  /**
   * Récupère le ad account ID à partir d'un profile ID (UUID).
   */
  private async getAdAccountIdForProfile(profileDbId: string): Promise<string> {
    const [profile] = await this.db
      .select({ adAccountId: marketplaceProfiles.adAccountId })
      .from(marketplaceProfiles)
      .where(eq(marketplaceProfiles.id, profileDbId))
      .limit(1);

    if (!profile) {
      throw new Error(`Profile ${profileDbId} not found`);
    }
    return profile.adAccountId;
  }

  /**
   * Récupère le statut d'un report job par ID.
   */
  async getReportJobStatus(reportJobId: string): Promise<ReportJob> {
    const [job] = await this.db
      .select()
      .from(reportJobs)
      .where(eq(reportJobs.id, reportJobId))
      .limit(1);

    if (!job) {
      throw new Error(`Report job ${reportJobId} not found`);
    }
    return job;
  }
}
