import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { PaymentController } from './payment/payment.controller';
import { BkashService } from './bkash/bkash.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, PaymentController],
  providers: [BkashService],
})
export class AppModule {}
