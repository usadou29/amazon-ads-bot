import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { AmazonClientModule } from '@/modules/amazon-client';
import { ReportsModule } from '@/modules/reports/reports.module';

@Module({
  imports: [AmazonClientModule, ReportsModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
