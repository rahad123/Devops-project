import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SeatStatus } from '@prisma/client';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ListSchedulesQueryDto } from './dto/list-schedules-query.dto';

const scheduleInclude = {
  bus: { include: { operator: true } },
  route: true,
  boardingPoints: true,
  droppingPoints: true,
} as const;

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateScheduleDto) {
    const bus = await this.prisma.bus.findUnique({
      where: { id: dto.busId },
      include: { seats: true },
    });
    if (!bus) {
      throw new NotFoundException('Bus not found');
    }

    const route = await this.prisma.route.findUnique({ where: { id: dto.routeId } });
    if (!route) {
      throw new NotFoundException('Route not found');
    }

    return this.prisma.schedule.create({
      data: {
        busId: dto.busId,
        routeId: dto.routeId,
        departureTime: new Date(dto.departureTime),
        arrivalTime: new Date(dto.arrivalTime),
        fare: dto.fare,
        serviceCharge: dto.serviceCharge ?? 0,
        boardingPoints: {
          create: dto.boardingPoints.map((p) => ({ name: p.name, time: new Date(p.time) })),
        },
        droppingPoints: {
          create: dto.droppingPoints.map((p) => ({ name: p.name, time: new Date(p.time) })),
        },
        scheduleSeats: {
          create: bus.seats.map((seat) => ({ seatId: seat.id, status: SeatStatus.AVAILABLE })),
        },
      },
      include: scheduleInclude,
    });
  }

  async list(filter: ListSchedulesQueryDto) {
    return this.prisma.schedule.findMany({
      where: {
        ...(filter.routeId ? { routeId: filter.routeId } : {}),
        ...(filter.busId ? { busId: filter.busId } : {}),
      },
      include: scheduleInclude,
      orderBy: { departureTime: 'asc' },
    });
  }

  async update(id: string, dto: UpdateScheduleDto) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id },
      include: { _count: { select: { bookings: true } } },
    });
    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }
    if (schedule._count.bookings > 0) {
      throw new ConflictException('Cannot modify a schedule that already has bookings');
    }

    return this.prisma.schedule.update({
      where: { id },
      data: {
        ...(dto.departureTime !== undefined ? { departureTime: new Date(dto.departureTime) } : {}),
        ...(dto.arrivalTime !== undefined ? { arrivalTime: new Date(dto.arrivalTime) } : {}),
        ...(dto.fare !== undefined ? { fare: dto.fare } : {}),
        ...(dto.serviceCharge !== undefined ? { serviceCharge: dto.serviceCharge } : {}),
      },
      include: scheduleInclude,
    });
  }
}
