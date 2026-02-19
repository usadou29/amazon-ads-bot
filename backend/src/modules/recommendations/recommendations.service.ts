import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { recommendations, rules, actionLog } from '@/db/schema';
import { eq, and, inArray, desc, gte, lte, sql, or } from 'drizzle-orm';
import type { Recommendation, NewRecommendation, RecommendationStatus } from '@/db/schema/recommendations';

export interface RecommendationFilter {
  workspaceId: string;
  status?: RecommendationStatus | RecommendationStatus[];
  entityType?: string;
  ruleId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface RecommendationListResult {
  items: RecommendationWithRule[];
  total: number;
  limit: number;
  offset: number;
}

export interface RecommendationWithRule extends Recommendation {
  rule?: {
    id: string;
    name: string;
    type: string;
  } | null;
}

export interface ApproveRecommendationDto {
  reviewedBy?: string;
  notes?: string;
}

export interface RejectRecommendationDto {
  reviewedBy?: string;
  reason?: string;
}

export interface CreateRecommendationDto {
  workspaceId: string;
  ruleId?: string;
  entityType: string;
  entityKey: string;
  actionType: string;
  suggestedAction: Record<string, any>;
  contextData?: Record<string, any>;
  confidenceScore?: number;
  ruleSnapshot?: Record<string, any>;
  expiresAt?: Date;
}

export interface BulkApproveResult {
  approved: number;
  failed: number;
  errors: { id: string; error: string }[];
}

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
  ) {}

  /**
   * Recupere les recommandations avec filtres
   */
  async findAll(filter: RecommendationFilter): Promise<RecommendationListResult> {
    const conditions = [eq(recommendations.workspaceId, filter.workspaceId)];

    if (filter.status) {
      if (Array.isArray(filter.status)) {
        conditions.push(inArray(recommendations.status, filter.status));
      } else {
        conditions.push(eq(recommendations.status, filter.status));
      }
    }

    if (filter.entityType) {
      conditions.push(eq(recommendations.entityType, filter.entityType));
    }

    if (filter.ruleId) {
      conditions.push(eq(recommendations.ruleId, filter.ruleId));
    }

    if (filter.startDate) {
      conditions.push(gte(recommendations.createdAt, new Date(filter.startDate)));
    }

    if (filter.endDate) {
      conditions.push(lte(recommendations.createdAt, new Date(filter.endDate)));
    }

    const limit = filter.limit || 50;
    const offset = filter.offset || 0;

    // Recuperer le total
    const [countResult] = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(recommendations)
      .where(and(...conditions));

    const total = Number(countResult?.count || 0);

    // Recuperer les recommandations avec les infos de la regle
    const items = await this.db
      .select({
        recommendation: recommendations,
        rule: {
          id: rules.id,
          name: rules.name,
          type: rules.ruleType,
        },
      })
      .from(recommendations)
      .leftJoin(rules, eq(recommendations.ruleId, rules.id))
      .where(and(...conditions))
      .orderBy(desc(recommendations.createdAt))
      .limit(limit)
      .offset(offset);

    const result: RecommendationWithRule[] = items.map((item: any) => ({
      ...item.recommendation,
      rule: item.rule?.id ? item.rule : null,
    }));

    return {
      items: result,
      total,
      limit,
      offset,
    };
  }

  /**
   * Recupere une recommandation par ID
   */
  async findOne(id: string): Promise<RecommendationWithRule> {
    const [result] = await this.db
      .select({
        recommendation: recommendations,
        rule: {
          id: rules.id,
          name: rules.name,
          type: rules.ruleType,
        },
      })
      .from(recommendations)
      .leftJoin(rules, eq(recommendations.ruleId, rules.id))
      .where(eq(recommendations.id, id))
      .limit(1);

    if (!result) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }

    return {
      ...result.recommendation,
      rule: result.rule?.id ? result.rule : null,
    };
  }

  /**
   * Cree une nouvelle recommandation
   */
  async create(dto: CreateRecommendationDto): Promise<Recommendation> {
    const [recommendation] = await this.db
      .insert(recommendations)
      .values({
        workspaceId: dto.workspaceId,
        ruleId: dto.ruleId,
        entityType: dto.entityType,
        entityKey: dto.entityKey,
        actionType: dto.actionType,
        suggestedAction: dto.suggestedAction,
        contextData: dto.contextData,
        confidenceScore: dto.confidenceScore?.toString(),
        ruleSnapshot: dto.ruleSnapshot,
        status: 'pending',
        expiresAt: dto.expiresAt,
      })
      .returning();

    this.logger.log(`Created recommendation ${recommendation.id} for ${dto.entityType}:${dto.entityKey}`);

    return recommendation;
  }

  /**
   * Approuve une recommandation
   */
  async approve(id: string, dto: ApproveRecommendationDto): Promise<Recommendation> {
    const [existing] = await this.db
      .select()
      .from(recommendations)
      .where(eq(recommendations.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }

    if (existing.status !== 'pending') {
      throw new BadRequestException(`Recommendation ${id} is not pending (current status: ${existing.status})`);
    }

    // Verifier si elle n'est pas expiree
    if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
      await this.db
        .update(recommendations)
        .set({ status: 'expired', reviewedAt: new Date() })
        .where(eq(recommendations.id, id));

      throw new BadRequestException(`Recommendation ${id} has expired`);
    }

    const [updated] = await this.db
      .update(recommendations)
      .set({
        status: 'approved',
        reviewedAt: new Date(),
        reviewedBy: dto.reviewedBy || 'user',
      })
      .where(eq(recommendations.id, id))
      .returning();

    this.logger.log(`Approved recommendation ${id} by ${dto.reviewedBy || 'user'}`);

    return updated;
  }

  /**
   * Rejette une recommandation
   */
  async reject(id: string, dto: RejectRecommendationDto): Promise<Recommendation> {
    const [existing] = await this.db
      .select()
      .from(recommendations)
      .where(eq(recommendations.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }

    if (existing.status !== 'pending') {
      throw new BadRequestException(`Recommendation ${id} is not pending (current status: ${existing.status})`);
    }

    // Ajouter la raison du rejet dans contextData
    const contextData = {
      ...(existing.contextData as Record<string, any> || {}),
      rejectionReason: dto.reason,
    };

    const [updated] = await this.db
      .update(recommendations)
      .set({
        status: 'rejected',
        reviewedAt: new Date(),
        reviewedBy: dto.reviewedBy || 'user',
        contextData,
      })
      .where(eq(recommendations.id, id))
      .returning();

    this.logger.log(`Rejected recommendation ${id} by ${dto.reviewedBy || 'user'}: ${dto.reason || 'No reason'}`);

    return updated;
  }

  /**
   * Approuve plusieurs recommandations en masse
   */
  async bulkApprove(ids: string[], dto: ApproveRecommendationDto): Promise<BulkApproveResult> {
    const result: BulkApproveResult = {
      approved: 0,
      failed: 0,
      errors: [],
    };

    for (const id of ids) {
      try {
        await this.approve(id, dto);
        result.approved++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(`Bulk approve completed: ${result.approved} approved, ${result.failed} failed`);

    return result;
  }

  /**
   * Rejette plusieurs recommandations en masse
   */
  async bulkReject(ids: string[], dto: RejectRecommendationDto): Promise<BulkApproveResult> {
    const result: BulkApproveResult = {
      approved: 0,
      failed: 0,
      errors: [],
    };

    for (const id of ids) {
      try {
        await this.reject(id, dto);
        result.approved++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(`Bulk reject completed: ${result.approved} rejected, ${result.failed} failed`);

    return result;
  }

  /**
   * Marque une recommandation comme executee
   */
  async markAsExecuted(id: string, actionId: string): Promise<Recommendation> {
    const [existing] = await this.db
      .select()
      .from(recommendations)
      .where(eq(recommendations.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }

    if (existing.status !== 'approved') {
      throw new BadRequestException(`Recommendation ${id} is not approved (current status: ${existing.status})`);
    }

    const [updated] = await this.db
      .update(recommendations)
      .set({
        status: 'executed',
        actionId,
      })
      .where(eq(recommendations.id, id))
      .returning();

    this.logger.log(`Recommendation ${id} marked as executed (action: ${actionId})`);

    return updated;
  }

  /**
   * Expire les recommandations dont la date d'expiration est passee
   */
  async expireOldRecommendations(): Promise<number> {
    const result = await this.db
      .update(recommendations)
      .set({ status: 'expired' })
      .where(
        and(
          eq(recommendations.status, 'pending'),
          lte(recommendations.expiresAt, new Date()),
        ),
      );

    const count = result.rowCount || 0;

    if (count > 0) {
      this.logger.log(`Expired ${count} old recommendations`);
    }

    return count;
  }

  /**
   * Recupere les statistiques des recommandations
   */
  async getStats(workspaceId: string): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    executed: number;
    expired: number;
    byEntityType: Record<string, number>;
    byActionType: Record<string, number>;
  }> {
    const statuses = ['pending', 'approved', 'rejected', 'executed', 'expired', 'skipped'];

    // Compter par statut
    const statusCounts = await this.db
      .select({
        status: recommendations.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(recommendations)
      .where(eq(recommendations.workspaceId, workspaceId))
      .groupBy(recommendations.status);

    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) {
      statusMap[row.status || 'unknown'] = Number(row.count);
    }

    // Compter par type d'entite
    const entityTypeCounts = await this.db
      .select({
        entityType: recommendations.entityType,
        count: sql<number>`COUNT(*)`,
      })
      .from(recommendations)
      .where(eq(recommendations.workspaceId, workspaceId))
      .groupBy(recommendations.entityType);

    const byEntityType: Record<string, number> = {};
    for (const row of entityTypeCounts) {
      byEntityType[row.entityType] = Number(row.count);
    }

    // Compter par type d'action
    const actionTypeCounts = await this.db
      .select({
        actionType: recommendations.actionType,
        count: sql<number>`COUNT(*)`,
      })
      .from(recommendations)
      .where(eq(recommendations.workspaceId, workspaceId))
      .groupBy(recommendations.actionType);

    const byActionType: Record<string, number> = {};
    for (const row of actionTypeCounts) {
      byActionType[row.actionType] = Number(row.count);
    }

    const total = Object.values(statusMap).reduce((a, b) => a + b, 0);

    return {
      total,
      pending: statusMap.pending || 0,
      approved: statusMap.approved || 0,
      rejected: statusMap.rejected || 0,
      executed: statusMap.executed || 0,
      expired: statusMap.expired || 0,
      byEntityType,
      byActionType,
    };
  }

  /**
   * Supprime les anciennes recommandations (nettoyage)
   */
  async cleanupOld(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.db
      .delete(recommendations)
      .where(
        and(
          inArray(recommendations.status, ['rejected', 'executed', 'expired', 'skipped']),
          lte(recommendations.createdAt, cutoffDate),
        ),
      );

    const count = result.rowCount || 0;

    if (count > 0) {
      this.logger.log(`Cleaned up ${count} old recommendations (older than ${daysToKeep} days)`);
    }

    return count;
  }

  /**
   * Skip une recommandation (similaire a reject mais sans raison obligatoire)
   */
  async skip(id: string, reviewedBy?: string): Promise<Recommendation> {
    const [existing] = await this.db
      .select()
      .from(recommendations)
      .where(eq(recommendations.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }

    if (existing.status !== 'pending') {
      throw new BadRequestException(`Recommendation ${id} is not pending (current status: ${existing.status})`);
    }

    const [updated] = await this.db
      .update(recommendations)
      .set({
        status: 'skipped',
        reviewedAt: new Date(),
        reviewedBy: reviewedBy || 'user',
      })
      .where(eq(recommendations.id, id))
      .returning();

    this.logger.log(`Skipped recommendation ${id}`);

    return updated;
  }
}
