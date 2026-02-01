import {
  Controller,
  Get,
  Query,
  Param,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { MetricsService, MetricsFilter, DateRange } from './metrics.service';

@Controller('api/metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metricsService: MetricsService) {}

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
}
