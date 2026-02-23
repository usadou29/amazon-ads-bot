import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InsightsModule } from '@/modules/insights/insights.module';
import { AmazonClientModule } from '@/modules/amazon-client/amazon-client.module';
import { ExecutorModule } from '@/modules/executor/executor.module';
import { ActionSuggestionService } from './action-suggestion.service';
import { ActionsController } from './actions.controller';

@Module({
  imports: [
    ConfigModule,
    InsightsModule,
    AmazonClientModule,
    ExecutorModule,
  ],
  controllers: [ActionsController],
  providers: [ActionSuggestionService],
  exports: [ActionSuggestionService],
})
export class ActionsModule {}
