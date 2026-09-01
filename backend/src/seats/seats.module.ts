import { Module } from '@nestjs/common';
import { SeatsService } from './seats.service';
import { SeatsController } from './seats.controller';
import { SeatsScheduler } from './seats.scheduler';

@Module({
  controllers: [SeatsController],
  providers: [SeatsService, SeatsScheduler],
  exports: [SeatsService],
})
export class SeatsModule {}
