import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UsersService } from '../../users/users.service';
import { CreateStaffDto } from '../../users/dto/create-staff.dto';

@ApiTags('Admin - Staff')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a bus staff account' })
  async create(@Body() dto: CreateStaffDto) {
    const staff = await this.usersService.adminCreateStaff(dto);
    return { success: true, message: 'Staff account created', data: staff };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List staff accounts' })
  async list() {
    const staff = await this.usersService.adminListStaff();
    return { success: true, message: `Found ${staff.length} staff member(s)`, data: staff };
  }
}
