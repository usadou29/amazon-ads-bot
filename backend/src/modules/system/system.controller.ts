import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { SystemService, KillSwitchRequest } from './system.service';
import type { GlobalSettings } from '@/db/schema/system-config';

@Controller()
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

  constructor(private readonly systemService: SystemService) {}

  /**
   * GET /api/health
   * Endpoint de health check
   */
  @Get('api/health')
  async getHealth() {
    this.logger.debug('Health check requested');

    return this.systemService.getHealth();
  }

  /**
   * GET /api/health/db
   * Vérification connexion DB (SELECT 1). Retourne { ok: true } si la DB répond.
   */
  @Get('api/health/db')
  async getHealthDb() {
    this.logger.debug('Health DB check requested');

    return this.systemService.getHealthDb();
  }

  /**
   * GET /api/system/config
   * Recupere la configuration systeme
   */
  @Get('api/system/config')
  async getConfig() {
    this.logger.log('System config requested');

    return this.systemService.getConfig();
  }

  /**
   * POST /api/system/kill-switch
   * Active ou desactive le kill switch
   */
  @Post('api/system/kill-switch')
  async setKillSwitch(@Body() body: KillSwitchRequest) {
    if (typeof body.enabled !== 'boolean') {
      throw new BadRequestException('enabled (boolean) is required');
    }

    this.logger.log(`Kill switch ${body.enabled ? 'activation' : 'deactivation'} requested`);

    return this.systemService.setKillSwitch(body);
  }

  /**
   * GET /api/system/kill-switch
   * Verifie le statut du kill switch
   */
  @Get('api/system/kill-switch')
  async getKillSwitchStatus() {
    this.logger.debug('Kill switch status requested');

    const config = await this.systemService.getConfig();

    return config.killSwitch;
  }

  /**
   * POST /api/system/settings
   * Met a jour les parametres globaux
   */
  @Post('api/system/settings')
  async updateSettings(@Body() body: Partial<GlobalSettings>) {
    this.logger.log('Global settings update requested');

    return this.systemService.updateGlobalSettings(body);
  }

  /**
   * POST /api/system/features
   * Met a jour les feature flags
   */
  @Post('api/system/features')
  async updateFeatures(@Body() body: Record<string, boolean>) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body must be an object with feature flags');
    }

    this.logger.log('Feature flags update requested');

    return this.systemService.updateFeatureFlags(body);
  }

  /**
   * GET /api/system/features/:name
   * Verifie si une feature est active
   */
  @Get('api/system/features/:name')
  async getFeature(@Param('name') name: string) {
    if (!name) {
      throw new BadRequestException('Feature name is required');
    }

    const enabled = await this.systemService.isFeatureEnabled(name);

    return { feature: name, enabled };
  }

  /**
   * POST /api/system/limits
   * Met a jour les rate limits
   */
  @Post('api/system/limits')
  async updateLimits(@Body() body: Record<string, number>) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body must be an object with rate limits');
    }

    // Valider que toutes les valeurs sont des nombres positifs
    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== 'number' || value < 0) {
        throw new BadRequestException(`${key} must be a positive number`);
      }
    }

    this.logger.log('Rate limits update requested');

    return this.systemService.updateRateLimits(body);
  }

  /**
   * POST /api/system/reset
   * Reinitialise la configuration par defaut
   */
  @Post('api/system/reset')
  async resetConfig() {
    this.logger.warn('System configuration reset requested');

    return this.systemService.resetToDefaults();
  }

  /**
   * GET /health (alias court)
   * Alias pour le health check
   */
  @Get('health')
  async getHealthShort() {
    return this.systemService.getHealth();
  }

  /**
   * GET /ready
   * Readiness probe pour Kubernetes
   */
  @Get('ready')
  async getReady() {
    const health = await this.systemService.getHealth();

    if (health.status === 'unhealthy') {
      throw new BadRequestException('Service not ready');
    }

    return { ready: true };
  }

  /**
   * GET /live
   * Liveness probe pour Kubernetes
   */
  @Get('live')
  async getLive() {
    return { live: true, timestamp: new Date().toISOString() };
  }
}
