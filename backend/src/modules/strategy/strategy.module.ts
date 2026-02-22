import { Module } from '@nestjs/common';
import { StrategyEngine } from './strategy-engine';

@Module({
  providers: [StrategyEngine],
  exports: [StrategyEngine],
})
export class StrategyModule {}
