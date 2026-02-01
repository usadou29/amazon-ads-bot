import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { dailyMetrics, marketplaceProfiles, adAccounts } from '@/db/schema';
import { eq, and, between, sql, gte, lte, inArray } from 'drizzle-orm';

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface MetricsFilter {
  workspaceId?: string;
  profileId?: string;
  entityType?: string;
  entityKey?: string;
  marketplace?: string;
  dateRange?: DateRange;
}

export interface AggregatedMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
}

export interface CalculatedKPIs {
  // Metriques brutes
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
  // KPIs calcules
  acos: number | null;      // Advertising Cost of Sales (spend/sales * 100)
  roas: number | null;      // Return on Ad Spend (sales/spend)
  ctr: number | null;       // Click-Through Rate (clicks/impressions * 100)
  cvr: number | null;       // Conversion Rate (orders/clicks * 100)
  cpc: number | null;       // Cost Per Click (spend/clicks)
  cpa: number | null;       // Cost Per Acquisition (spend/orders)
  avgOrderValue: number | null; // Average Order Value (sales/orders)
}

export interface MetricsSummary {
  period: DateRange;
  kpis: CalculatedKPIs;
  byMarketplace?: Record<string, CalculatedKPIs>;
  byEntityType?: Record<string, CalculatedKPIs>;
  trends?: {
    previous: CalculatedKPIs;
    changes: Record<string, number | null>;
  };
}

