import { Module } from '@nestjs/common';
import { BooksService } from './books.service';
import { BooksController } from './books.controller';
import { StrategyModule } from '../strategy/strategy.module';
import { InsightsModule } from '../insights/insights.module';
import { AmazonClientModule } from '../amazon-client/amazon-client.module';
import { ReportsModule } from '../reports/reports.module';
import { LifecycleModule } from '../lifecycle/lifecycle.module';

@Module({
  imports: [StrategyModule, InsightsModule, AmazonClientModule, ReportsModule, LifecycleModule],
  controllers: [BooksController],
  providers: [BooksService],
  exports: [BooksService],
})
export class BooksModule {}
