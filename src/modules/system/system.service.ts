import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { systemConfig } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { KillSwitchConfig, GlobalSettings } from '@/db/schema/system-config';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: HealthCheckResult;
    memory: HealthCheckResult;
    config: HealthCheckResult;
  };
}

export interface HealthCheckResult {
  status: 'ok' | 'warning' | 'error';
  message?: string;
  details?: Record<string, any>;
}

export interface SystemConfigResponse {
  killSwitch: KillSwitchConfig;
  globalSettings: GlobalSettings;
  features: Record<string, boolean>;
  limits: Record<string, number>;
}

export interface KillSwitchRequest {
  enabled: boolean;
  reason?: string;
  enabledBy?: string;
}

const CONFIG_KEYS = {
  KILL_SWITCH: 'kill_switch',
  GLOBAL_SETTINGS: 'global_settings',
  FEATURE_FLAGS: 'feature_flags',
  RATE_LIMITS: 'rate_limits',
} as const;

const DEFAULT_KILL_SWITCH: KillSwitchConfig = {
  enabled: false,
  reason: null,
  enabled_at: null,
  enabled_by: null,
};

const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  dry_run: false,
  max_actions_per_day: 1000,
};

const DEFAULT_FEATURE_FLAGS: Record<string, boolean> = {
  sync_enabled: true,
  recommendations_enabled: true,
  auto_execute_enabled: false,
  alerts_enabled: true,
  search_terms_sync: true,
};

