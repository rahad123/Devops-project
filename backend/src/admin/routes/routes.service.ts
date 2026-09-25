import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';

@Injectable()
export class RoutesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateRouteDto) {
    return this.prisma.route.create({ data: dto });
  }

  async list() {
    return this.prisma.route.findMany({ orderBy: { source: 'asc' } });
  }

  async update(id: string, dto: UpdateRouteDto) {
    await this.findOrThrow(id);
    return this.prisma.route.update({ where: { id }, data: dto });
  }

  private async findOrThrow(id: string) {
    const route = await this.prisma.route.findUnique({ where: { id } });
    if (!route) {
      throw new NotFoundException('Route not found');
    }
    return route;
  }
}
