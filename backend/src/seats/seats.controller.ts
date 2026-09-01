import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SeatsService } from './seats.service';
import { HoldSeatsDto } from './dto/hold-seats.dto';
import { ReleaseSeatsDto } from './dto/release-seats.dto';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Seats')
@Controller('schedules')
export class SeatsController {
  constructor(private seatsService: SeatsService) {}

  @Public()
  @Get(':scheduleId/seats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get seat layout for a schedule' })
  async getSeatLayout(@Param('scheduleId') scheduleId: string) {
    const layout = await this.seatsService.getSeatLayout(scheduleId);
    return {
      success: true,
      message: 'Seat layout retrieved',
      data: layout,
    };
  }

  @Post(':scheduleId/seats/hold')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Temporarily hold selected seats' })
  async holdSeats(
    @Param('scheduleId') scheduleId: string,
    @Body() dto: HoldSeatsDto,
  ) {
    const result = await this.seatsService.holdSeats(
      scheduleId,
      dto.seatNumbers,
      dto.userId,
    );
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }

  @Post(':scheduleId/seats/release')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Release held seats' })
  async releaseSeats(
    @Param('scheduleId') scheduleId: string,
    @Body() dto: ReleaseSeatsDto,
  ) {
    const result = await this.seatsService.releaseSeats(
      scheduleId,
      dto.seatNumbers,
      dto.userId,
    );
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }
}
