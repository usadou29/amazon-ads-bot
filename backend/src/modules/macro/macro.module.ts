import { Module } from '@nestjs/common';
import { MacroSuggestionService } from './macro-suggestion.service';
import { MacroExecutorService } from './macro-executor.service';
import { MacroController } from './macro.controller';
import { AmazonClientModule } from '@/modules/amazon-client/amazon-client.module';

@Module({
  imports: [AmazonClientModule],
  controllers: [MacroController],
  providers: [MacroSuggestionService, MacroExecutorService],
  exports: [MacroSuggestionService, MacroExecutorService],
})
export class MacroModule {}
