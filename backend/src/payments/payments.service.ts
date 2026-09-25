import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  RequestTimeoutException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { SeatStatus, PaymentStatus } from '@prisma/client';
import { BookingsService } from '../bookings/bookings.service';
import { PAYMENT_SERVICE } from '../rabbitmq/rabbitmq.module';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';

const PAYMENT_HOLD_WINDOW_MINUTES = 15;
const RPC_TIMEOUT_MS = 20000;

interface CreatePaymentResult {
  bkashPaymentId: string;
  bkashURL: string;
}

interface ExecutePaymentResult {
  success: boolean;
  trxID?: string;
  reason?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private bookingsService: BookingsService,
    @Inject(PAYMENT_SERVICE) private paymentClient: ClientProxy,
  ) {}

  async initiate(dto: InitiatePaymentDto, userId: string) {
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

    const amount = Number(schedule.fare) * dto.seatNumbers.length + Number(schedule.serviceCharge);

    // Extend the hold so the user has time to complete the bKash approval flow
    const extendedExpiry = new Date(now.getTime() + PAYMENT_HOLD_WINDOW_MINUTES * 60 * 1000);
    await this.prisma.scheduleSeat.updateMany({
      where: { id: { in: scheduleSeats.map((ss) => ss.id) } },
      data: { expiresAt: extendedExpiry },
    });

    const invoiceNumber = `INV-${Date.now()}`;
    const created = await this.rpc<CreatePaymentResult>('payment.create', {
      amount,
      invoiceNumber,
      payerReference: userId,
    });

    const payment = await this.prisma.payment.create({
      data: {
        bkashPaymentId: created.bkashPaymentId,
        userId,
        scheduleId: dto.scheduleId,
        seatNumbers: dto.seatNumbers,
        boardingPointId: dto.boardingPointId,
        droppingPointId: dto.droppingPointId,
        amount,
      },
    });

    return {
      paymentId: payment.id,
      bkashPaymentId: created.bkashPaymentId,
      bkashURL: created.bkashURL,
      amount,
      holdExpiresAt: extendedExpiry,
    };
  }

  async execute(paymentId: string, userId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    if (payment.userId !== userId) {
      throw new ForbiddenException('You do not have access to this payment');
    }
    if (payment.status !== PaymentStatus.INITIATED) {
      throw new BadRequestException(`Payment is already ${payment.status.toLowerCase()}`);
    }

    const result = await this.rpc<ExecutePaymentResult>('payment.execute', {
      bkashPaymentId: payment.bkashPaymentId,
    });

    if (!result.success) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.FAILED },
      });
      throw new BadRequestException(`Payment failed: ${result.reason ?? 'unknown reason'}`);
    }

    const booking = await this.bookingsService.createBooking(
      {
        scheduleId: payment.scheduleId,
        seatNumbers: payment.seatNumbers,
        boardingPointId: payment.boardingPointId,
        droppingPointId: payment.droppingPointId,
      },
      userId,
    );

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.COMPLETED, bookingId: booking.id },
    });

    return booking;
  }

  private async rpc<T>(pattern: string, data: unknown): Promise<T> {
    try {
      return await firstValueFrom(this.paymentClient.send<T>(pattern, data).pipe(timeout(RPC_TIMEOUT_MS)));
    } catch (err: any) {
      if (err?.name === 'TimeoutError') {
        throw new RequestTimeoutException('Payment service did not respond in time');
      }
      throw new BadRequestException(err?.message ?? 'Payment service error');
    }
  }
}
