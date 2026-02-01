import { Module } from '@nestjs/common';
import { AmazonClientService } from './amazon-client.service';

@Module({
  providers: [AmazonClientService],
  exports: [AmazonClientService],
})
export class AmazonClientModule {}
