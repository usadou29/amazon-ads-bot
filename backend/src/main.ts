import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // ✅ SECURITY: Helmet pour les headers de sécurité
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false, // Pour compatibilité avec certaines APIs
  }));

  // ✅ SECURITY: CORS strict - plus de 'true' qui reflète l'origin
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('app.corsOrigin');
  const allowedOrigins = corsOrigin 
    ? corsOrigin.split(',').map(o => o.trim()) 
    : ['http://localhost:3000', 'http://localhost:5173'];

  app.enableCors({
    origin: (origin, callback) => {
      // Autoriser les requêtes sans origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // ✅ SECURITY: Validation globale des DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Supprime les propriétés non définies dans le DTO
    forbidNonWhitelisted: true, // Rejette les requêtes avec propriétés non définies
    transform: true, // Transforme automatiquement les types
  }));

  const port = configService.get<number>('app.port') ?? 3001;

  await app.listen(port);

  logger.log(`🚀 Application listening on http://localhost:${port}`);
  logger.log(`🔒 CORS allowed origins: ${allowedOrigins.join(', ')}`);
  logger.log(`🏥 Health: GET http://localhost:${port}/api/health`);
  logger.log(`🏥 Health DB: GET http://localhost:${port}/api/health/db`);

  // DB connectivity check au démarrage
  try {
    const { assertDbConnection } = await import('./db/connection');
    await assertDbConnection();
    logger.log('✅ DB connectivity check: OK (SELECT 1)');
  } catch (err) {
    logger.error(
      `❌ DB connectivity check failed: ${err instanceof Error ? err.message : err}`,
    );
    // On ne coupe pas le serveur : l'endpoint /api/health/db permettra de détecter le problème
  }
}

bootstrap().catch((err) => {
  // Garder console.error ici car c'est avant le logger NestJS
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
