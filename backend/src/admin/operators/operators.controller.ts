import { Controller, Get, Post, Patch, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { OperatorsService } from './operators.service';
import { CreateOperatorDto } from './dto/create-operator.dto';
import { UpdateOperatorDto } from './dto/update-operator.dto';

@ApiTags('Admin - Operators')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/operators')
export class OperatorsController {
  constructor(private operatorsService: OperatorsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a bus operator' })
  async create(@Body() dto: CreateOperatorDto) {
    const operator = await this.operatorsService.create(dto);
    return { success: true, message: 'Operator created', data: operator };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List bus operators' })
  async list() {
    const operators = await this.operatorsService.list();
    return { success: true, message: `Found ${operators.length} operator(s)`, data: operators };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a bus operator' })
  async update(@Param('id') id: string, @Body() dto: UpdateOperatorDto) {
    const operator = await this.operatorsService.update(id, dto);
    return { success: true, message: 'Operator updated', data: operator };
  }
}
