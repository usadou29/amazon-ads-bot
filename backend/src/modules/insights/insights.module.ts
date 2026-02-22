import { Module } from '@nestjs/common';
import { InsightsService } from './insights.service';

@Module({
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
