import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { StaffController } from './staff.controller';

@Module({
  imports: [BookingsModule],
  controllers: [StaffController],
})
export class StaffModule {}
