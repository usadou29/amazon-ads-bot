import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExecutorService } from './executor.service';
import { ExecutorController } from './executor.controller';
import { AmazonClientModule } from '@/modules/amazon-client';

@Module({
  imports: [ConfigModule, AmazonClientModule],
  controllers: [ExecutorController],
  providers: [ExecutorService],
  exports: [ExecutorService],
})
export class ExecutorModule {}
