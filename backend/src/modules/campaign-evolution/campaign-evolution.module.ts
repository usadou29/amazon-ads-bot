import { Module } from '@nestjs/common';
import { CampaignEvolutionController } from './campaign-evolution.controller';
import { CampaignEvolutionService } from './campaign-evolution.service';
import { CreateFromPlanService } from './create-from-plan.service';
import { StructureAnalyzerService } from './services/structure-analyzer.service';
import { CampaignClassifierService } from './services/campaign-classifier.service';
import { ScenarioSelectorService } from './services/scenario-selector.service';
import { MaturityScorerService } from './services/maturity-scorer.service';
import { RoadmapGeneratorService } from './services/roadmap-generator.service';
import { TopFocusService } from './services/top-focus.service';
import { GapDetectorService } from './services/gap-detector.service';
import { HarvestService } from './services/harvest.service';
import { InsightsModule } from '@/modules/insights/insights.module';
import { AmazonClientModule } from '@/modules/amazon-client/amazon-client.module';
import { LifecycleModule } from '@/modules/lifecycle/lifecycle.module';

@Module({
  imports: [InsightsModule, AmazonClientModule, LifecycleModule],
  controllers: [CampaignEvolutionController],
  providers: [
    CampaignEvolutionService,
    CreateFromPlanService,
    StructureAnalyzerService,
    CampaignClassifierService,
    ScenarioSelectorService,
    MaturityScorerService,
    RoadmapGeneratorService,
    TopFocusService,
    GapDetectorService,
    HarvestService,
  ],
  exports: [CampaignEvolutionService, CreateFromPlanService],
})
export class CampaignEvolutionModule {}
