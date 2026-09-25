import { Controller, Get, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UsersService } from '../../users/users.service';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

@ApiTags('Admin - Customers')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List customers' })
  async list(@Query() query: ListCustomersQueryDto) {
    const customers = await this.usersService.adminListCustomers(query.q);
    return { success: true, message: `Found ${customers.length} customer(s)`, data: customers };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a customer by id' })
  async get(@Param('id') id: string) {
    const customer = await this.usersService.adminGetCustomer(id);
    return { success: true, message: 'Customer retrieved', data: customer };
  }
}