const DEFAULT_RATE_LIMITS: Record<string, number> = {
  api_requests_per_minute: 60,
  sync_batch_size: 100,
  max_concurrent_syncs: 5,
  recommendation_batch_size: 50,
};

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);
  private readonly startTime: Date;

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
    private configService: ConfigService,
  ) {
    this.startTime = new Date();
  }

  /**
   * Vérification minimale DB : SELECT 1.
   * Utilisé par GET /api/health/db pour retourner { ok: true }. Lance si la DB ne répond pas.
   */
  async getHealthDb(): Promise<{ ok: boolean }> {
    const result = await this.checkDatabase();
    if (result.status !== 'ok') {
      throw new Error(result.message ?? 'Database connection failed');
    }
    return { ok: true };
  }

  /**
   * Verifie l'etat de sante du systeme
   */
  async getHealth(): Promise<HealthStatus> {
    const checks = {
      database: await this.checkDatabase(),
      memory: this.checkMemory(),
      config: this.checkConfig(),
    };

    // Determiner le statut global
    let status: HealthStatus['status'] = 'healthy';

    const hasError = Object.values(checks).some(c => c.status === 'error');
    const hasWarning = Object.values(checks).some(c => c.status === 'warning');

    if (hasError) {
      status = 'unhealthy';
    } else if (hasWarning) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      checks,
    };
  }

  /**
   * Recupere la configuration systeme
   */
  async getConfig(): Promise<SystemConfigResponse> {
    const killSwitch = await this.getConfigValue<KillSwitchConfig>(
      CONFIG_KEYS.KILL_SWITCH,
      DEFAULT_KILL_SWITCH,
    );

    const globalSettings = await this.getConfigValue<GlobalSettings>(
      CONFIG_KEYS.GLOBAL_SETTINGS,
      DEFAULT_GLOBAL_SETTINGS,
    );

    const features = await this.getConfigValue<Record<string, boolean>>(
      CONFIG_KEYS.FEATURE_FLAGS,
      DEFAULT_FEATURE_FLAGS,
    );

    const limits = await this.getConfigValue<Record<string, number>>(
      CONFIG_KEYS.RATE_LIMITS,
      DEFAULT_RATE_LIMITS,
    );

    return {
      killSwitch,
      globalSettings,
      features,
      limits,
    };
  }

  /**
   * Active ou desactive le kill switch
   */
  async setKillSwitch(request: KillSwitchRequest): Promise<KillSwitchConfig> {
    const config: KillSwitchConfig = {
      enabled: request.enabled,
      reason: request.enabled ? (request.reason || 'Manual activation') : null,
      enabled_at: request.enabled ? new Date().toISOString() : null,
      enabled_by: request.enabled ? (request.enabledBy || 'system') : null,
    };

    await this.setConfigValue(CONFIG_KEYS.KILL_SWITCH, config);

    if (request.enabled) {
      this.logger.warn(`Kill switch ACTIVATED by ${config.enabled_by}: ${config.reason}`);
    } else {
      this.logger.log('Kill switch DEACTIVATED');
    }

    return config;
  }

  /**
   * Verifie si le kill switch est actif
   */
  async isKillSwitchActive(): Promise<boolean> {
    const config = await this.getConfigValue<KillSwitchConfig>(
      CONFIG_KEYS.KILL_SWITCH,
      DEFAULT_KILL_SWITCH,
    );
    return config.enabled;
  }

  /**
   * Met a jour les parametres globaux
   */
  async updateGlobalSettings(settings: Partial<GlobalSettings>): Promise<GlobalSettings> {
    const current = await this.getConfigValue<GlobalSettings>(
      CONFIG_KEYS.GLOBAL_SETTINGS,
      DEFAULT_GLOBAL_SETTINGS,
    );

    const updated: GlobalSettings = {
      ...current,
      ...settings,
    };

    await this.setConfigValue(CONFIG_KEYS.GLOBAL_SETTINGS, updated);

    this.logger.log(`Global settings updated: ${JSON.stringify(settings)}`);

    return updated;
  }

  /**
   * Met a jour les feature flags
   */
  async updateFeatureFlags(flags: Record<string, boolean>): Promise<Record<string, boolean>> {
    const current = await this.getConfigValue<Record<string, boolean>>(
      CONFIG_KEYS.FEATURE_FLAGS,
      DEFAULT_FEATURE_FLAGS,
    );

    const updated = {
      ...current,
      ...flags,
    };

    await this.setConfigValue(CONFIG_KEYS.FEATURE_FLAGS, updated);

    this.logger.log(`Feature flags updated: ${JSON.stringify(flags)}`);

    return updated;
  }

  /**
   * Met a jour les rate limits
   */
  async updateRateLimits(limits: Record<string, number>): Promise<Record<string, number>> {
    const current = await this.getConfigValue<Record<string, number>>(
      CONFIG_KEYS.RATE_LIMITS,
      DEFAULT_RATE_LIMITS,
    );

    const updated = {
      ...current,
      ...limits,
    };

    await this.setConfigValue(CONFIG_KEYS.RATE_LIMITS, updated);

    this.logger.log(`Rate limits updated: ${JSON.stringify(limits)}`);

    return updated;
  }

  /**
   * Verifie si une feature est active
   */
  async isFeatureEnabled(featureName: string): Promise<boolean> {
    const features = await this.getConfigValue<Record<string, boolean>>(
      CONFIG_KEYS.FEATURE_FLAGS,
      DEFAULT_FEATURE_FLAGS,
    );
    return features[featureName] ?? false;
  }

  /**
   * Recupere une valeur de configuration
   */
  private async getConfigValue<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const [result] = await this.db
        .select()
        .from(systemConfig)
        .where(eq(systemConfig.key, key))
        .limit(1);

      if (result && result.value) {
        return result.value as T;
      }

      return defaultValue;
    } catch (error) {
      this.logger.warn(`Failed to get config ${key}, using default: ${error}`);
      return defaultValue;
    }
  }

  /**
   * Met a jour une valeur de configuration
   */
  private async setConfigValue<T>(key: string, value: T): Promise<void> {
    await this.db
      .insert(systemConfig)
      .values({
        key,
        value,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: {
          value,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Verifie la connexion a la base de donnees
   */
  private async checkDatabase(): Promise<HealthCheckResult> {
    try {
      const result = await this.db.execute(sql`SELECT 1 as check`);

      if (result) {
        return {
          status: 'ok',
          message: 'Database connection successful',
        };
      }

      return {
        status: 'error',
        message: 'Database query returned unexpected result',
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Verifie l'utilisation memoire
   */
  private checkMemory(): HealthCheckResult {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
    const usagePercent = Math.round((used.heapUsed / used.heapTotal) * 100);

    const details = {
      heapUsedMB,
      heapTotalMB,
      usagePercent,
      rssMB: Math.round(used.rss / 1024 / 1024),
    };

    if (usagePercent > 90) {
      return {
        status: 'error',
        message: `Memory usage critical: ${usagePercent}%`,
        details,
      };
    }

    if (usagePercent > 75) {
      return {
        status: 'warning',
        message: `Memory usage high: ${usagePercent}%`,
        details,
      };
    }

    return {
      status: 'ok',
      message: `Memory usage normal: ${usagePercent}%`,
      details,
    };
  }

  /**
   * Verifie la configuration
   */
  private checkConfig(): HealthCheckResult {
    const requiredEnvVars = [
      'DATABASE_URL',
      'AMAZON_CLIENT_ID',
      'AMAZON_CLIENT_SECRET',
    ];

    const missing = requiredEnvVars.filter(v => !process.env[v]);

    if (missing.length > 0) {
      return {
        status: 'error',
        message: `Missing required environment variables: ${missing.join(', ')}`,
        details: { missing },
      };
    }

    // Verifier les variables optionnelles
    const optionalEnvVars = [
      'TELEGRAM_BOT_TOKEN',
      'ENCRYPTION_KEY',
    ];

    const missingOptional = optionalEnvVars.filter(v => !process.env[v]);

    if (missingOptional.length > 0) {
      return {
        status: 'warning',
        message: `Some optional environment variables are not set: ${missingOptional.join(', ')}`,
        details: { missingOptional },
      };
    }

    return {
      status: 'ok',
      message: 'All configuration variables are set',
    };
  }

  /**
   * Reinitialise la configuration par defaut
   */
  async resetToDefaults(): Promise<SystemConfigResponse> {
    await this.setConfigValue(CONFIG_KEYS.KILL_SWITCH, DEFAULT_KILL_SWITCH);
    await this.setConfigValue(CONFIG_KEYS.GLOBAL_SETTINGS, DEFAULT_GLOBAL_SETTINGS);
    await this.setConfigValue(CONFIG_KEYS.FEATURE_FLAGS, DEFAULT_FEATURE_FLAGS);
    await this.setConfigValue(CONFIG_KEYS.RATE_LIMITS, DEFAULT_RATE_LIMITS);

    this.logger.log('System configuration reset to defaults');

    return this.getConfig();
  }
}
