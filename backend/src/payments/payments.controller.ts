import { Controller, Post, Body, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('initiate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a bKash payment for currently held seats' })
  async initiate(@Body() dto: InitiatePaymentDto, @Req() req: AuthenticatedRequest) {
    const result = await this.paymentsService.initiate(dto, req.user.userId);
    return { success: true, message: 'Payment initiated', data: result };
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute a bKash payment and confirm the booking' })
  async execute(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const booking = await this.paymentsService.execute(id, req.user.userId);
    return { success: true, message: 'Payment successful, booking confirmed', data: booking };
  }
}
