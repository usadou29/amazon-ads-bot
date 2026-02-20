import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { adAccounts, reportJobs, dailyMetrics, marketplaceProfiles } from '@/db/schema';
import { syncLogs } from '@/db/schema/sync-logs';
import { eq, isNotNull, sql, and, inArray, desc, ne } from 'drizzle-orm';
import { SyncService } from '@/modules/sync/sync.service';
import { ReportsService } from '@/modules/reports/reports.service';

/**
 * SchedulerService – SaaS-ready automatic sync
 *
 * Responsibilities:
 * 1. Daily cron: iterate all active ad accounts, trigger full sync + report ingestion
 * 2. Per-workspace manual sync (called from UI)
 * 3. Report processing (poll Amazon for completed reports, download & ingest)
 *
 * Multi-tenant: each ad account belongs to a workspace. The scheduler
 * processes all active ad accounts independently; failures on one
 * account don't block others.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private syncInProgress = new Set<string>(); // adAccountId → prevent overlap

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
    private syncService: SyncService,
    private reportsService: ReportsService,
  ) {}

  // ═══════════════════════════════════════════════
  // CRON: Daily full sync — 03:00 UTC every day
  // ═══════════════════════════════════════════════

  @Cron('0 3 * * *', { name: 'daily-full-sync', timeZone: 'UTC' })
  async handleDailySync(): Promise<void> {
    this.logger.log('═══ [CRON] Daily full sync started ═══');

    const accounts = await this.getActiveAdAccounts();
    this.logger.log(`[CRON] Found ${accounts.length} active ad account(s) to sync`);

    let successCount = 0;
    let failCount = 0;

    for (const account of accounts) {
      try {
        await this.syncWorkspaceAccount(account.id, 'cron');
        successCount++;
      } catch (err) {
        failCount++;
        this.logger.error(
          `[CRON] Failed to sync ad account ${account.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.logger.log(
      `═══ [CRON] Daily sync finished: ${successCount} success, ${failCount} failed ═══`,
    );
  }

  // ═══════════════════════════════════════════════
  // CRON: Process pending reports — every 30 minutes
  // Picks up reports that were requested but not yet downloaded/ingested
  // ═══════════════════════════════════════════════

  @Cron('*/30 * * * *', { name: 'process-pending-reports', timeZone: 'UTC' })
  async handleProcessReports(): Promise<void> {
    this.logger.log('[CRON] Processing pending reports...');

    try {
      const result = await this.reportsService.processAllPendingReports({
        maxAgeMinutes: 1440, // Reports up to 24h old
      });

      if (result.completed > 0 || result.failed > 0) {
        this.logger.log(
          `[CRON] Reports processed: ${result.completed} ingested, ${result.failed} failed, ${result.processed} total`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[CRON] Report processing failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ═══════════════════════════════════════════════
  // Manual sync: called from API for a specific workspace
  // ═══════════════════════════════════════════════

  async syncByWorkspace(workspaceId: string): Promise<{
    status: 'success' | 'partial' | 'failed';
    accounts: Array<{ adAccountId: string; status: string; message: string }>;
  }> {
    this.logger.log(`[MANUAL] Sync requested for workspace ${workspaceId}`);

    // Find all ad accounts for this workspace
    const accounts = await this.db
      .select({ id: adAccounts.id })
      .from(adAccounts)
      .where(eq(adAccounts.workspaceId, workspaceId));

    if (accounts.length === 0) {
      return { status: 'failed', accounts: [{ adAccountId: '', status: 'error', message: 'No ad accounts found for workspace' }] };
    }

    const results: Array<{ adAccountId: string; status: string; message: string }> = [];

    for (const account of accounts) {
      try {
        await this.syncWorkspaceAccount(account.id, 'manual');
        results.push({ adAccountId: account.id, status: 'success', message: 'Sync + reports completed' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ adAccountId: account.id, status: 'failed', message: msg });
      }
    }

    const hasFailures = results.some((r) => r.status === 'failed');
    const allFailed = results.every((r) => r.status === 'failed');

    return {
      status: allFailed ? 'failed' : hasFailures ? 'partial' : 'success',
      accounts: results,
    };
  }

  // ═══════════════════════════════════════════════
  // Core: sync a single ad account (structure + reports)
  // ═══════════════════════════════════════════════

  private async syncWorkspaceAccount(adAccountId: string, trigger: 'cron' | 'manual'): Promise<void> {
    // Prevent overlapping syncs for the same account
    if (this.syncInProgress.has(adAccountId)) {
      this.logger.warn(`[${trigger.toUpperCase()}] Sync already in progress for ${adAccountId}, skipping`);
      return;
    }

    this.syncInProgress.add(adAccountId);
    const startTime = Date.now();

    try {
      // Step 1: Structural sync (profiles, campaigns, ad groups, keywords, targets)
      // Also requests reports at the end
      this.logger.log(`[${trigger.toUpperCase()}] Step 1/2: Structural sync for ${adAccountId}`);
      const syncResult = await this.syncService.triggerSync({
        adAccountId,
        syncType: 'full',
        entities: ['profiles', 'campaigns', 'ad_groups', 'keywords', 'product_targets', 'reports'],
      });

      this.logger.log(
        `[${trigger.toUpperCase()}] Structural sync done for ${adAccountId}: ` +
        `status=${syncResult.status}, created=${syncResult.recordsCreated}, updated=${syncResult.recordsUpdated}`,
      );

      // Step 2: Process reports (poll Amazon, download CSV, ingest into daily_metrics)
      // Wait a bit to let Amazon generate the reports
      this.logger.log(`[${trigger.toUpperCase()}] Step 2/2: Processing reports for ${adAccountId}`);
      const reportResult = await this.reportsService.processAllPendingReports({
        maxAgeMinutes: 1440,
      });

      this.logger.log(
        `[${trigger.toUpperCase()}] Reports done for ${adAccountId}: ` +
        `completed=${reportResult.completed}, failed=${reportResult.failed}, processed=${reportResult.processed}`,
      );

      const duration = Math.round((Date.now() - startTime) / 1000);
      this.logger.log(`[${trigger.toUpperCase()}] Full sync for ${adAccountId} completed in ${duration}s`);

      // Update lastSyncAt on the ad account
      await this.db
        .update(adAccounts)
        .set({ lastSyncAt: new Date() })
        .where(eq(adAccounts.id, adAccountId));

    } finally {
      this.syncInProgress.delete(adAccountId);
    }
  }

  // ═══════════════════════════════════════════════
  // Diagnostic: full pipeline check
  // ═══════════════════════════════════════════════

  async getDiagnostic(workspaceId: string): Promise<any> {
    // 1. Ad accounts
    const accounts = await this.db
      .select({
        id: adAccounts.id,
        lastSyncAt: adAccounts.lastSyncAt,
      })
      .from(adAccounts)
      .where(eq(adAccounts.workspaceId, workspaceId));

    // 2. Marketplace profiles
    const profiles = await this.db
      .select({
        id: marketplaceProfiles.id,
        profileId: marketplaceProfiles.profileId,
        marketplace: marketplaceProfiles.marketplace,
        isActive: marketplaceProfiles.isActive,
        adAccountId: marketplaceProfiles.adAccountId,
      })
      .from(marketplaceProfiles)
      .where(
        inArray(
          marketplaceProfiles.adAccountId,
          accounts.map((a: any) => a.id),
        ),
      );

    // 3. Report jobs summary
    const allJobs = await this.db
      .select()
      .from(reportJobs)
      .where(eq(reportJobs.workspaceId, workspaceId));

    const jobsByStatus: Record<string, number> = {};
    const jobDetails: any[] = [];
    for (const job of allJobs) {
      jobsByStatus[job.status] = (jobsByStatus[job.status] || 0) + 1;
      jobDetails.push({
        id: job.id,
        reportType: job.reportType,
        status: job.status,
        amazonReportId: job.amazonReportId,
        dateRange: `${job.dateFrom} → ${job.dateTo}`,
        requestedAt: job.requestedAt,
        completedAt: job.completedAt,
        downloadedAt: job.downloadedAt,
        ingestedAt: job.ingestedAt,
        recordsProcessed: job.recordsProcessed,
        errorMessage: job.errorMessage,
      });
    }

    // 4. Daily metrics count
    const metricsCountResult = await this.db.execute(
      sql`SELECT COUNT(*) as count FROM daily_metrics WHERE workspace_id = ${workspaceId}::uuid`,
    );
    const metricsCountRows = metricsCountResult?.rows ?? metricsCountResult ?? [];
    const metricsCount = Array.isArray(metricsCountRows) ? metricsCountRows[0]?.count ?? 0 : 0;

    // 5. Daily metrics by entity type
    const metricsByTypeResult = await this.db.execute(
      sql`SELECT entity_type, COUNT(*) as count FROM daily_metrics WHERE workspace_id = ${workspaceId}::uuid GROUP BY entity_type`,
    );
    const metricsByType = metricsByTypeResult?.rows ?? metricsByTypeResult ?? [];

    // 6. Sample daily_metrics rows (if any)
    const sampleMetricsResult = await this.db.execute(
      sql`SELECT entity_type, entity_key, date, impressions, clicks, spend, sales FROM daily_metrics WHERE workspace_id = ${workspaceId}::uuid ORDER BY date DESC LIMIT 5`,
    );
    const sampleMetrics = sampleMetricsResult?.rows ?? sampleMetricsResult ?? [];

    return {
      workspace: workspaceId,
      syncInProgress: accounts.some((a: any) => this.syncInProgress.has(a.id)),
      adAccounts: accounts.map((a: any) => ({
        id: a.id,
        lastSyncAt: a.lastSyncAt,
      })),
      profiles: profiles.map((p: any) => ({
        id: p.id,
        profileId: p.profileId,
        marketplace: p.marketplace,
        isActive: p.isActive,
      })),
      reportJobs: {
        total: allJobs.length,
        byStatus: jobsByStatus,
        details: jobDetails,
      },
      dailyMetrics: {
        totalRows: metricsCount,
        byEntityType: metricsByType,
        sampleRows: sampleMetrics,
      },
    };
  }

  // ═══════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════

  private async getActiveAdAccounts(): Promise<Array<{ id: string; workspaceId: string }>> {
    return this.db
      .select({
        id: adAccounts.id,
        workspaceId: adAccounts.workspaceId,
      })
      .from(adAccounts)
      .where(isNotNull(adAccounts.workspaceId));
  }

  /**
   * Get sync status for a workspace (for the frontend)
   */
  async getWorkspaceSyncStatus(workspaceId: string): Promise<{
    lastSyncAt: Date | null;
    syncInProgress: boolean;
    adAccountCount: number;
    lastSyncDurationSeconds: number | null;
    syncStartedAt: Date | null;
  }> {
    const accounts = await this.db
      .select({
        id: adAccounts.id,
        lastSyncAt: adAccounts.lastSyncAt,
      })
      .from(adAccounts)
      .where(eq(adAccounts.workspaceId, workspaceId));

    if (accounts.length === 0) {
      return { lastSyncAt: null, syncInProgress: false, adAccountCount: 0, lastSyncDurationSeconds: null, syncStartedAt: null };
    }

    // Last sync = most recent across all ad accounts
    const lastSyncAt = accounts.reduce((latest: Date | null, acc: any) => {
      if (!acc.lastSyncAt) return latest;
      if (!latest) return acc.lastSyncAt;
      return acc.lastSyncAt > latest ? acc.lastSyncAt : latest;
    }, null as Date | null);

    const inProgress = accounts.some((a: any) => this.syncInProgress.has(a.id));

    const accountIds = accounts.map((a: any) => a.id);

    // Durée de la dernière synchro terminée (pour estimer la progression)
    let lastSyncDurationSeconds: number | null = null;
    try {
      const [lastCompleted] = await this.db
        .select({ durationSeconds: syncLogs.durationSeconds })
        .from(syncLogs)
        .where(
          and(
            inArray(syncLogs.adAccountId, accountIds),
            ne(syncLogs.status, 'running'),
          ),
        )
        .orderBy(desc(syncLogs.finishedAt))
        .limit(1);

      if (lastCompleted?.durationSeconds) {
        lastSyncDurationSeconds = Number(lastCompleted.durationSeconds);
      }
    } catch {
      // Ignore — la table peut ne pas encore avoir de données
    }

    // Timestamp de début de la synchro en cours
    let syncStartedAt: Date | null = null;
    if (inProgress) {
      try {
        const [runningSync] = await this.db
          .select({ startedAt: syncLogs.startedAt })
          .from(syncLogs)
          .where(
            and(
              inArray(syncLogs.adAccountId, accountIds),
              eq(syncLogs.status, 'running'),
            ),
          )
          .orderBy(desc(syncLogs.startedAt))
          .limit(1);

        if (runningSync?.startedAt) {
          syncStartedAt = runningSync.startedAt;
        }
      } catch {
        // Ignore
      }
    }

    return {
      lastSyncAt,
      syncInProgress: inProgress,
      adAccountCount: accounts.length,
      lastSyncDurationSeconds,
      syncStartedAt,
    };
  }
}
