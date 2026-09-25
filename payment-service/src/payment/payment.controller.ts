import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { BkashService } from '../bkash/bkash.service';

interface CreatePaymentPayload {
  amount: number;
  invoiceNumber: string;
  payerReference: string;
}

interface ExecutePaymentPayload {
  bkashPaymentId: string;
}

@Controller()
export class PaymentController {
  constructor(private bkashService: BkashService) {}

  @MessagePattern('payment.create')
  async create(@Payload() data: CreatePaymentPayload) {
    return this.bkashService.createPayment(data.amount, data.invoiceNumber, data.payerReference);
  }

  @MessagePattern('payment.execute')
  async execute(@Payload() data: ExecutePaymentPayload) {
    return this.bkashService.executePayment(data.bkashPaymentId);
  }
}
