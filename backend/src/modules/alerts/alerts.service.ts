import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { incidents, NewIncident, Incident, Severity } from '@/db/schema';
import { TelegramService, SEVERITY_LEVELS } from './telegram.service';
import { eq, and, desc, sql } from 'drizzle-orm';

export { Severity, SEVERITY_LEVELS };

export interface AlertOptions {
  workspaceId?: string;
  incidentType: string;
  severity: Severity;
  title: string;
  description?: string;
  context?: Record<string, any>;
  entityType?: string;
  entityKey?: string;
  sendNotification?: boolean;
}

export interface AlertResult {
  incidentId: string;
  notificationSent: boolean;
  notificationError?: string;
}

export interface IncidentQuery {
  workspaceId?: string;
  status?: string;
  severity?: Severity;
  incidentType?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
    private telegramService: TelegramService,
  ) {}

  // ============================================
  // ALERT CREATION
  // ============================================

  /**
   * Cree une alerte et envoie une notification Telegram
   */
  async createAlert(options: AlertOptions): Promise<AlertResult> {
    const {
      workspaceId,
      incidentType,
      severity,
      title,
      description,
      context,
      entityType,
      entityKey,
      sendNotification = true,
    } = options;

    this.logger.log(`Creating alert: [${severity}] ${title}`);

    // 1. Creer l'incident en base
    const [incident] = await this.db
      .insert(incidents)
      .values({
        workspaceId,
        incidentType,
        severity,
        title,
        description,
        context,
        entityType,
        entityKey,
        status: 'open',
        notificationSent: false,
      })
      .returning();

    const result: AlertResult = {
      incidentId: incident.id,
      notificationSent: false,
    };

    // 2. Envoyer la notification Telegram
    if (sendNotification) {
      try {
        const telegramResult = await this.telegramService.sendAlert(
          title,
          description || '',
          severity,
          {
            ...context,
            incidentId: incident.id,
            incidentType,
            ...(entityType && { entityType }),
            ...(entityKey && { entityKey }),
          },
        );

        if (telegramResult.success) {
          result.notificationSent = true;

          // Mettre a jour l'incident
          await this.db
            .update(incidents)
            .set({
              notificationSent: true,
              notificationChannel: 'telegram',
              notificationSentAt: new Date(),
            })
            .where(eq(incidents.id, incident.id));
        } else {
          result.notificationError = telegramResult.error;
          this.logger.warn(`Failed to send Telegram notification: ${telegramResult.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.notificationError = errorMessage;
        this.logger.error(`Error sending notification: ${errorMessage}`);
      }
    }

    return result;
  }

  /**
   * Envoie une alerte info
   */
  async info(
    title: string,
    description?: string,
    options?: Partial<AlertOptions>,
  ): Promise<AlertResult> {
    return this.createAlert({
      incidentType: options?.incidentType || 'info',
      severity: 'info',
      title,
      description,
      ...options,
    });
  }

  /**
   * Envoie une alerte warning
   */
  async warning(
    title: string,
    description?: string,
    options?: Partial<AlertOptions>,
  ): Promise<AlertResult> {
    return this.createAlert({
      incidentType: options?.incidentType || 'warning',
      severity: 'warning',
      title,
      description,
      ...options,
    });
  }

  /**
   * Envoie une alerte erreur
   */
  async error(
    title: string,
    description?: string,
    options?: Partial<AlertOptions>,
  ): Promise<AlertResult> {
    return this.createAlert({
      incidentType: options?.incidentType || 'error',
      severity: 'error',
      title,
      description,
      ...options,
    });
  }

  /**
   * Envoie une alerte critique
   */
  async critical(
    title: string,
    description?: string,
    options?: Partial<AlertOptions>,
  ): Promise<AlertResult> {
    return this.createAlert({
      incidentType: options?.incidentType || 'critical',
      severity: 'critical',
      title,
      description,
      ...options,
    });
  }

  // ============================================
  // INCIDENT MANAGEMENT
  // ============================================

  /**
   * Recupere les incidents
   */
  async getIncidents(query: IncidentQuery): Promise<{
    data: Incident[];
    total: number;
  }> {
    const conditions = [];

    if (query.workspaceId) {
      conditions.push(eq(incidents.workspaceId, query.workspaceId));
    }
    if (query.status) {
      conditions.push(eq(incidents.status, query.status));
    }
    if (query.severity) {
      conditions.push(eq(incidents.severity, query.severity));
    }
    if (query.incidentType) {
      conditions.push(eq(incidents.incidentType, query.incidentType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Compter le total
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(incidents)
      .where(whereClause);

    // Recuperer les donnees
    let queryBuilder = this.db
      .select()
      .from(incidents)
      .where(whereClause)
      .orderBy(desc(incidents.occurredAt));

    if (query.limit) {
      queryBuilder = queryBuilder.limit(query.limit);
    }
    if (query.offset) {
      queryBuilder = queryBuilder.offset(query.offset);
    }

    const data = await queryBuilder;

    return {
      data,
      total: Number(countResult?.count || 0),
    };
  }

  /**
   * Recupere un incident par ID
   */
  async getIncidentById(incidentId: string): Promise<Incident | null> {
    const [incident] = await this.db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    return incident || null;
  }

  /**
   * Acquitte un incident
   */
  async acknowledgeIncident(incidentId: string): Promise<Incident> {
    const [updated] = await this.db
      .update(incidents)
      .set({
        status: 'acknowledged',
        acknowledgedAt: new Date(),
      })
      .where(eq(incidents.id, incidentId))
      .returning();

    if (!updated) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    this.logger.log(`Incident ${incidentId} acknowledged`);
    return updated;
  }

  /**
   * Resout un incident
   */
  async resolveIncident(incidentId: string): Promise<Incident> {
    const [updated] = await this.db
      .update(incidents)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
      })
      .where(eq(incidents.id, incidentId))
      .returning();

    if (!updated) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    this.logger.log(`Incident ${incidentId} resolved`);
    return updated;
  }

  /**
   * Ignore un incident
   */
  async ignoreIncident(incidentId: string): Promise<Incident> {
    const [updated] = await this.db
      .update(incidents)
      .set({
        status: 'ignored',
      })
      .where(eq(incidents.id, incidentId))
      .returning();

    if (!updated) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    this.logger.log(`Incident ${incidentId} ignored`);
    return updated;
  }

  // ============================================
  // SPECIALIZED ALERTS
  // ============================================

  /**
   * Alerte pour un kill switch active
   */
  async alertKillSwitchEnabled(reason: string, enabledBy: string): Promise<AlertResult> {
    return this.critical(
      'Kill Switch Enabled',
      `The kill switch has been activated. All automated actions are now blocked.`,
      {
        incidentType: 'kill_switch',
        context: { reason, enabledBy },
      },
    );
  }

  /**
   * Alerte pour une erreur API Amazon
   */
  async alertAmazonApiError(
    error: string,
    endpoint: string,
    workspaceId?: string,
  ): Promise<AlertResult> {
    return this.error(
      'Amazon API Error',
      `Failed to call Amazon Ads API`,
      {
        workspaceId,
        incidentType: 'api_error',
        context: { error, endpoint },
      },
    );
  }

  /**
   * Alerte pour un budget depense
   */
  async alertBudgetThreshold(
    workspaceId: string,
    campaignId: string,
    currentSpend: number,
    threshold: number,
  ): Promise<AlertResult> {
    return this.warning(
      'Budget Threshold Reached',
      `Campaign has reached ${((currentSpend / threshold) * 100).toFixed(1)}% of budget`,
      {
        workspaceId,
        incidentType: 'budget_alert',
        entityType: 'campaign',
        entityKey: campaignId,
        context: { currentSpend, threshold, percentage: (currentSpend / threshold) * 100 },
      },
    );
  }

  /**
   * Alerte pour ACOS eleve
   */
  async alertHighAcos(
    workspaceId: string,
    entityType: string,
    entityKey: string,
    acos: number,
    target: number,
  ): Promise<AlertResult> {
    return this.warning(
      'High ACOS Detected',
      `ACOS of ${acos.toFixed(1)}% exceeds target of ${target}%`,
      {
        workspaceId,
        incidentType: 'acos_alert',
        entityType,
        entityKey,
        context: { acos, target, difference: acos - target },
      },
    );
  }

  /**
   * Alerte pour un echec de synchronisation
   */
  async alertSyncFailure(
    workspaceId: string,
    profileId: string,
    error: string,
  ): Promise<AlertResult> {
    return this.error(
      'Sync Failed',
      `Data synchronization failed for profile`,
      {
        workspaceId,
        incidentType: 'sync_error',
        context: { profileId, error },
      },
    );
  }

  /**
   * Alerte pour une action echouee
   */
  async alertActionFailure(
    workspaceId: string,
    actionType: string,
    entityKey: string,
    error: string,
  ): Promise<AlertResult> {
    return this.error(
      'Action Execution Failed',
      `Failed to execute ${actionType} on ${entityKey}`,
      {
        workspaceId,
        incidentType: 'action_error',
        entityKey,
        context: { actionType, error },
      },
    );
  }

  // ============================================
  // NOTIFICATIONS DIRECTES
  // ============================================

  /**
   * Envoie une notification Telegram directe (sans creer d'incident)
   */
  async sendNotification(
    title: string,
    message: string,
    severity: Severity = 'info',
    details?: Record<string, any>,
  ): Promise<boolean> {
    const result = await this.telegramService.sendAlert(title, message, severity, details);
    return result.success;
  }

  /**
   * Envoie un rapport resume
   */
  async sendDailySummary(
    workspaceId: string,
    stats: {
      actionsExecuted: number;
      recommendationsCreated: number;
      totalSpend: number;
      totalSales: number;
      avgAcos: number;
    },
  ): Promise<boolean> {
    const result = await this.telegramService.sendReport(
      'Daily Summary',
      [
        { label: 'Actions Executed', value: stats.actionsExecuted },
        { label: 'Recommendations Created', value: stats.recommendationsCreated },
        { label: 'Total Spend', value: `$${stats.totalSpend.toFixed(2)}` },
        { label: 'Total Sales', value: `$${stats.totalSales.toFixed(2)}` },
        { label: 'Average ACOS', value: `${stats.avgAcos.toFixed(1)}%` },
      ],
    );

    return result.success;
  }

  /**
   * Teste la connexion Telegram
   */
  async testTelegramConnection(): Promise<{
    success: boolean;
    botInfo?: any;
    error?: string;
  }> {
    return this.telegramService.testConnection();
  }
}
