import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SearchBusesDto } from './dto/search-buses.dto';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async searchBuses(dto: SearchBusesDto) {
    const travelDate = new Date(dto.travelDate);
    const nextDay = new Date(travelDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const where: any = {
      route: {
        source: { contains: dto.source, mode: 'insensitive' },
        destination: { contains: dto.destination, mode: 'insensitive' },
      },
      departureTime: {
        gte: travelDate,
        lt: nextDay,
      },
    };

    if (dto.busType) {
      where.bus = { busType: dto.busType };
    }

    if (dto.maxPrice) {
      where.fare = { lte: dto.maxPrice };
    }

    const schedules = await this.prisma.schedule.findMany({
      where,
      include: {
        bus: {
          include: {
            operator: true,
            seats: true,
          },
        },
        route: true,
        boardingPoints: true,
        droppingPoints: true,
      },
      orderBy: { departureTime: 'asc' },
    });

    return schedules.map((schedule) => {
      const bookedSeatCount = 0; // Will be calculated in sub-project 2 with bookings
      const availableSeats = schedule.bus.totalSeats - bookedSeatCount;

      return {
        id: schedule.id,
        busName: schedule.bus.name,
        busType: schedule.bus.busType,
        operatorName: schedule.bus.operator.name,
        route: {
          source: schedule.route.source,
          destination: schedule.route.destination,
          distanceKm: schedule.route.distanceKm,
        },
        departureTime: schedule.departureTime,
        arrivalTime: schedule.arrivalTime,
        fare: Number(schedule.fare),
        serviceCharge: Number(schedule.serviceCharge),
        totalFare: Number(schedule.fare) + Number(schedule.serviceCharge),
        availableSeats,
        totalSeats: schedule.bus.totalSeats,
        boardingPoints: schedule.boardingPoints.map((bp) => ({
          id: bp.id,
          name: bp.name,
          time: bp.time,
        })),
        droppingPoints: schedule.droppingPoints.map((dp) => ({
          id: dp.id,
          name: dp.name,
          time: dp.time,
        })),
      };
    });
  }
}
