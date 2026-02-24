import { IsString, IsNumber, IsOptional, IsIn } from 'class-validator';

export class ActionSuggestionDto {
  @IsString()
  workspaceId: string;

  @IsString()
  entityKey: string; // 'keyword:123' ou 'target:456'

  @IsString()
  @IsIn(['keyword', 'target'])
  entityType: 'keyword' | 'target';

  @IsNumber()
  acosTarget: number; // cible ACoS en % (ex: 40)

  @IsOptional()
  @IsString()
  lifecyclePhase?: string;

  @IsOptional()
  @IsString()
  @IsIn(['bid_up', 'bid_down'])
  actionType?: 'bid_up' | 'bid_down';
}

export class ExecuteDirectActionDto {
  @IsString()
  workspaceId: string;

  @IsString()
  entityKey: string;

  @IsString()
  @IsIn(['keyword', 'target'])
  entityType: 'keyword' | 'target';

  @IsString()
  @IsIn(['adjust_bid', 'pause', 'enable'])
  actionType: 'adjust_bid' | 'pause' | 'enable';

  @IsOptional()
  @IsNumber()
  newBid?: number;

  @IsOptional()
  @IsString()
  rationale?: string;

  @IsOptional()
  dryRun?: boolean;
}
