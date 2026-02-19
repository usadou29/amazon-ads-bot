import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? true, // true = reflect request origin
    credentials: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3001;

  await app.listen(port);

  logger.log(`Application listening on http://localhost:${port}`);
  logger.log(`Health: GET http://localhost:${port}/api/health`);
  logger.log(`Health DB: GET http://localhost:${port}/api/health/db`);

  // DB connectivity check au démarrage
  try {
    const { assertDbConnection } = await import('./db/connection');
    await assertDbConnection();
    logger.log('DB connectivity check: OK (SELECT 1)');
  } catch (err) {
    logger.error(
      `DB connectivity check failed: ${err instanceof Error ? err.message : err}`,
    );
    // On ne coupe pas le serveur : l'endpoint /api/health/db permettra de détecter le problème
  }
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
