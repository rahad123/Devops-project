import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOperatorDto } from './dto/create-operator.dto';
import { UpdateOperatorDto } from './dto/update-operator.dto';

@Injectable()
export class OperatorsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateOperatorDto) {
    return this.prisma.operator.create({ data: { name: dto.name } });
  }

  async list() {
    return this.prisma.operator.findMany({ orderBy: { name: 'asc' } });
  }

  async update(id: string, dto: UpdateOperatorDto) {
    await this.findOrThrow(id);
    return this.prisma.operator.update({ where: { id }, data: dto });
  }

  private async findOrThrow(id: string) {
    const operator = await this.prisma.operator.findUnique({ where: { id } });
    if (!operator) {
      throw new NotFoundException('Operator not found');
    }
    return operator;
  }
}
