import { Controller, Get, Post, Patch, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BusesService } from './buses.service';
import { CreateBusDto } from './dto/create-bus.dto';
import { UpdateBusDto } from './dto/update-bus.dto';

@ApiTags('Admin - Buses')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/buses')
export class BusesController {
  constructor(private busesService: BusesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a bus (auto-generates its seat map)' })
  async create(@Body() dto: CreateBusDto) {
    const bus = await this.busesService.create(dto);
    return { success: true, message: 'Bus created', data: bus };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List buses' })
  async list() {
    const buses = await this.busesService.list();
    return { success: true, message: `Found ${buses.length} bus(es)`, data: buses };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a bus' })
  async update(@Param('id') id: string, @Body() dto: UpdateBusDto) {
    const bus = await this.busesService.update(id, dto);
    return { success: true, message: 'Bus updated', data: bus };
  }
}
