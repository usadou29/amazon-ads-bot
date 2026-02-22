import { Module } from '@nestjs/common';
import { BooksService } from './books.service';
import { BooksController } from './books.controller';
import { StrategyModule } from '../strategy/strategy.module';
import { InsightsModule } from '../insights/insights.module';

@Module({
  imports: [StrategyModule, InsightsModule],
  controllers: [BooksController],
  providers: [BooksService],
  exports: [BooksService],
})
export class BooksModule {}
