import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Deck, SeatType } from '@prisma/client';
import { CreateBusDto } from './dto/create-bus.dto';
import { UpdateBusDto } from './dto/update-bus.dto';

const COLUMNS = ['A', 'B', 'C', 'D'];

@Injectable()
export class BusesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateBusDto) {
    const operator = await this.prisma.operator.findUnique({ where: { id: dto.operatorId } });
    if (!operator) {
      throw new NotFoundException('Operator not found');
    }

    const isSleeper = dto.busType.includes('SLEEPER');

    return this.prisma.bus.create({
      data: {
        operatorId: dto.operatorId,
        name: dto.name,
        busType: dto.busType,
        totalSeats: dto.rows * COLUMNS.length,
        seats: { create: this.generateSeats(dto.rows, isSleeper) },
      },
      include: { operator: true, seats: true },
    });
  }

  async list() {
    return this.prisma.bus.findMany({
      include: { operator: true, _count: { select: { seats: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async update(id: string, dto: UpdateBusDto) {
    await this.findOrThrow(id);
    return this.prisma.bus.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.busType !== undefined ? { busType: dto.busType } : {}),
      },
    });
  }

  private generateSeats(rows: number, isSleeper: boolean) {
    const seats: { seatNumber: string; deck: Deck; seatType: SeatType; row: number; column: number }[] = [];
    for (let row = 1; row <= rows; row++) {
      for (let col = 1; col <= COLUMNS.length; col++) {
        seats.push({
          seatNumber: `${row}${COLUMNS[col - 1]}`,
          deck: Deck.LOWER,
          seatType: isSleeper ? SeatType.SLEEPER : SeatType.SEATER,
          row,
          column: col,
        });
      }
    }
    return seats;
  }

  private async findOrThrow(id: string) {
    const bus = await this.prisma.bus.findUnique({ where: { id } });
    if (!bus) {
      throw new NotFoundException('Bus not found');
    }
    return bus;
  }
}
