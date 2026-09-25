import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { UsersModule } from '../users/users.module';
import { OperatorsController } from './operators/operators.controller';
import { OperatorsService } from './operators/operators.service';
import { BusesController } from './buses/buses.controller';
import { BusesService } from './buses/buses.service';
import { RoutesController } from './routes/routes.controller';
import { RoutesService } from './routes/routes.service';
import { SchedulesController } from './schedules/schedules.controller';
import { SchedulesService } from './schedules/schedules.service';
import { AdminBookingsController } from './bookings/admin-bookings.controller';
import { AdminCustomersController } from './customers/admin-customers.controller';
import { AdminStaffController } from './staff/admin-staff.controller';

@Module({
  imports: [BookingsModule, UsersModule],
  controllers: [
    OperatorsController,
    BusesController,
    RoutesController,
    SchedulesController,
    AdminBookingsController,
    AdminCustomersController,
    AdminStaffController,
  ],
  providers: [OperatorsService, BusesService, RoutesService, SchedulesService],
})
export class AdminModule {}
