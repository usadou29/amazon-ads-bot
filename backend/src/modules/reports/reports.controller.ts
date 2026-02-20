import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import type { ReportType } from '@/db/schema/report-jobs';

@Controller('api/reports')
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(private readonly reportsService: ReportsService) {}

  // ── POST /api/reports/request ──────────────────────────

  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestReports(
    @Body()
    body: {
      adAccountId: string;
      daysBack?: number;
      reportTypes?: ReportType[];
    },
  ) {
    if (!body.adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    const validTypes = ['campaigns', 'ad_groups', 'keywords', 'targets', 'search_terms'];
    if (body.reportTypes) {
      for (const rt of body.reportTypes) {
        if (!validTypes.includes(rt)) {
          throw new BadRequestException(
            `Invalid reportType "${rt}". Valid: ${validTypes.join(', ')}`,
          );
        }
      }
    }

    try {
      const result = await this.reportsService.requestReportsForAccount(
        body.adAccountId,
        {
          daysBack: body.daysBack ?? 30,
          reportTypes: body.reportTypes,
        },
      );

      return {
        message: `${result.jobs.length} report(s) requested, ${result.skipped.length} skipped`,
        jobs: result.jobs.map((j) => ({
          id: j.id,
          reportType: j.reportType,
          status: j.status,
          dateFrom: j.dateFrom,
          dateTo: j.dateTo,
          amazonReportId: j.amazonReportId,
          requestedAt: j.requestedAt,
        })),
        skipped: result.skipped,
      };
    } catch (error) {
      this.logger.error(`Error requesting reports: ${error}`);
      throw new BadRequestException(
        `Failed to request reports: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // ── GET /api/reports/:id/status ────────────────────────

  @Get(':id/status')
  async getReportStatus(@Param('id') reportJobId: string) {
    try {
      const job = await this.reportsService.getReportJobStatus(reportJobId);
      return job;
    } catch (error) {
      throw new NotFoundException(
        `Report job not found: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // ── POST /api/reports/process ──────────────────────────

  @Post('process')
  @HttpCode(HttpStatus.OK)
  async processReports(
    @Body()
    body?: {
      maxAgeMinutes?: number;
    },
  ) {
    try {
      const result = await this.reportsService.processAllPendingReports({
        maxAgeMinutes: body?.maxAgeMinutes ?? 1440,
      });

      return {
        message: `Processing complete: ${result.completed} ingested, ${result.failed} failed`,
        ...result,
      };
    } catch (error) {
      this.logger.error(`Error processing reports: ${error}`);
      throw new BadRequestException(
        `Failed to process reports: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
