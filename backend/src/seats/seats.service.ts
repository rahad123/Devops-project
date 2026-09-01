import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SeatStatus } from '@prisma/client';

const HOLD_DURATION_MINUTES = 10;

@Injectable()
export class SeatsService {
  constructor(private prisma: PrismaService) {}

  async getSeatLayout(scheduleId: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: {
        bus: true,
        scheduleSeats: {
          include: {
            seat: true,
          },
          orderBy: { seat: { row: 'asc' } },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    // Release expired holds
    await this.releaseExpiredHolds(scheduleId);

    const seats = schedule.scheduleSeats.map((ss) => ({
      seatNumber: ss.seat.seatNumber,
      row: ss.seat.row,
      column: ss.seat.column,
      deck: ss.seat.deck,
      seatType: ss.seat.seatType,
      status: this.getEffectiveStatus(ss),
    }));

    const availableCount = seats.filter((s) => s.status === SeatStatus.AVAILABLE).length;
    const heldCount = seats.filter((s) => s.status === SeatStatus.HELD).length;
    const bookedCount = seats.filter((s) => s.status === SeatStatus.BOOKED).length;

    return {
      scheduleId,
      busName: schedule.bus.name,
      busType: schedule.bus.busType,
      totalSeats: schedule.bus.totalSeats,
      fare: Number(schedule.fare),
      summary: {
        available: availableCount,
        held: heldCount,
        booked: bookedCount,
      },
      seats,
    };
  }

  async holdSeats(scheduleId: string, seatNumbers: string[], userId: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: { bus: true },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    if (seatNumbers.length > 6) {
      throw new BadRequestException('Cannot hold more than 6 seats at a time');
    }

    // Release expired holds first
    await this.releaseExpiredHolds(scheduleId);

    // Find the seat records for these seat numbers
    const seats = await this.prisma.seat.findMany({
      where: {
        busId: schedule.busId,
        seatNumber: { in: seatNumbers },
      },
    });

    if (seats.length !== seatNumbers.length) {
      const found = seats.map((s) => s.seatNumber);
      const missing = seatNumbers.filter((sn) => !found.includes(sn));
      throw new BadRequestException(`Invalid seat numbers: ${missing.join(', ')}`);
    }

    // Find ScheduleSeat records for these seats
    const scheduleSeats = await this.prisma.scheduleSeat.findMany({
      where: {
        scheduleId,
        seatId: { in: seats.map((s) => s.id) },
      },
      include: { seat: true },
    });

    // Check if any are already held or booked
    const unavailable = scheduleSeats.filter(
      (ss) => ss.status === SeatStatus.HELD || ss.status === SeatStatus.BOOKED,
    );

    if (unavailable.length > 0) {
      const unavailNumbers = unavailable.map((ss) => ss.seat.seatNumber);
      throw new ConflictException(
        `Seats already taken: ${unavailNumbers.join(', ')}`,
      );
    }

    // Hold the seats
    const now = new Date();
    const expiresAt = new Date(now.getTime() + HOLD_DURATION_MINUTES * 60 * 1000);

    await this.prisma.scheduleSeat.updateMany({
      where: {
        scheduleId,
        seatId: { in: seats.map((s) => s.id) },
      },
      data: {
        status: SeatStatus.HELD,
        heldByUserId: userId,
        heldAt: now,
        expiresAt,
      },
    });

    return {
      message: `Successfully held ${seatNumbers.length} seat(s)`,
      seats: seatNumbers,
      heldUntil: expiresAt,
      holdDurationMinutes: HOLD_DURATION_MINUTES,
    };
  }

  async releaseSeats(scheduleId: string, seatNumbers: string[], userId: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id: scheduleId },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    const seats = await this.prisma.seat.findMany({
      where: {
        busId: schedule.busId,
        seatNumber: { in: seatNumbers },
      },
    });

    if (seats.length !== seatNumbers.length) {
      throw new BadRequestException('Invalid seat numbers');
    }

    await this.prisma.scheduleSeat.updateMany({
      where: {
        scheduleId,
        seatId: { in: seats.map((s) => s.id) },
        heldByUserId: userId,
        status: SeatStatus.HELD,
      },
      data: {
        status: SeatStatus.AVAILABLE,
        heldByUserId: null,
        heldAt: null,
        expiresAt: null,
      },
    });

    return {
      message: `Released ${seatNumbers.length} seat(s)`,
      seats: seatNumbers,
    };
  }

  async releaseExpiredHolds(scheduleId?: string) {
    const where: any = {
      status: SeatStatus.HELD,
      expiresAt: { lt: new Date() },
    };

    if (scheduleId) {
      where.scheduleId = scheduleId;
    }

    await this.prisma.scheduleSeat.updateMany({
      where,
      data: {
        status: SeatStatus.AVAILABLE,
        heldByUserId: null,
        heldAt: null,
        expiresAt: null,
      },
    });
  }

  private getEffectiveStatus(ss: { status: SeatStatus; expiresAt: Date | null }): SeatStatus {
    if (ss.status === SeatStatus.HELD && ss.expiresAt && ss.expiresAt < new Date()) {
      return SeatStatus.AVAILABLE;
    }
    return ss.status;
  }
}
