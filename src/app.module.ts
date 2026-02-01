import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration } from '@/config/env';
import { DatabaseModule } from '@/db/database.module';
import { SystemModule } from '@/modules/system/system.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { SyncModule } from '@/modules/sync/sync.module';
import { RulesModule } from '@/modules/rules/rules.module';
import { RecommendationsModule } from '@/modules/recommendations/recommendations.module';
import { ExecutorModule } from '@/modules/executor/executor.module';
import { BooksModule } from '@/modules/books/books.module';
import { MetricsModule } from '@/modules/metrics/metrics.module';
import { AlertsModule } from '@/modules/alerts/alerts.module';
import { AmazonClientModule } from '@/modules/amazon-client/amazon-client.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      load: [configuration],
    }),
    DatabaseModule,
    SystemModule,
    AuthModule,
    SyncModule,
    RulesModule,
    RecommendationsModule,
    ExecutorModule,
    BooksModule,
    MetricsModule,
    AlertsModule,
    AmazonClientModule,
  ],
})
export class AppModule {}
