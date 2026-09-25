import { Controller, Get, Post, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { BookingsService } from './bookings.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

@ApiTags('Bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private bookingsService: BookingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List the current user\'s bookings' })
  async listBookings(@Req() req: AuthenticatedRequest) {
    const bookings = await this.bookingsService.listBookings(req.user.userId);
    return { success: true, message: `Found ${bookings.length} booking(s)`, data: bookings };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single booking' })
  async getBooking(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const booking = await this.bookingsService.getBookingForOwner(id, req.user.userId);
    return { success: true, message: 'Booking retrieved', data: booking };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a confirmed booking' })
  async cancelBooking(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const booking = await this.bookingsService.cancelBooking(id, req.user.userId);
    return { success: true, message: 'Booking cancelled', data: booking };
  }
}
