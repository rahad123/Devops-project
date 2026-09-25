import { Controller, Get, Post, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BookingsService } from '../../bookings/bookings.service';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';

@ApiTags('Admin - Bookings')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private bookingsService: BookingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all bookings across every customer' })
  async list(@Query() query: ListBookingsQueryDto) {
    const bookings = await this.bookingsService.listAllBookings(query);
    return { success: true, message: `Found ${bookings.length} booking(s)`, data: bookings };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get any booking by id' })
  async get(@Param('id') id: string) {
    const booking = await this.bookingsService.getBookingById(id);
    return { success: true, message: 'Booking retrieved', data: booking };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force-cancel any booking, regardless of owner or departure time' })
  async cancel(@Param('id') id: string) {
    const booking = await this.bookingsService.forceCancelBooking(id);
    return { success: true, message: 'Booking cancelled', data: booking };
  }
}
