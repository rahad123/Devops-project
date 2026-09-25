import { Controller, Get, Post, Patch, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';

@ApiTags('Admin - Routes')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/routes')
export class RoutesController {
  constructor(private routesService: RoutesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a route' })
  async create(@Body() dto: CreateRouteDto) {
    const route = await this.routesService.create(dto);
    return { success: true, message: 'Route created', data: route };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List routes' })
  async list() {
    const routes = await this.routesService.list();
    return { success: true, message: `Found ${routes.length} route(s)`, data: routes };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a route' })
  async update(@Param('id') id: string, @Body() dto: UpdateRouteDto) {
    const route = await this.routesService.update(id, dto);
    return { success: true, message: 'Route updated', data: route };
  }
}
