// ============================================
// LOGGER UTILITAIRE
// ============================================

import { Logger } from '@nestjs/common';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  module?: string;
  action?: string;
  entityType?: string;
  entityKey?: string;
  workspaceId?: string;
  profileId?: string;
  [key: string]: unknown;
}

class AppLogger {
  private logger: Logger;

  constructor(context?: string) {
    this.logger = new Logger(context || 'App');
  }

  private formatMessage(message: string, context?: LogContext): string {
    if (!context) return message;

    const contextStr = Object.entries(context)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');

    return contextStr ? `${message} | ${contextStr}` : message;
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(this.formatMessage(message, context));
  }

  info(message: string, context?: LogContext): void {
    this.logger.log(this.formatMessage(message, context));
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(this.formatMessage(message, context));
  }

  error(message: string, error?: Error, context?: LogContext): void {
    const fullContext = {
      ...context,
      error: error?.message,
      stack: error?.stack,
    };
    this.logger.error(this.formatMessage(message, fullContext));
  }

  /**
   * Crée un logger avec contexte pré-défini
   */
  child(context: LogContext): ChildLogger {
    return new ChildLogger(this, context);
  }
}

class ChildLogger {
  constructor(
    private parent: AppLogger,
    private baseContext: LogContext,
  ) {}

  private mergeContext(context?: LogContext): LogContext {
    return { ...this.baseContext, ...context };
  }

  debug(message: string, context?: LogContext): void {
    this.parent.debug(message, this.mergeContext(context));
  }

  info(message: string, context?: LogContext): void {
    this.parent.info(message, this.mergeContext(context));
  }

  warn(message: string, context?: LogContext): void {
    this.parent.warn(message, this.mergeContext(context));
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.parent.error(message, error, this.mergeContext(context));
  }
}

// Factory function
export function createLogger(context?: string): AppLogger {
  return new AppLogger(context);
}

// Export default logger
export const logger = createLogger();
