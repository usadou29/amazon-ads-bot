import { z } from 'zod';

// Schéma de validation des variables d'environnement
const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGIN: z.string().optional(), // Comma-separated list of allowed origins

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_SSL_CA_PATH: z.string().optional(),

  // Security
  ENCRYPTION_KEY: z.string().min(32),

  // Amazon Ads
  AMAZON_CLIENT_ID: z.string().min(1),
  AMAZON_CLIENT_SECRET: z.string().min(1),
  AMAZON_REDIRECT_URI: z.string().url(),
  AMAZON_ADS_API_BASE_URL: z.string().url().default('https://advertising-api-eu.amazon.com'),

  // Telegram
  //TELEGRAM_BOT_TOKEN: z.string().min(1),
  //TELEGRAM_CHAT_ID: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),


  // Feature Flags
  DRY_RUN: z.string().transform((val) => val === 'true').default('true'),
  KILL_SWITCH_ENABLED: z.string().transform((val) => val === 'true').default('false'),

  // n8n (optionnel)
  N8N_WEBHOOK_BASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

// Validation et export de la configuration
function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }

  return parsed.data;
}

export const env = validateEnv();

// Export pour NestJS ConfigModule
export const configuration = () => ({
  app: {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    corsOrigin: env.CORS_ORIGIN,
  },
  database: {
    url: env.DATABASE_URL,
    sslCaPath: env.DATABASE_SSL_CA_PATH,
  },
  security: {
    encryptionKey: env.ENCRYPTION_KEY,
  },
  amazon: {
    clientId: env.AMAZON_CLIENT_ID,
    clientSecret: env.AMAZON_CLIENT_SECRET,
    redirectUri: env.AMAZON_REDIRECT_URI,
    apiBaseUrl: env.AMAZON_ADS_API_BASE_URL,
  },
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  },
  features: {
    dryRun: env.DRY_RUN,
    killSwitchEnabled: env.KILL_SWITCH_ENABLED,
  },
  n8n: {
    webhookBaseUrl: env.N8N_WEBHOOK_BASE_URL,
  },
});
