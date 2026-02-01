import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';

@Module({
  imports: [ConfigModule],
  controllers: [SystemController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}
