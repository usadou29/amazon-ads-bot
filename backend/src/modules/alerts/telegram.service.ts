import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';

// Types de severite (export SEVERITY_LEVELS only; Severity exported from alerts.service / db/schema)
export const SEVERITY_LEVELS = ['info', 'warning', 'error', 'critical'] as const;
type Severity = (typeof SEVERITY_LEVELS)[number];

// Emojis par severite
const SEVERITY_EMOJI: Record<Severity, string> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
  critical: 'CRITICAL',
};

// Prefixes par severite
const SEVERITY_PREFIX: Record<Severity, string> = {
  info: '[INFO]',
  warning: '[WARNING]',
  error: '[ERROR]',
  critical: '[CRITICAL]',
};

export interface TelegramMessage {
  chatId?: string;
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableNotification?: boolean;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly client: AxiosInstance;
  private readonly botToken: string;
  private readonly defaultChatId: string;

  constructor(private configService: ConfigService) {
    this.botToken = this.configService.get<string>('telegram.botToken')!;
    this.defaultChatId = this.configService.get<string>('telegram.chatId')!;

    this.client = axios.create({
      baseURL: `https://api.telegram.org/bot${this.botToken}`,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Envoie un message Telegram
   */
  async sendMessage(message: TelegramMessage): Promise<SendMessageResult> {
    const chatId = message.chatId || this.defaultChatId;

    try {
      const response = await this.client.post('/sendMessage', {
        chat_id: chatId,
        text: message.text,
        parse_mode: message.parseMode || 'HTML',
        disable_notification: message.disableNotification || false,
      });

      if (response.data.ok) {
        this.logger.debug(`Message sent to ${chatId}, ID: ${response.data.result.message_id}`);
        return {
          success: true,
          messageId: response.data.result.message_id,
        };
      } else {
        this.logger.error(`Telegram API error: ${response.data.description}`);
        return {
          success: false,
          error: response.data.description,
        };
      }
    } catch (error) {
      const axiosError = error as AxiosError;
      const errorMessage = axiosError.response?.data
        ? JSON.stringify(axiosError.response.data)
        : axiosError.message;

      this.logger.error(`Failed to send Telegram message: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Envoie une alerte formatee
   */
  async sendAlert(
    title: string,
    message: string,
    severity: Severity = 'info',
    details?: Record<string, any>,
  ): Promise<SendMessageResult> {
    const prefix = SEVERITY_PREFIX[severity];
    const severityName = SEVERITY_EMOJI[severity];

    let text = `<b>${prefix} ${title}</b>\n\n${message}`;

    if (details && Object.keys(details).length > 0) {
      text += '\n\n<b>Details:</b>';
      for (const [key, value] of Object.entries(details)) {
        const formattedValue = typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
        text += `\n- <b>${key}:</b> <code>${this.escapeHtml(formattedValue)}</code>`;
      }
    }

    text += `\n\n<i>Severity: ${severityName}</i>`;

    // Les alertes critiques ne sont pas silencieuses
    const disableNotification = severity === 'info';

    return this.sendMessage({
      text,
      parseMode: 'HTML',
      disableNotification,
    });
  }

  /**
   * Envoie une notification de succes
   */
  async sendSuccess(title: string, message: string): Promise<SendMessageResult> {
    const text = `<b>[SUCCESS] ${title}</b>\n\n${message}`;

    return this.sendMessage({
      text,
      parseMode: 'HTML',
      disableNotification: true,
    });
  }

  /**
   * Envoie un rapport formate
   */
  async sendReport(
    title: string,
    sections: Array<{ label: string; value: string | number }>,
  ): Promise<SendMessageResult> {
    let text = `<b>[REPORT] ${title}</b>\n`;

    for (const section of sections) {
      text += `\n- <b>${section.label}:</b> ${section.value}`;
    }

    return this.sendMessage({
      text,
      parseMode: 'HTML',
      disableNotification: true,
    });
  }

  /**
   * Teste la connexion au bot
   */
  async testConnection(): Promise<{ success: boolean; botInfo?: any; error?: string }> {
    try {
      const response = await this.client.get('/getMe');

      if (response.data.ok) {
        this.logger.log(`Telegram bot connected: @${response.data.result.username}`);
        return {
          success: true,
          botInfo: response.data.result,
        };
      } else {
        return {
          success: false,
          error: response.data.description,
        };
      }
    } catch (error) {
      const axiosError = error as AxiosError;
      const errorMessage = axiosError.message;
      this.logger.error(`Telegram connection test failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Echappe les caracteres HTML speciaux
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
