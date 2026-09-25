import { Controller, Get, Post, Patch, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ListSchedulesQueryDto } from './dto/list-schedules-query.dto';

@ApiTags('Admin - Schedules')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/schedules')
export class SchedulesController {
  constructor(private schedulesService: SchedulesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a schedule (auto-generates its ScheduleSeat rows)' })
  async create(@Body() dto: CreateScheduleDto) {
    const schedule = await this.schedulesService.create(dto);
    return { success: true, message: 'Schedule created', data: schedule };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List schedules' })
  async list(@Query() query: ListSchedulesQueryDto) {
    const schedules = await this.schedulesService.list(query);
    return { success: true, message: `Found ${schedules.length} schedule(s)`, data: schedules };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a schedule (blocked once it has bookings)' })
  async update(@Param('id') id: string, @Body() dto: UpdateScheduleDto) {
    const schedule = await this.schedulesService.update(id, dto);
    return { success: true, message: 'Schedule updated', data: schedule };
  }
}
