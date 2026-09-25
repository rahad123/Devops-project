import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { randomUUID } from 'crypto';

export interface CreatePaymentResult {
  bkashPaymentId: string;
  bkashURL: string;
}

export interface ExecutePaymentResult {
  success: boolean;
  trxID?: string;
  reason?: string;
}

interface TokenCache {
  idToken: string;
  expiresAt: number;
}

@Injectable()
export class BkashService {
  private readonly logger = new Logger(BkashService.name);
  private tokenCache: TokenCache | null = null;
  private readonly mockStore = new Map<string, { amount: number; status: string }>();

  constructor(private configService: ConfigService) {}

  private get isMock(): boolean {
    return this.configService.get<string>('BKASH_MOCK', 'true') === 'true';
  }

  async createPayment(amount: number, invoiceNumber: string, payerReference: string): Promise<CreatePaymentResult> {
    if (this.isMock) {
      return this.mockCreatePayment(amount, invoiceNumber);
    }

    const idToken = await this.getToken();
    const baseUrl = this.configService.get<string>('BKASH_BASE_URL');
    const appKey = this.configService.get<string>('BKASH_APP_KEY');
    const callbackURL = this.configService.get<string>('BKASH_CALLBACK_URL');

    const res = await axios.post(
      `${baseUrl}/tokenized/checkout/create`,
      {
        mode: '0011',
        payerReference,
        callbackURL,
        amount: amount.toFixed(2),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: invoiceNumber,
      },
      { headers: { Authorization: idToken, 'X-App-Key': appKey, 'Content-Type': 'application/json' } },
    );

    return { bkashPaymentId: res.data.paymentID, bkashURL: res.data.bkashURL };
  }

  async executePayment(bkashPaymentId: string): Promise<ExecutePaymentResult> {
    if (this.isMock) {
      return this.mockExecutePayment(bkashPaymentId);
    }

    const idToken = await this.getToken();
    const baseUrl = this.configService.get<string>('BKASH_BASE_URL');
    const appKey = this.configService.get<string>('BKASH_APP_KEY');

    const res = await axios.post(
      `${baseUrl}/tokenized/checkout/execute`,
      { paymentID: bkashPaymentId },
      { headers: { Authorization: idToken, 'X-App-Key': appKey, 'Content-Type': 'application/json' } },
    );

    if (res.data.transactionStatus === 'Completed') {
      return { success: true, trxID: res.data.trxID };
    }
    return { success: false, reason: res.data.statusMessage ?? res.data.transactionStatus };
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 5000) {
      return this.tokenCache.idToken;
    }

    const baseUrl = this.configService.get<string>('BKASH_BASE_URL');
    const appKey = this.configService.get<string>('BKASH_APP_KEY');
    const appSecret = this.configService.get<string>('BKASH_APP_SECRET');
    const username = this.configService.get<string>('BKASH_USERNAME');
    const password = this.configService.get<string>('BKASH_PASSWORD');

    const res = await axios.post(
      `${baseUrl}/tokenized/checkout/token/grant`,
      { app_key: appKey, app_secret: appSecret },
      { headers: { username, password, 'Content-Type': 'application/json' } },
    );

    this.tokenCache = {
      idToken: res.data.id_token,
      expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
    };
    return this.tokenCache.idToken;
  }

  private mockCreatePayment(amount: number, invoiceNumber: string): CreatePaymentResult {
    const bkashPaymentId = `MOCK-${randomUUID()}`;
    this.mockStore.set(bkashPaymentId, { amount, status: 'Initiated' });
    this.logger.log(`[mock] created payment ${bkashPaymentId} for invoice ${invoiceNumber}, amount ${amount}`);
    return { bkashPaymentId, bkashURL: `https://sandbox.bka.sh/mock-checkout/${bkashPaymentId}` };
  }

  private mockExecutePayment(bkashPaymentId: string): ExecutePaymentResult {
    const entry = this.mockStore.get(bkashPaymentId);
    if (!entry) {
      return { success: false, reason: 'Payment not found (mock)' };
    }

    const forceFail = this.configService.get<string>('BKASH_MOCK_FORCE_FAIL', 'false') === 'true';
    if (forceFail) {
      entry.status = 'Failed';
      this.logger.warn(`[mock] forced failure for payment ${bkashPaymentId}`);
      return { success: false, reason: 'Simulated failure (BKASH_MOCK_FORCE_FAIL=true)' };
    }

    entry.status = 'Completed';
    const trxID = `MOCKTRX-${Date.now()}`;
    this.logger.log(`[mock] executed payment ${bkashPaymentId} -> ${trxID}`);
    return { success: true, trxID };
  }
}
