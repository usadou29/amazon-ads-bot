import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AlertsService } from './alerts.service';
import { TelegramService } from './telegram.service';

@Module({
  imports: [ConfigModule],
  providers: [AlertsService, TelegramService],
  exports: [AlertsService, TelegramService],
})
export class AlertsModule {}