export interface EntityMetrics {
  entityType: string;
  entityKey: string;
  kpis: CalculatedKPIs;
  dailyData: {
    date: string;
    kpis: CalculatedKPIs;
  }[];
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
  ) {}

  /**
   * Calcule les KPIs a partir des metriques brutes
   */
  calculateKPIs(metrics: AggregatedMetrics): CalculatedKPIs {
    const { impressions, clicks, spend, sales, orders, units } = metrics;

    return {
      impressions,
      clicks,
      spend,
      sales,
      orders,
      units,
      acos: sales > 0 ? (spend / sales) * 100 : null,
      roas: spend > 0 ? sales / spend : null,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      cvr: clicks > 0 ? (orders / clicks) * 100 : null,
      cpc: clicks > 0 ? spend / clicks : null,
      cpa: orders > 0 ? spend / orders : null,
      avgOrderValue: orders > 0 ? sales / orders : null,
    };
  }

  /**
   * Recupere le resume des metriques pour un workspace
   */
  async getSummary(filter: MetricsFilter): Promise<MetricsSummary> {
    if (!filter.workspaceId && !filter.profileId) {
      throw new BadRequestException('workspaceId or profileId is required');
    }

    const dateRange = filter.dateRange || this.getDefaultDateRange();

    // Recuperer les profile IDs pour le workspace si necessaire
    let profileIds: string[] = [];

    if (filter.workspaceId && !filter.profileId) {
      const profiles = await this.db
        .select({ id: marketplaceProfiles.id })
        .from(marketplaceProfiles)
        .innerJoin(adAccounts, eq(marketplaceProfiles.adAccountId, adAccounts.id))
        .where(eq(adAccounts.workspaceId, filter.workspaceId));

      profileIds = profiles.map((p: { id: string }) => p.id);
    } else if (filter.profileId) {
      profileIds = [filter.profileId];
    }

    if (profileIds.length === 0) {
      return {
        period: dateRange,
        kpis: this.calculateKPIs({
          impressions: 0,
          clicks: 0,
          spend: 0,
          sales: 0,
          orders: 0,
          units: 0,
        }),
      };
    }

    // Agreger les metriques
    const metrics = await this.aggregateMetrics(profileIds, dateRange, filter);

    // Calculer les KPIs globaux
    const kpis = this.calculateKPIs(metrics);

    // Agreger par marketplace si demande
    const byMarketplace = await this.aggregateByMarketplace(profileIds, dateRange, filter);

    // Agreger par type d'entite si demande
    const byEntityType = await this.aggregateByEntityType(profileIds, dateRange, filter);

    // Calculer les tendances (periode precedente)
    const trends = await this.calculateTrends(profileIds, dateRange, filter);

    return {
      period: dateRange,
      kpis,
      byMarketplace,
      byEntityType,
      trends,
    };
  }

  /**
   * Recupere les metriques pour une entite specifique
   */
  async getEntityMetrics(entityType: string, entityKey: string, filter: MetricsFilter): Promise<EntityMetrics> {
    const dateRange = filter.dateRange || this.getDefaultDateRange();

    // Construire les conditions
    const conditions = [
      eq(dailyMetrics.entityType, entityType),
      eq(dailyMetrics.entityKey, entityKey),
      gte(dailyMetrics.date, dateRange.startDate),
      lte(dailyMetrics.date, dateRange.endDate),
    ];

    // Recuperer les metriques journalieres
    const dailyData = await this.db
      .select({
        date: dailyMetrics.date,
        impressions: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        spend: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.spend} AS DECIMAL)), 0)`,
        sales: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.sales} AS DECIMAL)), 0)`,
        orders: sql<number>`COALESCE(SUM(${dailyMetrics.orders}), 0)`,
        units: sql<number>`COALESCE(SUM(${dailyMetrics.units}), 0)`,
      })
      .from(dailyMetrics)
      .where(and(...conditions))
      .groupBy(dailyMetrics.date)
      .orderBy(dailyMetrics.date);

    // Agreger les totaux
    const totals = dailyData.reduce(
      (acc: AggregatedMetrics, row: any) => ({
        impressions: acc.impressions + Number(row.impressions),
        clicks: acc.clicks + Number(row.clicks),
        spend: acc.spend + Number(row.spend),
        sales: acc.sales + Number(row.sales),
        orders: acc.orders + Number(row.orders),
        units: acc.units + Number(row.units),
      }),
      { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, units: 0 },
    );

    return {
      entityType,
      entityKey,
      kpis: this.calculateKPIs(totals),
      dailyData: dailyData.map((row: any) => ({
        date: row.date,
        kpis: this.calculateKPIs({
          impressions: Number(row.impressions),
          clicks: Number(row.clicks),
          spend: Number(row.spend),
          sales: Number(row.sales),
          orders: Number(row.orders),
          units: Number(row.units),
        }),
      })),
    };
  }

  /**
   * Agregation des metriques pour une liste de profiles
   */
  private async aggregateMetrics(
    profileIds: string[],
    dateRange: DateRange,
    filter: MetricsFilter,
  ): Promise<AggregatedMetrics> {
    const conditions = [
      inArray(dailyMetrics.profileId, profileIds),
      gte(dailyMetrics.date, dateRange.startDate),
      lte(dailyMetrics.date, dateRange.endDate),
    ];

    if (filter.entityType) {
      conditions.push(eq(dailyMetrics.entityType, filter.entityType));
    }

    if (filter.marketplace) {
      conditions.push(eq(dailyMetrics.marketplace, filter.marketplace));
    }

    const [result] = await this.db
      .select({
        impressions: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        spend: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.spend} AS DECIMAL)), 0)`,
        sales: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.sales} AS DECIMAL)), 0)`,
        orders: sql<number>`COALESCE(SUM(${dailyMetrics.orders}), 0)`,
        units: sql<number>`COALESCE(SUM(${dailyMetrics.units}), 0)`,
      })
      .from(dailyMetrics)
      .where(and(...conditions));

    return {
      impressions: Number(result?.impressions || 0),
      clicks: Number(result?.clicks || 0),
      spend: Number(result?.spend || 0),
      sales: Number(result?.sales || 0),
      orders: Number(result?.orders || 0),
      units: Number(result?.units || 0),
    };
  }

  /**
   * Agregation par marketplace
   */
  private async aggregateByMarketplace(
    profileIds: string[],
    dateRange: DateRange,
    filter: MetricsFilter,
  ): Promise<Record<string, CalculatedKPIs>> {
    const conditions = [
      inArray(dailyMetrics.profileId, profileIds),
      gte(dailyMetrics.date, dateRange.startDate),
      lte(dailyMetrics.date, dateRange.endDate),
    ];

    if (filter.entityType) {
      conditions.push(eq(dailyMetrics.entityType, filter.entityType));
    }

    const results = await this.db
      .select({
        marketplace: dailyMetrics.marketplace,
        impressions: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        spend: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.spend} AS DECIMAL)), 0)`,
        sales: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.sales} AS DECIMAL)), 0)`,
        orders: sql<number>`COALESCE(SUM(${dailyMetrics.orders}), 0)`,
        units: sql<number>`COALESCE(SUM(${dailyMetrics.units}), 0)`,
      })
      .from(dailyMetrics)
      .where(and(...conditions))
      .groupBy(dailyMetrics.marketplace);

    const byMarketplace: Record<string, CalculatedKPIs> = {};

    for (const row of results) {
      byMarketplace[row.marketplace] = this.calculateKPIs({
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        spend: Number(row.spend),
        sales: Number(row.sales),
        orders: Number(row.orders),
        units: Number(row.units),
      });
    }

    return byMarketplace;
  }

  /**
   * Agregation par type d'entite
   */
  private async aggregateByEntityType(
    profileIds: string[],
    dateRange: DateRange,
    filter: MetricsFilter,
  ): Promise<Record<string, CalculatedKPIs>> {
    const conditions = [
      inArray(dailyMetrics.profileId, profileIds),
      gte(dailyMetrics.date, dateRange.startDate),
      lte(dailyMetrics.date, dateRange.endDate),
    ];

    if (filter.marketplace) {
      conditions.push(eq(dailyMetrics.marketplace, filter.marketplace));
    }

    const results = await this.db
      .select({
        entityType: dailyMetrics.entityType,
        impressions: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        spend: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.spend} AS DECIMAL)), 0)`,
        sales: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.sales} AS DECIMAL)), 0)`,
        orders: sql<number>`COALESCE(SUM(${dailyMetrics.orders}), 0)`,
        units: sql<number>`COALESCE(SUM(${dailyMetrics.units}), 0)`,
      })
      .from(dailyMetrics)
      .where(and(...conditions))
      .groupBy(dailyMetrics.entityType);

    const byEntityType: Record<string, CalculatedKPIs> = {};

    for (const row of results) {
      byEntityType[row.entityType] = this.calculateKPIs({
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        spend: Number(row.spend),
        sales: Number(row.sales),
        orders: Number(row.orders),
        units: Number(row.units),
      });
    }

    return byEntityType;
  }

  /**
   * Calcule les tendances par rapport a la periode precedente
   */
  private async calculateTrends(
    profileIds: string[],
    dateRange: DateRange,
    filter: MetricsFilter,
  ): Promise<{ previous: CalculatedKPIs; changes: Record<string, number | null> }> {
    // Calculer la periode precedente
    const startDate = new Date(dateRange.startDate);
    const endDate = new Date(dateRange.endDate);
    const periodLength = endDate.getTime() - startDate.getTime();

    const previousStartDate = new Date(startDate.getTime() - periodLength - 86400000);
    const previousEndDate = new Date(startDate.getTime() - 86400000);

    const previousDateRange: DateRange = {
      startDate: previousStartDate.toISOString().split('T')[0],
      endDate: previousEndDate.toISOString().split('T')[0],
    };

    // Recuperer les metriques de la periode precedente
    const previousMetrics = await this.aggregateMetrics(profileIds, previousDateRange, filter);
    const currentMetrics = await this.aggregateMetrics(profileIds, dateRange, filter);

    const previous = this.calculateKPIs(previousMetrics);
    const current = this.calculateKPIs(currentMetrics);

    // Calculer les variations en pourcentage
    const calculateChange = (current: number | null, previous: number | null): number | null => {
      if (previous === null || previous === 0 || current === null) {
        return null;
      }
      return ((current - previous) / previous) * 100;
    };

    const changes: Record<string, number | null> = {
      impressions: calculateChange(current.impressions, previous.impressions),
      clicks: calculateChange(current.clicks, previous.clicks),
      spend: calculateChange(current.spend, previous.spend),
      sales: calculateChange(current.sales, previous.sales),
      orders: calculateChange(current.orders, previous.orders),
      acos: calculateChange(current.acos, previous.acos),
      roas: calculateChange(current.roas, previous.roas),
      ctr: calculateChange(current.ctr, previous.ctr),
      cvr: calculateChange(current.cvr, previous.cvr),
      cpc: calculateChange(current.cpc, previous.cpc),
    };

    return { previous, changes };
  }

  /**
   * Retourne la plage de dates par defaut (30 derniers jours)
   */
  private getDefaultDateRange(): DateRange {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };
  }

  /**
   * Recupere les top performers pour un workspace
   */
  async getTopPerformers(
    filter: MetricsFilter,
    options: { entityType: string; sortBy: keyof CalculatedKPIs; limit: number; order: 'asc' | 'desc' },
  ): Promise<{ entityKey: string; kpis: CalculatedKPIs }[]> {
    if (!filter.workspaceId && !filter.profileId) {
      throw new BadRequestException('workspaceId or profileId is required');
    }

    const dateRange = filter.dateRange || this.getDefaultDateRange();

    // Recuperer les profile IDs pour le workspace si necessaire
    let profileIds: string[] = [];

    if (filter.workspaceId && !filter.profileId) {
      const profiles = await this.db
        .select({ id: marketplaceProfiles.id })
        .from(marketplaceProfiles)
        .innerJoin(adAccounts, eq(marketplaceProfiles.adAccountId, adAccounts.id))
        .where(eq(adAccounts.workspaceId, filter.workspaceId));

      profileIds = profiles.map((p: { id: string }) => p.id);
    } else if (filter.profileId) {
      profileIds = [filter.profileId];
    }

    if (profileIds.length === 0) {
      return [];
    }

    const conditions = [
      inArray(dailyMetrics.profileId, profileIds),
      eq(dailyMetrics.entityType, options.entityType),
      gte(dailyMetrics.date, dateRange.startDate),
      lte(dailyMetrics.date, dateRange.endDate),
    ];

    if (filter.marketplace) {
      conditions.push(eq(dailyMetrics.marketplace, filter.marketplace));
    }

    const results = await this.db
      .select({
        entityKey: dailyMetrics.entityKey,
        impressions: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        spend: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.spend} AS DECIMAL)), 0)`,
        sales: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.sales} AS DECIMAL)), 0)`,
        orders: sql<number>`COALESCE(SUM(${dailyMetrics.orders}), 0)`,
        units: sql<number>`COALESCE(SUM(${dailyMetrics.units}), 0)`,
      })
      .from(dailyMetrics)
      .where(and(...conditions))
      .groupBy(dailyMetrics.entityKey);

    // Calculer les KPIs et trier
    const withKPIs = results.map((row: any) => ({
      entityKey: row.entityKey,
      kpis: this.calculateKPIs({
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        spend: Number(row.spend),
        sales: Number(row.sales),
        orders: Number(row.orders),
        units: Number(row.units),
      }),
    }));

    // Trier selon le KPI demande
    withKPIs.sort((a: any, b: any) => {
      const aValue = a.kpis[options.sortBy] ?? 0;
      const bValue = b.kpis[options.sortBy] ?? 0;
      return options.order === 'asc' ? aValue - bValue : bValue - aValue;
    });

    return withKPIs.slice(0, options.limit);
  }
}
