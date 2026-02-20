import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExecutorService } from './executor.service';
import { ExecutorController } from './executor.controller';
import { AmazonClientModule } from '@/modules/amazon-client';
import { SystemModule } from '@/modules/system/system.module';

@Module({
  imports: [ConfigModule, AmazonClientModule, SystemModule],
  controllers: [ExecutorController],
  providers: [ExecutorService],
  exports: [ExecutorService],
})
export class ExecutorModule {}
