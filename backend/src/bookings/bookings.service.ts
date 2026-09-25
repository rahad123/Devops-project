import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BookingStatus, SeatStatus } from '@prisma/client';
import { CreateBookingDto } from './dto/create-booking.dto';

const PNR_LENGTH = 8;
const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PNR_ATTEMPTS = 5;

function generatePnr(): string {
  const bytes = randomBytes(PNR_LENGTH);
  let pnr = '';
  for (let i = 0; i < PNR_LENGTH; i++) {
    pnr += PNR_ALPHABET[bytes[i] % PNR_ALPHABET.length];
  }
  return pnr;
}

const bookingInclude = {
  schedule: {
    include: {
      bus: { include: { operator: true } },
      route: true,
    },
  },
  boardingPoint: true,
  droppingPoint: true,
} as const;

const adminBookingInclude = {
  ...bookingInclude,
  user: { select: { id: true, name: true, email: true, phone: true } },
} as const;

@Injectable()
export class BookingsService {
  constructor(private prisma: PrismaService) {}

  async createBooking(dto: CreateBookingDto, userId: string) {
    const schedule = await this.prisma.schedule.findUnique({
      where: { id: dto.scheduleId },
      include: { boardingPoints: true, droppingPoints: true },
    });
    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    const boardingValid = schedule.boardingPoints.some((bp) => bp.id === dto.boardingPointId);
    const droppingValid = schedule.droppingPoints.some((dp) => dp.id === dto.droppingPointId);
    if (!boardingValid || !droppingValid) {
      throw new BadRequestException('Boarding or dropping point does not belong to this schedule');
    }

    const scheduleSeats = await this.prisma.scheduleSeat.findMany({
      where: {
        scheduleId: dto.scheduleId,
        seat: { seatNumber: { in: dto.seatNumbers } },
      },
      include: { seat: true },
    });

    if (scheduleSeats.length !== dto.seatNumbers.length) {
      throw new BadRequestException('Some seat numbers do not exist on this schedule');
    }

    const now = new Date();
    const notHeldByUser = scheduleSeats.filter(
      (ss) =>
        ss.status !== SeatStatus.HELD ||
        ss.heldByUserId !== userId ||
        !ss.expiresAt ||
        ss.expiresAt < now,
    );
    if (notHeldByUser.length > 0) {
      const seatNumbers = notHeldByUser.map((ss) => ss.seat.seatNumber);
      throw new BadRequestException(
        `These seats are not currently held by you (hold may have expired): ${seatNumbers.join(', ')}`,
      );
    }

    const totalFare =
      Number(schedule.fare) * dto.seatNumbers.length + Number(schedule.serviceCharge);

    for (let attempt = 0; attempt < MAX_PNR_ATTEMPTS; attempt++) {
      const pnr = generatePnr();
      try {
        const booking = await this.prisma.$transaction(async (tx) => {
          const created = await tx.booking.create({
            data: {
              userId,
              scheduleId: dto.scheduleId,
              pnr,
              totalFare,
              seatNumbers: dto.seatNumbers,
              boardingPointId: dto.boardingPointId,
              droppingPointId: dto.droppingPointId,
            },
          });

          await tx.scheduleSeat.updateMany({
            where: { id: { in: scheduleSeats.map((ss) => ss.id) } },
            data: {
              status: SeatStatus.BOOKED,
              bookingId: created.id,
              bookedAt: now,
              heldByUserId: null,
              heldAt: null,
              expiresAt: null,
            },
          });

          return created;
        });

        return this.getBookingForOwner(booking.id, userId);
      } catch (err: any) {
        if (err?.code === 'P2002') {
          continue;
        }
        throw err;
      }
    }

    throw new BadRequestException('Could not generate a unique booking reference, please retry');
  }

  async listBookings(userId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { userId },
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
    });
    return bookings.map((b) => this.serializeBooking(b));
  }

  async getBookingForOwner(bookingId: string, userId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: bookingInclude,
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.userId !== userId) {
      throw new ForbiddenException('You do not have access to this booking');
    }
    return this.serializeBooking(booking);
  }

  async cancelBooking(bookingId: string, userId: string) {
    const booking = await this.findBookingOrThrow(bookingId);
    if (booking.userId !== userId) {
      throw new ForbiddenException('You do not have access to this booking');
    }
    if (booking.schedule.departureTime <= new Date()) {
      throw new BadRequestException('Cannot cancel a booking after departure');
    }

    await this.cancel(bookingId);
    return this.getBookingForOwner(bookingId, userId);
  }

  async listAllBookings(filter: { scheduleId?: string; status?: BookingStatus }) {
    const bookings = await this.prisma.booking.findMany({
      where: {
        ...(filter.scheduleId ? { scheduleId: filter.scheduleId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: adminBookingInclude,
      orderBy: { createdAt: 'desc' },
    });
    return bookings.map((b) => this.serializeBooking(b));
  }

  async getBookingById(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: adminBookingInclude,
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return this.serializeBooking(booking);
  }

  async getBookingByPnr(pnr: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { pnr },
      include: adminBookingInclude,
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return this.serializeBooking(booking);
  }

  async forceCancelBooking(bookingId: string) {
    await this.findBookingOrThrow(bookingId);
    await this.cancel(bookingId);
    return this.getBookingById(bookingId);
  }

  async checkInBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('Cannot check in a cancelled booking');
    }
    if (booking.checkedInAt) {
      throw new BadRequestException('Booking is already checked in');
    }

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { checkedInAt: new Date() },
    });

    return this.getBookingById(bookingId);
  }

  private async findBookingOrThrow(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { schedule: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('Booking is already cancelled');
    }
    return booking;
  }

  private async cancel(bookingId: string) {
    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
      }),
      this.prisma.scheduleSeat.updateMany({
        where: { bookingId },
        data: {
          status: SeatStatus.AVAILABLE,
          bookingId: null,
          bookedAt: null,
        },
      }),
    ]);
  }

  private serializeBooking(booking: any) {
    return {
      id: booking.id,
      pnr: booking.pnr,
      status: booking.status,
      totalFare: Number(booking.totalFare),
      createdAt: booking.createdAt,
      cancelledAt: booking.cancelledAt,
      checkedInAt: booking.checkedInAt,
      schedule: {
        id: booking.schedule.id,
        busName: booking.schedule.bus.name,
        busType: booking.schedule.bus.busType,
        operatorName: booking.schedule.bus.operator.name,
        route: {
          source: booking.schedule.route.source,
          destination: booking.schedule.route.destination,
        },
        departureTime: booking.schedule.departureTime,
        arrivalTime: booking.schedule.arrivalTime,
      },
      boardingPoint: { id: booking.boardingPoint.id, name: booking.boardingPoint.name, time: booking.boardingPoint.time },
      droppingPoint: { id: booking.droppingPoint.id, name: booking.droppingPoint.name, time: booking.droppingPoint.time },
      seats: booking.seatNumbers,
      ...(booking.user ? { customer: booking.user } : {}),
    };
  }
}
