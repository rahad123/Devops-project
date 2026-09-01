import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SeatsService } from './seats.service';

@Injectable()
export class SeatsScheduler {
  private readonly logger = new Logger(SeatsScheduler.name);

  constructor(private seatsService: SeatsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredHolds() {
    this.logger.debug('Checking for expired seat holds...');
    await this.seatsService.releaseExpiredHolds();
  }
}
