import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { SchedulerController } from './scheduler.controller';
import { SyncModule } from '@/modules/sync/sync.module';
import { ReportsModule } from '@/modules/reports/reports.module';
import { LifecycleModule } from '@/modules/lifecycle/lifecycle.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SyncModule,
    ReportsModule,
    LifecycleModule,
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
