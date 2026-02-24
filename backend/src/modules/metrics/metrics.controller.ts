import {
  Controller,
  Get,
  Query,
  Param,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { dailyMetrics } from '@/db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { MetricsService, MetricsFilter, DateRange } from './metrics.service';

@Controller('api/metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(
    private readonly metricsService: MetricsService,
    @Inject(DATABASE_CONNECTION) private readonly db: any,
  ) {}

  /**
   * GET /api/metrics/summary
   * Recupere le resume des metriques avec KPIs calcules
   */
  @Get('summary')
  async getSummary(
    @Query('workspaceId') workspaceId?: string,
    @Query('profileId') profileId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('entityType') entityType?: string,
    @Query('marketplace') marketplace?: string,
  ) {
    if (!workspaceId && !profileId) {
      throw new BadRequestException('workspaceId or profileId is required');
    }

    this.logger.log(`Fetching metrics summary for workspace ${workspaceId || 'N/A'} / profile ${profileId || 'N/A'}`);

    const filter: MetricsFilter = {
      workspaceId,
      profileId,
      entityType,
      marketplace,
    };

    if (startDate && endDate) {
      filter.dateRange = {
        startDate,
        endDate,
      };
    }

    return this.metricsService.getSummary(filter);
  }

  /**
   * GET /api/metrics/entity/:type/:key
   * Recupere les metriques detaillees pour une entite specifique
   */
  @Get('entity/:type/:key')
  async getEntityMetrics(
    @Param('type') entityType: string,
    @Param('key') entityKey: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('profileId') profileId?: string,
  ) {
    if (!entityType) {
      throw new BadRequestException('Entity type is required');
    }

    if (!entityKey) {
      throw new BadRequestException('Entity key is required');
    }

    // Decoder l'entity key (peut contenir des caracteres speciaux)
    const decodedEntityKey = decodeURIComponent(entityKey);

    this.logger.log(`Fetching metrics for ${entityType}:${decodedEntityKey}`);

    const filter: MetricsFilter = {
      workspaceId,
      profileId,
    };

    if (startDate && endDate) {
      filter.dateRange = {
        startDate,
        endDate,
      };
    }

    return this.metricsService.getEntityMetrics(entityType, decodedEntityKey, filter);
  }

  /**
   * GET /api/metrics/top-performers
   * Recupere les meilleures entites selon un KPI
   */
  @Get('top-performers')
  async getTopPerformers(
    @Query('workspaceId') workspaceId?: string,
    @Query('profileId') profileId?: string,
    @Query('entityType') entityType?: string,
    @Query('sortBy') sortBy?: string,
    @Query('limit') limit?: string,
    @Query('order') order?: 'asc' | 'desc',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('marketplace') marketplace?: string,
  ) {
    if (!workspaceId && !profileId) {
      throw new BadRequestException('workspaceId or profileId is required');
    }

    if (!entityType) {
      throw new BadRequestException('entityType is required');
    }

    const validSortFields = [
      'impressions', 'clicks', 'spend', 'sales', 'orders', 'units',
      'acos', 'roas', 'ctr', 'cvr', 'cpc', 'cpa', 'avgOrderValue',
    ];

    const sortField = sortBy || 'sales';
    if (!validSortFields.includes(sortField)) {
      throw new BadRequestException(`Invalid sortBy field. Valid fields: ${validSortFields.join(', ')}`);
    }

    this.logger.log(`Fetching top performers for ${entityType} sorted by ${sortField}`);

    const filter: MetricsFilter = {
      workspaceId,
      profileId,
      marketplace,
    };

    if (startDate && endDate) {
      filter.dateRange = {
        startDate,
        endDate,
      };
    }

    return this.metricsService.getTopPerformers(filter, {
      entityType,
      sortBy: sortField as any,
      limit: parseInt(limit || '10', 10),
      order: order || 'desc',
    });
  }

  /**
   * GET /api/metrics/kpis
   * Calcule les KPIs a partir de metriques brutes (utilitaire)
   */
  @Get('kpis')
  calculateKPIs(
    @Query('impressions') impressions?: string,
    @Query('clicks') clicks?: string,
    @Query('spend') spend?: string,
    @Query('sales') sales?: string,
    @Query('orders') orders?: string,
    @Query('units') units?: string,
  ) {
    this.logger.log('Calculating KPIs from raw metrics');

    return this.metricsService.calculateKPIs({
      impressions: parseInt(impressions || '0', 10),
      clicks: parseInt(clicks || '0', 10),
      spend: parseFloat(spend || '0'),
      sales: parseFloat(sales || '0'),
      orders: parseInt(orders || '0', 10),
      units: parseInt(units || '0', 10),
    });
  }

  /**
   * GET /api/metrics/by-marketplace
   * Recupere les metriques groupees par marketplace
   */
  @Get('by-marketplace')
  async getByMarketplace(
    @Query('workspaceId') workspaceId?: string,
    @Query('profileId') profileId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('entityType') entityType?: string,
  ) {
    if (!workspaceId && !profileId) {
      throw new BadRequestException('workspaceId or profileId is required');
    }

    this.logger.log(`Fetching metrics by marketplace for workspace ${workspaceId || 'N/A'}`);

    const filter: MetricsFilter = {
      workspaceId,
      profileId,
      entityType,
    };

    if (startDate && endDate) {
      filter.dateRange = {
        startDate,
        endDate,
      };
    }

    const summary = await this.metricsService.getSummary(filter);
    return summary.byMarketplace || {};
  }

  /**
   * GET /api/metrics/trends
   * Recupere les tendances par rapport a la periode precedente
   */
  @Get('trends')
  async getTrends(
    @Query('workspaceId') workspaceId?: string,
    @Query('profileId') profileId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('entityType') entityType?: string,
    @Query('marketplace') marketplace?: string,
  ) {
    if (!workspaceId && !profileId) {
      throw new BadRequestException('workspaceId or profileId is required');
    }

    this.logger.log(`Fetching trends for workspace ${workspaceId || 'N/A'}`);

    const filter: MetricsFilter = {
      workspaceId,
      profileId,
      entityType,
      marketplace,
    };

    if (startDate && endDate) {
      filter.dateRange = {
        startDate,
        endDate,
      };
    }

    const summary = await this.metricsService.getSummary(filter);
    return {
      currentPeriod: summary.kpis,
      previousPeriod: summary.trends?.previous,
      changes: summary.trends?.changes,
    };
  }

  /**
   * GET /api/metrics/diagnostic/:entityType/:amazonId
   * Endpoint diagnostic : retourne les métriques brutes jour par jour
   * + les agrégations multi-fenêtre (7j, 14j, 30j) pour comparer avec Amazon.
   *
   * Usage: /api/metrics/diagnostic/keyword/123456789
   *        /api/metrics/diagnostic/target/987654321
   */
  @Get('diagnostic/:entityType/:amazonId')
  async getDiagnostic(
    @Param('entityType') entityType: string,
    @Param('amazonId') amazonId: string,
  ) {
    if (!entityType || !amazonId) {
      throw new BadRequestException('entityType and amazonId are required');
    }

    const entityKey = `${entityType}:${amazonId}`;
    this.logger.log(`[DIAGNOSTIC] Fetching raw daily metrics for ${entityKey}`);

    // Compute date ranges
    const now = new Date();
    const startDate30d = new Date(now);
    startDate30d.setDate(startDate30d.getDate() - 29);
    const startDate14d = new Date(now);
    startDate14d.setDate(startDate14d.getDate() - 13);
    const startDate7d = new Date(now);
    startDate7d.setDate(startDate7d.getDate() - 6);

    const endDateStr = now.toISOString().split('T')[0];
    const start30dStr = startDate30d.toISOString().split('T')[0];

    // Fetch ALL raw daily rows for the last 30 days
    const rawRows = await this.db
      .select({
        date: dailyMetrics.date,
        impressions: dailyMetrics.impressions,
        clicks: dailyMetrics.clicks,
        spend: dailyMetrics.spend,
        sales: dailyMetrics.sales,
        orders: dailyMetrics.orders,
        units: dailyMetrics.units,
        impressionShare: dailyMetrics.impressionShare,
        attributionWindow: dailyMetrics.attributionWindow,
        syncedAt: dailyMetrics.syncedAt,
        createdAt: dailyMetrics.createdAt,
      })
      .from(dailyMetrics)
      .where(
        and(
          eq(dailyMetrics.entityType, entityType),
          eq(dailyMetrics.entityKey, entityKey),
          gte(dailyMetrics.date, start30dStr),
          lte(dailyMetrics.date, endDateStr),
        ),
      )
      .orderBy(desc(dailyMetrics.date));

    // Aggregate by window
    const aggregate = (rows: any[], fromDate: string) => {
      let impressions = 0, clicks = 0, spend = 0, sales = 0, orders = 0, units = 0;
      let count = 0;
      for (const r of rows) {
        if (r.date >= fromDate && r.date <= endDateStr) {
          impressions += Number(r.impressions || 0);
          clicks += Number(r.clicks || 0);
          spend += Number(r.spend || 0);
          sales += Number(r.sales || 0);
          orders += Number(r.orders || 0);
          units += Number(r.units || 0);
          count++;
        }
      }
      const acos = sales > 0 ? Math.round((spend / sales) * 10000) / 100 : null;
      const cvr = clicks > 0 ? Math.round((orders / clicks) * 10000) / 100 : null;
      return { impressions, clicks, spend: Math.round(spend * 100) / 100, sales: Math.round(sales * 100) / 100, orders, units, acos, cvr, daysWithData: count };
    };

    const window7d = aggregate(rawRows, startDate7d.toISOString().split('T')[0]);
    const window14d = aggregate(rawRows, startDate14d.toISOString().split('T')[0]);
    const window30d = aggregate(rawRows, start30dStr);

    return {
      entityKey,
      entityType,
      amazonId,
      generatedAt: now.toISOString(),
      dateRange: { start: start30dStr, end: endDateStr },
      windows: {
        '7d': { ...window7d, period: `${startDate7d.toISOString().split('T')[0]} → ${endDateStr}` },
        '14d': { ...window14d, period: `${startDate14d.toISOString().split('T')[0]} → ${endDateStr}` },
        '30d': { ...window30d, period: `${start30dStr} → ${endDateStr}` },
      },
      rawDailyRows: rawRows.map((r: any) => ({
        date: r.date,
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        spend: Number(r.spend || 0),
        sales: Number(r.sales || 0),
        orders: Number(r.orders || 0),
        units: Number(r.units || 0),
        impressionShare: r.impressionShare ? Number(r.impressionShare) : null,
        syncedAt: r.syncedAt,
      })),
      totalRowsInPeriod: rawRows.length,
      _hint: 'Compare ces données avec Amazon Ads pour détecter les écarts. Vérifie aussi /api/metrics/diagnostic/target/{amazonId} si les données ne matchent pas.',
    };
  }
}
