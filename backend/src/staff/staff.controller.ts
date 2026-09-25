import { Controller, Get, Post, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role, BookingStatus } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { BookingsService } from '../bookings/bookings.service';

@ApiTags('Staff')
@ApiBearerAuth()
@Roles(Role.STAFF, Role.ADMIN)
@Controller('staff')
export class StaffController {
  constructor(private bookingsService: BookingsService) {}

  @Get('schedules/:scheduleId/manifest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List a schedule's confirmed passengers" })
  async manifest(@Param('scheduleId') scheduleId: string) {
    const bookings = await this.bookingsService.listAllBookings({
      scheduleId,
      status: BookingStatus.CONFIRMED,
    });
    return { success: true, message: `Found ${bookings.length} passenger(s)`, data: bookings };
  }

  @Get('bookings/pnr/:pnr')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Look up a booking by PNR' })
  async getByPnr(@Param('pnr') pnr: string) {
    const booking = await this.bookingsService.getBookingByPnr(pnr);
    return { success: true, message: 'Booking retrieved', data: booking };
  }

  @Post('bookings/:id/check-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check in a passenger at boarding' })
  async checkIn(@Param('id') id: string) {
    const booking = await this.bookingsService.checkInBooking(id);
    return { success: true, message: 'Passenger checked in', data: booking };
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force-cancel a booking, e.g. for a no-show or gate issue' })
  async cancel(@Param('id') id: string) {
    const booking = await this.bookingsService.forceCancelBooking(id);
    return { success: true, message: 'Booking cancelled', data: booking };
  }
}
