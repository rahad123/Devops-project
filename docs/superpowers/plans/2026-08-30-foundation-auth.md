# Foundation & Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the dockerized foundation of the Bus Ticket Management customer system: independent `/backend` (NestJS+Prisma+Postgres) and `/frontend` (React+Vite+TS) projects, a full auth flow (register/login/logout/refresh/forgot/reset password), and the static bus/route/schedule catalog schema + seed data that later sub-projects build on.

**Architecture:** Two independently dockerized Node projects with no shared code, connected by a documented REST/OpenAPI contract. Backend owns all DB access via Prisma. `docker-compose.yml` runs Postgres, backend, and frontend (Nginx-served), with Nginx proxying `/api` to backend so the containerized stack is same-origin.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, `@nestjs/jwt`, `@nestjs/throttler`, bcrypt, nodemailer, class-validator; React 18, Vite, TypeScript, react-router-dom, react-hook-form, zod, axios, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-30-foundation-auth-design.md`

## Global Constraints

- No npm workspaces, no shared package — `/backend` and `/frontend` are fully independent projects (own `package.json`, own lockfile).
- All secrets/config via environment variables, documented in root `.env.example`; real `.env` gitignored.
- Passwords hashed with bcrypt, cost factor 12.
- JWT access token expiry: 15 minutes. Refresh token expiry: 7 days, stored as httpOnly/secure/sameSite cookie named `refresh_token`.
- Auth failure messages never reveal whether an email is registered.
- All request DTOs validated with `class-validator`, global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`.
- `docker compose up --build` must bring up a fully working stack from a clean checkout with no manual steps.

## Shared Contracts (referenced across tasks — do not rename)

- **Env vars** (backend): `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN` (default `15m`), `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN` (default `7d`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `FRONTEND_URL`, `PORT` (default `3000`).
- **Env vars** (compose/postgres): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` (default `5432`).
- **Env vars** (frontend): `VITE_API_URL`.
- **JWT payload:** `{ sub: string (userId), email: string, role: 'CUSTOMER' }`.
- **Cookie:** `refresh_token`, httpOnly, secure in prod, `sameSite: 'lax'`.
- **PrismaService:** `backend/src/prisma/prisma.service.ts`, exported by a global `PrismaModule`.
- **AuthService methods** (`backend/src/auth/auth.service.ts`):
  - `register(dto: RegisterDto): Promise<{ accessToken: string; refreshToken: string }>`
  - `login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }>`
  - `refresh(rawRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }>`
  - `logout(rawRefreshToken: string): Promise<void>`
  - `forgotPassword(email: string): Promise<void>`
  - `resetPassword(token: string, newPassword: string): Promise<void>`
- **DTOs** (`backend/src/auth/dto/*.dto.ts`): `RegisterDto { name, phone, email, password }`, `LoginDto { email, password }`, `ForgotPasswordDto { email }`, `ResetPasswordDto { token, newPassword }`.
- **Guards/decorators:** `@Public()` (`backend/src/auth/decorators/public.decorator.ts`), `JwtAuthGuard`, `CustomerOnlyGuard` (`backend/src/auth/guards/`).
- **MailService:** `backend/src/mail/mail.service.ts` — `sendPasswordResetEmail(to: string, resetLink: string): Promise<void>`.
- **Frontend API client:** `frontend/src/api/client.ts` exports `apiClient` (axios instance, `baseURL: import.meta.env.VITE_API_URL`, `withCredentials: true`).
- **Frontend auth API:** `frontend/src/api/auth.ts` exports `registerRequest`, `loginRequest`, `logoutRequest`, `forgotPasswordRequest`, `resetPasswordRequest`, `refreshRequest`.
- **AuthContext:** `frontend/src/context/AuthContext.tsx` exports `AuthProvider`, `useAuth()` → `{ user, login, register, logout, isLoading }`.

---

### Task 1: Backend project scaffold

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/nest-cli.json`
- Create: `backend/src/main.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/health/health.controller.ts`
- Create: `backend/src/common/filters/all-exceptions.filter.ts`
- Create: `backend/src/auth/decorators/public.decorator.ts`
- Test: `backend/test/health.e2e-spec.ts`

**Interfaces:**
- Produces: `@Public()` decorator (used by every unauthenticated auth route in later tasks), `AllExceptionsFilter` (registered globally, normalizes error shape to `{ statusCode, message, error, path, timestamp }`).

- [ ] **Step 1: Scaffold the Nest project**

Run: `npx @nestjs/cli new backend --package-manager npm --skip-git` from the repo root, then `cd backend`.

- [ ] **Step 2: Install auth/config/docs dependencies**

Run inside `backend/`:
```bash
npm install @nestjs/config @nestjs/jwt @nestjs/throttler @nestjs/swagger \
  bcrypt class-validator class-transformer cookie-parser nodemailer uuid
npm install -D @types/bcrypt @types/cookie-parser @types/nodemailer @types/uuid
```

- [ ] **Step 3: Write the `@Public()` decorator**

```typescript
// backend/src/auth/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 4: Write the global exception filter**

```typescript
// backend/src/common/filters/all-exceptions.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const statusCode = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp ? exception.getResponse() : null;
    const message =
      body && typeof body === 'object' && 'message' in body
        ? (body as { message: string | string[] }).message
        : isHttp
          ? exception.message
          : 'Internal server error';

    response.status(statusCode).json({
      statusCode,
      message,
      error: isHttp ? exception.name : 'InternalServerError',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 5: Write `main.ts` wiring global pipe, filter, cookie-parser, CORS, Swagger**

```typescript
// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('Bus Ticket Management API')
    .setDescription('Customer module API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 6: Write the health controller**

```typescript
// backend/src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 7: Wire `app.module.ts` with ConfigModule and HealthController**

```typescript
// backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 8: Write the failing e2e test for `/health`**

```typescript
// backend/test/health.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
```

- [ ] **Step 9: Run the e2e test and confirm it passes**

Run: `npm run test:e2e` (from `backend/`)
Expected: PASS — `HealthController (e2e) > GET /health returns ok`

- [ ] **Step 10: Commit**

```bash
git add backend
git commit -m "feat(backend): scaffold NestJS app with global pipe, filter, swagger, health check"
```

---

### Task 2: docker-compose Postgres service + root env/gitignore

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Produces: a running Postgres reachable at `localhost:${POSTGRES_PORT}` for all subsequent local dev/test work; `DATABASE_URL` format `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}`.

- [ ] **Step 1: Write root `.gitignore`**

```
node_modules/
dist/
.env
*.log
.DS_Store
```

- [ ] **Step 2: Write `.env.example`**

```bash
# Postgres
POSTGRES_USER=busticket
POSTGRES_PASSWORD=changeme
POSTGRES_DB=busticket
POSTGRES_PORT=5432

# Backend
DATABASE_URL=postgresql://busticket:changeme@localhost:5432/busticket
JWT_ACCESS_SECRET=changeme-access-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=changeme-refresh-secret
JWT_REFRESH_EXPIRES_IN=7d
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=no-reply@busticket.local
FRONTEND_URL=http://localhost:5173
PORT=3000

# Stripe (reserved for sub-project 3, leave blank for now)
STRIPE_SECRET_KEY=

# Frontend
VITE_API_URL=http://localhost:3000
```

- [ ] **Step 3: Write `docker-compose.yml` with only the postgres service for now**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - '${POSTGRES_PORT:-5432}:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
```

- [ ] **Step 4: Copy `.env.example` to `.env` and bring up postgres**

Run: `cp .env.example .env && docker compose up -d postgres`

- [ ] **Step 5: Verify it's healthy**

Run: `docker compose ps`
Expected: `postgres` service shows `healthy` status within ~10 seconds.

- [ ] **Step 6: Copy the root `.env` into `backend/` for local (non-Docker) tooling**

Run: `cp .env backend/.env`

This is required because every later backend task runs Prisma CLI commands and `npm run test:e2e` from inside `backend/`, and both Prisma and NestJS's `ConfigModule` resolve `.env` relative to the current working directory — they will not find the root-level `.env` created in Step 4. The root `.env` remains the single file you edit by hand; re-run this copy if you change root `.env` values before a later task needs them. Docker Compose itself does not need this copy — it reads the root `.env` directly for variable interpolation.

- [ ] **Step 7: Add `backend/.env` to `.gitignore` explicitly (defense in depth)**

The root `.gitignore`'s `.env` pattern already matches `backend/.env`, but confirm it:

Run: `git check-ignore backend/.env`
Expected: prints `backend/.env` (confirms it's ignored).

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example .gitignore
git commit -m "chore: add docker-compose postgres service and root env template"
```

---

### Task 3: Prisma setup + auth schema + PrismaService

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/prisma/prisma.module.ts`
- Create: `backend/src/prisma/prisma.service.ts`
- Modify: `backend/src/app.module.ts` (import `PrismaModule`)
- Test: `backend/test/prisma.e2e-spec.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` from Task 2's `.env`.
- Produces: `PrismaService` (injectable, extends `PrismaClient`), `PrismaModule` (`@Global()`, exports `PrismaService`) — every later backend task injects `PrismaService` via `PrismaModule`.

- [ ] **Step 1: Install Prisma and initialize**

Run inside `backend/`: `npm install prisma @prisma/client && npx prisma init --datasource-provider postgresql`

- [ ] **Step 2: Write the schema (auth tables only for this task)**

```prisma
// backend/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  CUSTOMER
}

model User {
  id                 String              @id @default(uuid())
  name               String
  phone              String
  email              String              @unique
  passwordHash       String
  role               Role                @default(CUSTOMER)
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
  refreshTokens      RefreshToken[]
  passwordResetTokens PasswordResetToken[]
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  tokenHash String
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())
}

model PasswordResetToken {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  tokenHash String
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
}
```

- [ ] **Step 3: Run the initial migration against the dockerized Postgres**

Run: `npx prisma migrate dev --name init_auth` (from `backend/`, with `.env` present)
Expected: migration files created under `backend/prisma/migrations/`, applied successfully.

- [ ] **Step 4: Write `PrismaService`**

```typescript
// backend/src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- [ ] **Step 5: Write `PrismaModule`**

```typescript
// backend/src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 6: Import `PrismaModule` in `app.module.ts`**

```typescript
// backend/src/app.module.ts (add to imports array)
import { PrismaModule } from './prisma/prisma.module';
// imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
```

- [ ] **Step 7: Write the failing e2e test verifying DB connectivity**

```typescript
// backend/test/prisma.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaModule } from '../src/prisma/prisma.module';

describe('PrismaService (e2e)', () => {
  it('connects and can create + read a user row', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();
    const prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        name: 'Test User',
        phone: '1234567890',
        email: `prisma-test-${Date.now()}@example.com`,
        passwordHash: 'irrelevant-for-this-test',
      },
    });

    const found = await prisma.user.findUnique({ where: { id: user.id } });
    expect(found?.email).toBe(user.email);

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 8: Run the e2e test and confirm it passes**

Run: `npm run test:e2e` (from `backend/`, with `docker compose up -d postgres` running)
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/prisma backend/src/prisma backend/src/app.module.ts backend/package.json backend/package-lock.json
git commit -m "feat(backend): add Prisma schema for auth tables and PrismaService"
```

---

### Task 4: Register endpoint

**Files:**
- Create: `backend/src/auth/dto/register.dto.ts`
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/auth.module.ts`
- Modify: `backend/src/app.module.ts` (import `AuthModule`)
- Test: `backend/src/auth/auth.service.spec.ts`
- Test: `backend/test/auth-register.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 3), `@Public()` (Task 1).
- Produces: `AuthService.register()`, `RegisterDto`, `POST /auth/register` — later tasks (login, guards) extend `AuthModule`/`AuthService`/`AuthController` in place.

- [ ] **Step 1: Install jwt/bcrypt already done in Task 1; write `RegisterDto`**

```typescript
// backend/src/auth/dto/register.dto.ts
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'phone must be a valid number' })
  phone: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password: string;
}
```

- [ ] **Step 2: Write the failing unit test for `AuthService.register`**

```typescript
// backend/src/auth/auth.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

describe('AuthService.register', () => {
  let service: AuthService;
  let prisma: { user: any };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('signed-token') },
        },
        { provide: MailService, useValue: { sendPasswordResetEmail: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('creates a user with a hashed password and returns tokens', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      role: 'CUSTOMER',
    });

    const result = await service.register({
      name: 'A',
      phone: '1234567890',
      email: 'a@example.com',
      password: 'password123',
    });

    expect(prisma.user.create).toHaveBeenCalled();
    const createArg = prisma.user.create.mock.calls[0][0].data;
    expect(createArg.passwordHash).not.toBe('password123');
    expect(result.accessToken).toBe('signed-token');
    expect(result.refreshToken).toBeDefined();
  });

  it('throws ConflictException when email already exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      service.register({
        name: 'A',
        phone: '1234567890',
        email: 'a@example.com',
        password: 'password123',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2b: Run the unit test to confirm it fails**

Run: `npm run test -- auth.service.spec.ts` (from `backend/`)
Expected: FAIL — `AuthService` not found / module not found.

- [ ] **Step 3: Write `AuthService` with `register()` (refresh token issuance inlined, refined in Task 5)**

```typescript
// backend/src/auth/auth.service.ts
import { ConflictException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  private signAccessToken(user: { id: string; email: string; role: string }) {
    return this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      },
    );
  }

  private async issueRefreshToken(userId: string) {
    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return rawToken;
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        passwordHash,
      },
    });

    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id);
    return { accessToken, refreshToken };
  }
}
```

- [ ] **Step 4: Write a minimal `MailService` stub (fleshed out in Task 8)**

```typescript
// backend/src/mail/mail.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class MailService {
  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    // Implemented in Task 8 with a real SMTP transport.
    void to;
    void resetLink;
  }
}
```

```typescript
// backend/src/mail/mail.module.ts
import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
```

- [ ] **Step 5: Write `AuthController` with `POST /auth/register`**

```typescript
// backend/src/auth/auth.controller.ts
import { Body, Controller, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { Public } from './decorators/public.decorator';

const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.register(dto);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }
}
```

- [ ] **Step 6: Write `AuthModule`**

```typescript
// backend/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [JwtModule.register({}), MailModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 7: Import `AuthModule` in `app.module.ts`**

Add `AuthModule` to the `imports` array alongside `ConfigModule` and `PrismaModule`.

- [ ] **Step 8: Run the unit test and confirm it passes**

Run: `npm run test -- auth.service.spec.ts`
Expected: PASS (both cases)

- [ ] **Step 9: Write the failing e2e test for `POST /auth/register`**

```typescript
// backend/test/auth-register.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth register (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a new customer and returns an access token', async () => {
    const email = `register-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Jane', phone: '9876543210', email, password: 'password123' })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/refresh_token=/);

    await prisma.refreshToken.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
  });

  it('rejects a duplicate email with 409', async () => {
    const email = `register-dup-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Jane', phone: '9876543210', email, password: 'password123' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Jane', phone: '9876543210', email, password: 'password123' })
      .expect(409);

    await prisma.refreshToken.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
  });
});
```

- [ ] **Step 10: Run the e2e test and confirm it passes**

Run: `npm run test:e2e` (with `docker compose up -d postgres` running)
Expected: PASS (both cases)

- [ ] **Step 11: Commit**

```bash
git add backend/src/auth backend/src/mail backend/src/app.module.ts backend/test
git commit -m "feat(backend): add register endpoint with hashed passwords and refresh token issuance"
```

---

### Task 5: Login endpoint

**Files:**
- Create: `backend/src/auth/dto/login.dto.ts`
- Modify: `backend/src/auth/auth.service.ts` (add `login()`)
- Modify: `backend/src/auth/auth.controller.ts` (add `POST /auth/login`)
- Test: `backend/src/auth/auth.service.spec.ts` (add login cases)
- Test: `backend/test/auth-login.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthService`, `bcrypt`, `signAccessToken`/`issueRefreshToken` private helpers from Task 4.
- Produces: `AuthService.login()`, `LoginDto`, `POST /auth/login`.

- [ ] **Step 1: Write `LoginDto`**

```typescript
// backend/src/auth/dto/login.dto.ts
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
```

- [ ] **Step 2: Add the failing unit test cases**

```typescript
// append inside backend/src/auth/auth.service.spec.ts, new describe block
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService.login', () => {
  let service: AuthService;
  let prisma: { user: any; refreshToken: any };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      refreshToken: { create: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('signed-token') } },
        { provide: MailService, useValue: { sendPasswordResetEmail: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('returns tokens for correct credentials', async () => {
    const passwordHash = await bcrypt.hash('password123', 12);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      role: 'CUSTOMER',
      passwordHash,
    });

    const result = await service.login({ email: 'a@example.com', password: 'password123' });
    expect(result.accessToken).toBe('signed-token');
    expect(result.refreshToken).toBeDefined();
  });

  it('throws UnauthorizedException for wrong password', async () => {
    const passwordHash = await bcrypt.hash('password123', 12);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      role: 'CUSTOMER',
      passwordHash,
    });

    await expect(
      service.login({ email: 'a@example.com', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for unknown email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ email: 'missing@example.com', password: 'password123' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 3: Run to confirm the new tests fail**

Run: `npm run test -- auth.service.spec.ts`
Expected: FAIL — `service.login is not a function`

- [ ] **Step 4: Add `login()` to `AuthService`**

```typescript
// backend/src/auth/auth.service.ts — add import + method
import { UnauthorizedException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';

// inside AuthService class
async login(dto: LoginDto) {
  const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
  if (!user) {
    throw new UnauthorizedException('Invalid email or password');
  }

  const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
  if (!passwordMatches) {
    throw new UnauthorizedException('Invalid email or password');
  }

  const accessToken = this.signAccessToken(user);
  const refreshToken = await this.issueRefreshToken(user.id);
  return { accessToken, refreshToken };
}
```

- [ ] **Step 5: Add `POST /auth/login` to `AuthController`**

```typescript
// backend/src/auth/auth.controller.ts — add import + method
import { LoginDto } from './dto/login.dto';

@Public()
@Post('login')
async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
  const { accessToken, refreshToken } = await this.authService.login(dto);
  this.setRefreshCookie(res, refreshToken);
  return { accessToken };
}
```

- [ ] **Step 6: Run the unit tests and confirm they pass**

Run: `npm run test -- auth.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Write the failing e2e test**

```typescript
// backend/test/auth-login.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth login (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `login-${Date.now()}@example.com`;
  const password = 'password123';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Login Test', phone: '9876543210', email, password });
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/refresh_token=/);
  });

  it('rejects wrong password with a generic 401 message', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
    expect(res.body.message).toBe('Invalid email or password');
  });
});
```

- [ ] **Step 8: Run the e2e test and confirm it passes**

Run: `npm run test:e2e`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/src/auth backend/test
git commit -m "feat(backend): add login endpoint with generic invalid-credentials error"
```

---

### Task 6: JWT guard, Public decorator wiring, CustomerOnlyGuard

**Files:**
- Create: `backend/src/auth/strategies/jwt.strategy.ts`
- Create: `backend/src/auth/guards/jwt-auth.guard.ts`
- Create: `backend/src/auth/guards/customer-only.guard.ts`
- Modify: `backend/src/auth/auth.module.ts` (register `JwtModule` config, strategy, export guards)
- Modify: `backend/src/app.module.ts` (register `JwtAuthGuard` and `CustomerOnlyGuard` as global `APP_GUARD`s)
- Create: `backend/src/health/protected-ping.controller.ts` (temporary route used only to prove the guard works; kept as a real authenticated smoke-test endpoint)
- Test: `backend/test/auth-guard.e2e-spec.ts`

**Interfaces:**
- Consumes: `@Public()` (Task 1), JWT payload shape `{ sub, email, role }` (Task 4/5).
- Produces: every controller in later tasks is protected by default; `req.user = { userId, email, role }` available after this task.

- [ ] **Step 1: Install passport packages**

Run inside `backend/`: `npm install @nestjs/passport passport passport-jwt && npm install -D @types/passport-jwt`

- [ ] **Step 2: Write the JWT strategy**

```typescript
// backend/src/auth/strategies/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET as string,
    });
  }

  async validate(payload: JwtPayload) {
    return { userId: payload.sub, email: payload.email, role: payload.role };
  }
}
```

- [ ] **Step 3: Write `JwtAuthGuard` that respects `@Public()`**

```typescript
// backend/src/auth/guards/jwt-auth.guard.ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
```

- [ ] **Step 4: Write `CustomerOnlyGuard`**

```typescript
// backend/src/auth/guards/customer-only.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class CustomerOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    if (request.user?.role !== 'CUSTOMER') {
      throw new ForbiddenException('Customer access only');
    }
    return true;
  }
}
```

- [ ] **Step 5: Register `JwtStrategy` in `AuthModule` and export the guards**

```typescript
// backend/src/auth/auth.module.ts — updated
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MailModule } from '../mail/mail.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CustomerOnlyGuard } from './guards/customer-only.guard';

@Module({
  imports: [PassportModule, JwtModule.register({}), MailModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, CustomerOnlyGuard],
  exports: [AuthService, JwtAuthGuard, CustomerOnlyGuard],
})
export class AuthModule {}
```

- [ ] **Step 6: Register both guards globally in `app.module.ts`**

```typescript
// backend/src/app.module.ts — updated
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { ProtectedPingController } from './health/protected-ping.controller';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CustomerOnlyGuard } from './auth/guards/customer-only.guard';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule],
  controllers: [HealthController, ProtectedPingController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CustomerOnlyGuard },
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Write the protected smoke-test controller**

```typescript
// backend/src/health/protected-ping.controller.ts
import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';

@Controller('protected-ping')
export class ProtectedPingController {
  @Get()
  ping(@Req() req: Request) {
    return { message: 'pong', userId: (req as any).user.userId };
  }
}
```

- [ ] **Step 8: Write the failing e2e test**

```typescript
// backend/test/auth-guard.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth guard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `guard-${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Guard Test', phone: '9876543210', email, password });
    accessToken = res.body.accessToken;
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('rejects an unauthenticated request with 401', () => {
    return request(app.getHttpServer()).get('/protected-ping').expect(401);
  });

  it('allows an authenticated request with 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/protected-ping')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.message).toBe('pong');
  });
});
```

- [ ] **Step 9: Run the e2e test and confirm it passes**

Run: `npm run test:e2e`
Expected: PASS — unauthenticated 401, authenticated 200; existing `/health`, `/auth/register`, `/auth/login` e2e tests still pass since those routes are `@Public()`.

- [ ] **Step 10: Commit**

```bash
git add backend/src/auth backend/src/app.module.ts backend/src/health backend/test backend/package.json backend/package-lock.json
git commit -m "feat(backend): add JWT auth guard and customer-only guard applied globally"
```

---

### Task 7: Refresh and logout endpoints

**Files:**
- Modify: `backend/src/auth/auth.service.ts` (add `refresh()`, `logout()`)
- Modify: `backend/src/auth/auth.controller.ts` (add `POST /auth/refresh`, `POST /auth/logout`)
- Test: `backend/src/auth/auth.service.spec.ts` (add refresh/logout cases)
- Test: `backend/test/auth-refresh-logout.e2e-spec.ts`

**Interfaces:**
- Consumes: `RefreshToken` model (Task 3), `issueRefreshToken`/`signAccessToken` helpers (Task 4).
- Produces: `AuthService.refresh()`, `AuthService.logout()`, `POST /auth/refresh`, `POST /auth/logout`.

- [ ] **Step 1: Add failing unit tests for refresh/logout**

```typescript
// append to backend/src/auth/auth.service.spec.ts
import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthService.refresh / logout', () => {
  let service: AuthService;
  let prisma: { refreshToken: any; user: any };

  beforeEach(async () => {
    prisma = {
      refreshToken: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('signed-token') } },
        { provide: MailService, useValue: { sendPasswordResetEmail: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('issues a new access token for a valid, unexpired, unrevoked refresh token', async () => {
    const rawToken = 'raw-refresh-token';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    prisma.refreshToken.findFirst.mockResolvedValue({
      id: 'rt-1',
      userId: 'user-1',
      tokenHash,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      revokedAt: null,
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', role: 'CUSTOMER' });

    const result = await service.refresh(rawToken);
    expect(result.accessToken).toBe('signed-token');
  });

  it('throws UnauthorizedException for an unknown/expired/revoked refresh token', async () => {
    prisma.refreshToken.findFirst.mockResolvedValue(null);
    await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
  });

  it('logout revokes the matching refresh token', async () => {
    const rawToken = 'raw-refresh-token';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    prisma.refreshToken.findFirst.mockResolvedValue({ id: 'rt-1', tokenHash });

    await service.logout(rawToken);
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'rt-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test -- auth.service.spec.ts`
Expected: FAIL — `service.refresh is not a function`

- [ ] **Step 3: Add `refresh()` and `logout()` to `AuthService`**

```typescript
// backend/src/auth/auth.service.ts — add imports + methods
// (crypto already imported in Task 4)

private hashToken(rawToken: string) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async refresh(rawRefreshToken: string) {
  const tokenHash = this.hashToken(rawRefreshToken);
  const stored = await this.prisma.refreshToken.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!stored) {
    throw new UnauthorizedException('Invalid or expired refresh token');
  }

  const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user) {
    throw new UnauthorizedException('Invalid or expired refresh token');
  }

  await this.prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const accessToken = this.signAccessToken(user);
  const refreshToken = await this.issueRefreshToken(user.id);
  return { accessToken, refreshToken };
}

async logout(rawRefreshToken: string) {
  const tokenHash = this.hashToken(rawRefreshToken);
  const stored = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });
  if (stored) {
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Add `POST /auth/refresh` and `POST /auth/logout` to `AuthController`**

```typescript
// backend/src/auth/auth.controller.ts — add imports + methods
import { Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Public()
@Post('refresh')
async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
  const rawRefreshToken = req.cookies?.refresh_token;
  if (!rawRefreshToken) {
    throw new UnauthorizedException('Missing refresh token');
  }
  const { accessToken, refreshToken } = await this.authService.refresh(rawRefreshToken);
  this.setRefreshCookie(res, refreshToken);
  return { accessToken };
}

@Post('logout')
async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
  const rawRefreshToken = req.cookies?.refresh_token;
  if (rawRefreshToken) {
    await this.authService.logout(rawRefreshToken);
  }
  res.clearCookie('refresh_token');
  return { success: true };
}
```

Note: `/auth/logout` is intentionally NOT `@Public()` — it requires a valid access token, matching the spec.

- [ ] **Step 5: Run unit tests and confirm they pass**

Run: `npm run test -- auth.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Write the failing e2e test**

```typescript
// backend/test/auth-refresh-logout.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

function extractCookie(res: request.Response) {
  const raw = res.headers['set-cookie'][0] as string;
  return raw.split(';')[0];
}

describe('Auth refresh/logout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `refresh-${Date.now()}@example.com`;
  const password = 'password123';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('refreshes an access token using the refresh cookie, then logout revokes it', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Refresh Test', phone: '9876543210', email, password });
    const cookie = extractCookie(registerRes);

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookie)
      .expect(201);
    expect(refreshRes.body.accessToken).toBeDefined();
    const newCookie = extractCookie(refreshRes);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', newCookie)
      .set('Authorization', `Bearer ${refreshRes.body.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', newCookie)
      .expect(401);
  });
});
```

- [ ] **Step 7: Run the e2e test and confirm it passes**

Run: `npm run test:e2e`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/src/auth backend/test
git commit -m "feat(backend): add refresh and logout endpoints with token revocation"
```

---

### Task 8: Mail module + forgot-password endpoint

**Files:**
- Modify: `backend/src/mail/mail.service.ts` (real nodemailer implementation)
- Modify: `backend/src/auth/auth.service.ts` (add `forgotPassword()`)
- Modify: `backend/src/auth/auth.controller.ts` (add `POST /auth/forgot-password`)
- Create: `backend/src/auth/dto/forgot-password.dto.ts`
- Test: `backend/src/mail/mail.service.spec.ts`
- Test: `backend/src/auth/auth.service.spec.ts` (add forgotPassword cases)
- Test: `backend/test/auth-forgot-password.e2e-spec.ts`

**Interfaces:**
- Consumes: `PasswordResetToken` model (Task 3), `SMTP_*`/`FRONTEND_URL` env vars.
- Produces: `MailService.sendPasswordResetEmail()` (real implementation), `AuthService.forgotPassword()`, `POST /auth/forgot-password`.

- [ ] **Step 1: Write the failing `MailService` unit test**

```typescript
// backend/src/mail/mail.service.spec.ts
import { MailService } from './mail.service';

const sendMailMock = jest.fn().mockResolvedValue(undefined);
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
}));

describe('MailService', () => {
  it('sends a password reset email with the reset link in the body', async () => {
    const service = new MailService();
    await service.sendPasswordResetEmail('user@example.com', 'https://app.local/reset?token=abc');

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('Reset your password'),
        html: expect.stringContaining('https://app.local/reset?token=abc'),
      }),
    );
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm run test -- mail.service.spec.ts`
Expected: FAIL (current stub never calls `sendMail`)

- [ ] **Step 3: Implement `MailService` with nodemailer**

```typescript
// backend/src/mail/mail.service.ts
import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.SMTP_FROM ?? 'no-reply@busticket.local',
      to,
      subject: 'Reset your password',
      html: `<p>Click the link below to reset your password. This link expires in 30 minutes.</p><p><a href="${resetLink}">${resetLink}</a></p>`,
    });
  }
}
```

- [ ] **Step 4: Run the mail unit test and confirm it passes**

Run: `npm run test -- mail.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write `ForgotPasswordDto`**

```typescript
// backend/src/auth/dto/forgot-password.dto.ts
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}
```

- [ ] **Step 6: Add the failing unit test for `AuthService.forgotPassword`**

```typescript
// append to backend/src/auth/auth.service.spec.ts
describe('AuthService.forgotPassword', () => {
  let service: AuthService;
  let prisma: { user: any; passwordResetToken: any };
  let mail: { sendPasswordResetEmail: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      passwordResetToken: { create: jest.fn() },
    };
    mail = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('sends a reset email when the user exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com' });

    await service.forgotPassword('a@example.com');

    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledWith(
      'a@example.com',
      expect.stringContaining('reset-password?token='),
    );
  });

  it('does nothing (but does not throw) when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.forgotPassword('missing@example.com')).resolves.toBeUndefined();
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run to confirm failure**

Run: `npm run test -- auth.service.spec.ts`
Expected: FAIL — `service.forgotPassword is not a function`

- [ ] **Step 8: Add `forgotPassword()` to `AuthService`**

```typescript
// backend/src/auth/auth.service.ts — add method
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

async forgotPassword(email: string) {
  const user = await this.prisma.user.findUnique({ where: { email } });
  if (!user) {
    return;
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = this.hashToken(rawToken);
  await this.prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  });

  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`;
  await this.mail.sendPasswordResetEmail(user.email, resetLink);
}
```

- [ ] **Step 9: Add `POST /auth/forgot-password` to `AuthController`**

```typescript
// backend/src/auth/auth.controller.ts — add import + method
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@Public()
@Post('forgot-password')
async forgotPassword(@Body() dto: ForgotPasswordDto) {
  await this.authService.forgotPassword(dto.email);
  return { message: 'If that email is registered, a reset link has been sent.' };
}
```

- [ ] **Step 10: Run unit tests and confirm they pass**

Run: `npm run test -- auth.service.spec.ts`
Expected: PASS

- [ ] **Step 11: Write the failing e2e test**

```typescript
// backend/test/auth-forgot-password.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/mail/mail.service';

describe('Auth forgot-password (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `forgot-${Date.now()}@example.com`;
  const password = 'password123';
  const sendMailSpy = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ sendPasswordResetEmail: sendMailSpy })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Forgot Test', phone: '9876543210', email, password });
  });

  afterAll(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { user: { email } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('returns the same generic message whether or not the email exists', async () => {
    const known = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(201);
    const unknown = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(201);

    expect(known.body.message).toBe(unknown.body.message);
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 12: Run the e2e test and confirm it passes**

Run: `npm run test:e2e`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add backend/src/mail backend/src/auth backend/test
git commit -m "feat(backend): add SMTP mail service and forgot-password endpoint"
```

---

### Task 9: Reset-password endpoint

**Files:**
- Create: `backend/src/auth/dto/reset-password.dto.ts`
- Modify: `backend/src/auth/auth.service.ts` (add `resetPassword()`)
- Modify: `backend/src/auth/auth.controller.ts` (add `POST /auth/reset-password`)
- Test: `backend/src/auth/auth.service.spec.ts` (add resetPassword cases)
- Test: `backend/test/auth-reset-password.e2e-spec.ts`

**Interfaces:**
- Consumes: `PasswordResetToken` model (Task 3), `hashToken()` helper (Task 7).
- Produces: `AuthService.resetPassword()`, `POST /auth/reset-password`.

- [ ] **Step 1: Write `ResetPasswordDto`**

```typescript
// backend/src/auth/dto/reset-password.dto.ts
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  newPassword: string;
}
```

- [ ] **Step 2: Add failing unit tests**

```typescript
// append to backend/src/auth/auth.service.spec.ts
import { BadRequestException } from '@nestjs/common';

describe('AuthService.resetPassword', () => {
  let service: AuthService;
  let prisma: {
    passwordResetToken: any;
    user: any;
    refreshToken: any;
  };

  beforeEach(async () => {
    prisma = {
      passwordResetToken: { findFirst: jest.fn(), update: jest.fn() },
      user: { update: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: MailService, useValue: { sendPasswordResetEmail: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('updates the password and revokes all refresh tokens for a valid token', async () => {
    prisma.passwordResetToken.findFirst.mockResolvedValue({
      id: 'prt-1',
      userId: 'user-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60),
    });

    await service.resetPassword('raw-token', 'newpassword123');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 'prt-1' },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('throws BadRequestException for an unknown/expired/used token', async () => {
    prisma.passwordResetToken.findFirst.mockResolvedValue(null);
    await expect(service.resetPassword('bad-token', 'newpassword123')).rejects.toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm run test -- auth.service.spec.ts`
Expected: FAIL — `service.resetPassword is not a function`

- [ ] **Step 4: Add `resetPassword()` to `AuthService`**

```typescript
// backend/src/auth/auth.service.ts — add import + method
import { BadRequestException } from '@nestjs/common';

async resetPassword(rawToken: string, newPassword: string) {
  const tokenHash = this.hashToken(rawToken);
  const stored = await this.prisma.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!stored) {
    throw new BadRequestException('Invalid or expired reset token');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await this.prisma.user.update({
    where: { id: stored.userId },
    data: { passwordHash },
  });
  await this.prisma.passwordResetToken.update({
    where: { id: stored.id },
    data: { usedAt: new Date() },
  });
  await this.prisma.refreshToken.updateMany({
    where: { userId: stored.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
```

- [ ] **Step 5: Add `POST /auth/reset-password` to `AuthController`**

```typescript
// backend/src/auth/auth.controller.ts — add import + method
import { ResetPasswordDto } from './dto/reset-password.dto';

@Public()
@Post('reset-password')
async resetPassword(@Body() dto: ResetPasswordDto) {
  await this.authService.resetPassword(dto.token, dto.newPassword);
  return { message: 'Password has been reset successfully.' };
}
```

- [ ] **Step 6: Run unit tests and confirm they pass**

Run: `npm run test -- auth.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Write the failing e2e test covering happy path, expired, and reused tokens**

```typescript
// backend/test/auth-reset-password.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth reset-password (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `reset-${Date.now()}@example.com`;
  const password = 'password123';
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Reset Test', phone: '9876543210', email, password });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  async function createResetToken(overrides: { expired?: boolean; used?: boolean } = {}) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: overrides.expired
          ? new Date(Date.now() - 1000)
          : new Date(Date.now() + 1000 * 60 * 30),
        usedAt: overrides.used ? new Date() : null,
      },
    });
    return rawToken;
  }

  it('resets the password with a valid token, and revokes refresh tokens', async () => {
    const rawToken = await createResetToken();
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'newpassword456' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'newpassword456' })
      .expect(201);
  });

  it('rejects an expired token', async () => {
    const rawToken = await createResetToken({ expired: true });
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'anotherpassword' })
      .expect(400);
  });

  it('rejects an already-used token', async () => {
    const rawToken = await createResetToken({ used: true });
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, newPassword: 'anotherpassword' })
      .expect(400);
  });
});
```

- [ ] **Step 8: Run the e2e test and confirm it passes**

Run: `npm run test:e2e`
Expected: PASS (all three cases)

- [ ] **Step 9: Commit**

```bash
git add backend/src/auth backend/test
git commit -m "feat(backend): add reset-password endpoint with token invalidation and forced re-login"
```

---

### Task 10: Rate limiting on login and forgot-password

**Files:**
- Modify: `backend/src/app.module.ts` (register `ThrottlerModule`, global `ThrottlerGuard`)
- Modify: `backend/src/auth/auth.controller.ts` (add `@Throttle` to `login`/`forgotPassword`)
- Test: `backend/test/auth-rate-limit.e2e-spec.ts`

**Interfaces:**
- Consumes: `@nestjs/throttler` (installed in Task 1).
- Produces: 429 responses on excessive login/forgot-password attempts — no new names consumed by later tasks.

- [ ] **Step 1: Register `ThrottlerModule` in `app.module.ts`**

```typescript
// backend/src/app.module.ts — add imports + provider
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

// imports array: add ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }])
// providers array: add { provide: APP_GUARD, useClass: ThrottlerGuard }
```

Full updated `imports`/`providers` arrays:

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]),
    PrismaModule,
    AuthModule,
  ],
  controllers: [HealthController, ProtectedPingController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CustomerOnlyGuard },
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Add stricter per-route throttling to `login` and `forgotPassword`**

```typescript
// backend/src/auth/auth.controller.ts — add import
import { Throttle } from '@nestjs/throttler';

// decorate the existing methods:
@Public()
@Throttle({ default: { limit: 5, ttl: 60000 } })
@Post('login')
async login(...) { ... }

@Public()
@Throttle({ default: { limit: 5, ttl: 60000 } })
@Post('forgot-password')
async forgotPassword(...) { ... }
```

- [ ] **Step 3: Write the failing e2e test**

```typescript
// backend/test/auth-rate-limit.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth rate limiting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `ratelimit-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('returns 429 after exceeding the login rate limit', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong' });
    }
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong' });
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 4: Run the e2e test and confirm it passes**

Run: `npm run test:e2e`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.module.ts backend/src/auth/auth.controller.ts backend/test backend/package.json backend/package-lock.json
git commit -m "feat(backend): rate-limit login and forgot-password endpoints"
```

---

### Task 11: Catalog schema + seed data

**Files:**
- Modify: `backend/prisma/schema.prisma` (add `Operator`, `Bus`, `Seat`, `Route`, `Schedule`, `BoardingPoint`, `DroppingPoint`)
- Create: `backend/prisma/seed.ts`
- Modify: `backend/package.json` (add `prisma.seed` config)
- Test: `backend/test/seed.e2e-spec.ts`

**Interfaces:**
- Produces: catalog tables and seeded rows that sub-project 2 (search) will query directly by model name — no service layer built in this phase.

- [ ] **Step 1: Add catalog models to the schema**

```prisma
// append to backend/prisma/schema.prisma

enum BusType {
  AC_SEATER
  AC_SLEEPER
  NON_AC_SEATER
  NON_AC_SLEEPER
}

enum Deck {
  LOWER
  UPPER
}

enum SeatType {
  SEATER
  SLEEPER
}

model Operator {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  buses     Bus[]
}

model Bus {
  id         String     @id @default(uuid())
  operatorId String
  operator   Operator   @relation(fields: [operatorId], references: [id])
  name       String
  busType    BusType
  totalSeats Int
  seats      Seat[]
  schedules  Schedule[]
}

model Seat {
  id       String   @id @default(uuid())
  busId    String
  bus      Bus      @relation(fields: [busId], references: [id])
  seatNumber String
  deck     Deck
  seatType SeatType
  row      Int
  column   Int

  @@unique([busId, seatNumber])
}

model Route {
  id          String     @id @default(uuid())
  source      String
  destination String
  distanceKm  Int?
  schedules   Schedule[]
}

model Schedule {
  id             String           @id @default(uuid())
  busId          String
  bus            Bus              @relation(fields: [busId], references: [id])
  routeId        String
  route          Route            @relation(fields: [routeId], references: [id])
  departureTime  DateTime
  arrivalTime    DateTime
  fare           Decimal          @db.Decimal(10, 2)
  serviceCharge  Decimal          @default(0) @db.Decimal(10, 2)
  boardingPoints BoardingPoint[]
  droppingPoints DroppingPoint[]
}

model BoardingPoint {
  id         String   @id @default(uuid())
  scheduleId String
  schedule   Schedule @relation(fields: [scheduleId], references: [id])
  name       String
  time       DateTime
}

model DroppingPoint {
  id         String   @id @default(uuid())
  scheduleId String
  schedule   Schedule @relation(fields: [scheduleId], references: [id])
  name       String
  time       DateTime
}
```

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name add_catalog_schema` (from `backend/`)
Expected: migration applied successfully.

- [ ] **Step 3: Write the seed script**

```typescript
// backend/prisma/seed.ts
import { PrismaClient, BusType, Deck, SeatType } from '@prisma/client';

const prisma = new PrismaClient();

function buildSeats(busId: string, totalRows: number, seatType: SeatType) {
  const seats = [];
  for (let row = 1; row <= totalRows; row++) {
    for (const column of [1, 2, 3, 4]) {
      seats.push({
        busId,
        seatNumber: `${row}${String.fromCharCode(64 + column)}`,
        deck: Deck.LOWER,
        seatType,
        row,
        column,
      });
    }
  }
  return seats;
}

async function main() {
  const operatorA = await prisma.operator.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: { id: '00000000-0000-0000-0000-000000000001', name: 'Green Line Travels' },
  });
  const operatorB = await prisma.operator.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: { id: '00000000-0000-0000-0000-000000000002', name: 'Royal Express' },
  });

  const busSpecs = [
    { id: '00000000-0000-0000-0001-000000000001', operatorId: operatorA.id, name: 'GL Volvo 1', busType: BusType.AC_SEATER, rows: 10 },
    { id: '00000000-0000-0000-0001-000000000002', operatorId: operatorA.id, name: 'GL Sleeper 1', busType: BusType.AC_SLEEPER, rows: 9 },
    { id: '00000000-0000-0000-0001-000000000003', operatorId: operatorB.id, name: 'RE Non-AC 1', busType: BusType.NON_AC_SEATER, rows: 10 },
    { id: '00000000-0000-0000-0001-000000000004', operatorId: operatorB.id, name: 'RE Sleeper 1', busType: BusType.NON_AC_SLEEPER, rows: 8 },
    { id: '00000000-0000-0000-0001-000000000005', operatorId: operatorA.id, name: 'GL Volvo 2', busType: BusType.AC_SEATER, rows: 10 },
  ];

  const buses = [];
  for (const spec of busSpecs) {
    const seatType = spec.busType.includes('SLEEPER') ? SeatType.SLEEPER : SeatType.SEATER;
    const bus = await prisma.bus.upsert({
      where: { id: spec.id },
      update: {},
      create: {
        id: spec.id,
        operatorId: spec.operatorId,
        name: spec.name,
        busType: spec.busType,
        totalSeats: spec.rows * 4,
      },
    });
    await prisma.seat.deleteMany({ where: { busId: bus.id } });
    await prisma.seat.createMany({ data: buildSeats(bus.id, spec.rows, seatType) });
    buses.push(bus);
  }

  const routeSpecs = [
    { id: '00000000-0000-0000-0002-000000000001', source: 'Mumbai', destination: 'Pune' },
    { id: '00000000-0000-0000-0002-000000000002', source: 'Bangalore', destination: 'Chennai' },
    { id: '00000000-0000-0000-0002-000000000003', source: 'Delhi', destination: 'Jaipur' },
    { id: '00000000-0000-0000-0002-000000000004', source: 'Hyderabad', destination: 'Bangalore' },
  ];
  const routes = [];
  for (const spec of routeSpecs) {
    routes.push(
      await prisma.route.upsert({ where: { id: spec.id }, update: {}, create: spec }),
    );
  }

  await prisma.boardingPoint.deleteMany({});
  await prisma.droppingPoint.deleteMany({});
  await prisma.schedule.deleteMany({});

  for (let day = 0; day < 14; day++) {
    for (let i = 0; i < buses.length; i++) {
      const bus = buses[i];
      const route = routes[i % routes.length];
      const departureTime = new Date();
      departureTime.setDate(departureTime.getDate() + day);
      departureTime.setHours(6 + i * 2, 0, 0, 0);
      const arrivalTime = new Date(departureTime.getTime() + 5 * 60 * 60 * 1000);

      const schedule = await prisma.schedule.create({
        data: {
          busId: bus.id,
          routeId: route.id,
          departureTime,
          arrivalTime,
          fare: 500 + i * 100,
          serviceCharge: 25,
        },
      });

      await prisma.boardingPoint.createMany({
        data: [
          { scheduleId: schedule.id, name: `${route.source} Central Station`, time: departureTime },
          { scheduleId: schedule.id, name: `${route.source} Bypass`, time: new Date(departureTime.getTime() + 15 * 60000) },
        ],
      });
      await prisma.droppingPoint.createMany({
        data: [
          { scheduleId: schedule.id, name: `${route.destination} Main Stand`, time: arrivalTime },
        ],
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Wire the seed command into `package.json`**

```json
// backend/package.json — add top-level key
"prisma": {
  "seed": "ts-node prisma/seed.ts"
}
```

Run: `npm install -D ts-node` if not already present.

- [ ] **Step 5: Write the failing e2e test verifying the seed produces queryable data**

```typescript
// backend/test/seed.e2e-spec.ts
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Prisma seed', () => {
  beforeAll(() => {
    execSync('npx prisma db seed', { cwd: process.cwd(), stdio: 'inherit' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates operators, buses with seats, routes, and schedules', async () => {
    const operatorCount = await prisma.operator.count();
    const busCount = await prisma.bus.count();
    const seatCount = await prisma.seat.count();
    const routeCount = await prisma.route.count();
    const scheduleCount = await prisma.schedule.count();

    expect(operatorCount).toBeGreaterThanOrEqual(2);
    expect(busCount).toBeGreaterThanOrEqual(5);
    expect(seatCount).toBeGreaterThan(0);
    expect(routeCount).toBeGreaterThanOrEqual(4);
    expect(scheduleCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npm run test:e2e -- seed.e2e-spec.ts` (with `docker compose up -d postgres` running)
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/prisma backend/package.json backend/package-lock.json backend/test
git commit -m "feat(backend): add catalog schema (operators, buses, routes, schedules) and seed script"
```

---

### Task 12: Backend Dockerfile + compose service

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`
- Create: `backend/docker-entrypoint.sh`
- Modify: `docker-compose.yml` (add `backend` service)

**Interfaces:**
- Consumes: `docker-compose.yml`'s `postgres` service (Task 2), Prisma migrate/seed commands (Tasks 3, 11).
- Produces: a `backend` container reachable at `http://localhost:3000` (host) / `http://backend:3000` (in-network) for Task 20's frontend proxy.

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
dist
.env
*.log
```

- [ ] **Step 2: Write the multi-stage `Dockerfile`**

```dockerfile
# backend/Dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
```

Runtime copies `node_modules` from the `build` stage, not `deps` — `npx prisma generate` (which writes the generated client into `node_modules/@prisma/client` and `node_modules/.prisma`) only ran in `build`. Copying from `deps` here would ship a runtime image with an ungenerated Prisma client.

- [ ] **Step 3: Write the entrypoint script**

```bash
#!/bin/sh
# backend/docker-entrypoint.sh
set -e

npx prisma migrate deploy
npx prisma db seed

exec "$@"
```

- [ ] **Step 4: Add the `backend` service to `docker-compose.yml`**

```yaml
# docker-compose.yml — add under services:
  backend:
    build:
      context: ./backend
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET}
      JWT_ACCESS_EXPIRES_IN: ${JWT_ACCESS_EXPIRES_IN}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      JWT_REFRESH_EXPIRES_IN: ${JWT_REFRESH_EXPIRES_IN}
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      SMTP_FROM: ${SMTP_FROM}
      FRONTEND_URL: ${FRONTEND_URL}
      PORT: 3000
    ports:
      - '3000:3000'
    depends_on:
      postgres:
        condition: service_healthy
```

Note: `DATABASE_URL` here points at the `postgres` service name (Docker network DNS), not `localhost` — this only applies inside the compose network.

- [ ] **Step 5: Build and start the backend service**

Run: `docker compose up -d --build backend`

- [ ] **Step 6: Verify migrations/seed ran and the API responds**

Run: `curl -sf http://localhost:3000/health`
Expected: `{"status":"ok"}`

Run: `docker compose logs backend | grep -i "seed"`
Expected: no errors; seed script output visible.

- [ ] **Step 7: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore backend/docker-entrypoint.sh docker-compose.yml
git commit -m "chore(backend): dockerize backend with automatic migrate+seed on startup"
```

---

### Task 13: Frontend project scaffold

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`
- Create: `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/.env.example` addition (documented, actual value lives in root `.env.example` per Task 2 — this task just consumes `VITE_API_URL`)
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: `apiClient` (axios instance) used by every subsequent frontend API module.

- [ ] **Step 1: Scaffold the Vite project**

Run from repo root: `npm create vite@latest frontend -- --template react-ts`, then `cd frontend && npm install`.

- [ ] **Step 2: Install routing, forms, testing, and http dependencies**

Run inside `frontend/`:
```bash
npm install react-router-dom react-hook-form zod @hookform/resolvers axios
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 3: Configure Vitest in `vite.config.ts`**

```typescript
// frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
});
```

```typescript
// frontend/src/test-setup.ts
import '@testing-library/jest-dom';
```

Add to `frontend/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 4: Write the API client**

```typescript
// frontend/src/api/client.ts
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});
```

- [ ] **Step 5: Write a minimal `App.tsx`**

```typescript
// frontend/src/App.tsx
function App() {
  return <div>Bus Ticket Management</div>;
}

export default App;
```

- [ ] **Step 6: Write the failing render test**

```typescript
// frontend/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the app shell', () => {
    render(<App />);
    expect(screen.getByText('Bus Ticket Management')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `npm run test` (from `frontend/`)
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): scaffold Vite React TS app with axios client and Vitest"
```

---

### Task 14: AuthContext + auth API functions

**Files:**
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/context/AuthContext.tsx`
- Test: `frontend/src/context/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `apiClient` (Task 13).
- Produces: `AuthProvider`, `useAuth()` (Task 14) — consumed by every page component in Tasks 15–18.

- [ ] **Step 1: Write the auth API functions**

```typescript
// frontend/src/api/auth.ts
import { apiClient } from './client';

export interface RegisterPayload {
  name: string;
  phone: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export async function registerRequest(payload: RegisterPayload) {
  const { data } = await apiClient.post<{ accessToken: string }>('/auth/register', payload);
  return data;
}

export async function loginRequest(payload: LoginPayload) {
  const { data } = await apiClient.post<{ accessToken: string }>('/auth/login', payload);
  return data;
}

export async function logoutRequest() {
  await apiClient.post('/auth/logout');
}

export async function forgotPasswordRequest(email: string) {
  const { data } = await apiClient.post<{ message: string }>('/auth/forgot-password', { email });
  return data;
}

export async function resetPasswordRequest(token: string, newPassword: string) {
  const { data } = await apiClient.post<{ message: string }>('/auth/reset-password', {
    token,
    newPassword,
  });
  return data;
}

export async function refreshRequest() {
  const { data } = await apiClient.post<{ accessToken: string }>('/auth/refresh');
  return data;
}
```

- [ ] **Step 2: Write the failing `AuthContext` test**

```typescript
// frontend/src/context/AuthContext.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import * as authApi from '../api/auth';

vi.mock('../api/auth');

function TestComponent() {
  const { user, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="user">{user ? user.email : 'anonymous'}</span>
      <button onClick={() => login('a@example.com', 'password123')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  it('sets user state on login and clears it on logout', async () => {
    vi.mocked(authApi.loginRequest).mockResolvedValue({ accessToken: 'token' });
    vi.mocked(authApi.logoutRequest).mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    expect(screen.getByTestId('user').textContent).toBe('anonymous');

    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('a@example.com'));

    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('anonymous'));
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

Run: `npm run test -- AuthContext.test.tsx`
Expected: FAIL — module `./AuthContext` not found

- [ ] **Step 4: Implement `AuthContext`**

```typescript
// frontend/src/context/AuthContext.tsx
import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { jwtDecode } from 'jwt-decode';
import {
  loginRequest,
  registerRequest,
  logoutRequest,
  RegisterPayload,
} from '../api/auth';

interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function decodeUser(accessToken: string): AuthUser {
  const payload = jwtDecode<{ sub: string; email: string; role: string }>(accessToken);
  return { userId: payload.sub, email: payload.email, role: payload.role };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const { accessToken } = await loginRequest({ email, password });
      setUser(decodeUser(accessToken));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    setIsLoading(true);
    try {
      const { accessToken } = await registerRequest(payload);
      setUser(decodeUser(accessToken));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
```

- [ ] **Step 5: Install `jwt-decode`**

Run inside `frontend/`: `npm install jwt-decode`

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npm run test -- AuthContext.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/auth.ts frontend/src/context frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): add auth API functions and AuthContext"
```

---

### Task 15: Axios interceptor for silent refresh

**Files:**
- Modify: `frontend/src/api/client.ts` (add response interceptor)
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Consumes: `refreshRequest` (Task 14).
- Produces: automatic 401 → refresh → retry behavior used transparently by every API call.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/api/client.test.ts
import { vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { apiClient } from './client';

describe('apiClient interceptor', () => {
  it('retries the original request after a successful silent refresh on 401', async () => {
    const mock = new MockAdapter(apiClient);
    mock
      .onGet('/protected-ping')
      .replyOnce(401)
      .onPost('/auth/refresh')
      .replyOnce(201, { accessToken: 'new-token' })
      .onGet('/protected-ping')
      .replyOnce(200, { message: 'pong' });

    const res = await apiClient.get('/protected-ping');
    expect(res.data.message).toBe('pong');
    mock.restore();
  });
});
```

- [ ] **Step 2: Install the mock adapter dev dependency**

Run inside `frontend/`: `npm install -D axios-mock-adapter`

- [ ] **Step 3: Run to confirm it fails**

Run: `npm run test -- client.test.ts`
Expected: FAIL — original request never retried, promise rejects with 401.

- [ ] **Step 4: Add the response interceptor**

```typescript
// frontend/src/api/client.ts — replace file contents
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

let isRefreshing = false;
let pendingRequests: Array<() => void> = [];

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    if (response?.status !== 401 || config._retry || config.url === '/auth/refresh') {
      return Promise.reject(error);
    }
    config._retry = true;

    if (isRefreshing) {
      await new Promise<void>((resolve) => pendingRequests.push(resolve));
      return apiClient(config);
    }

    isRefreshing = true;
    try {
      await apiClient.post('/auth/refresh');
      pendingRequests.forEach((resolve) => resolve());
      pendingRequests = [];
      return apiClient(config);
    } catch (refreshError) {
      pendingRequests = [];
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npm run test -- client.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): add silent-refresh-on-401 interceptor to api client"
```

---

### Task 16: Register and Login pages

**Files:**
- Create: `frontend/src/pages/Register.tsx`
- Create: `frontend/src/pages/Login.tsx`
- Test: `frontend/src/pages/Register.test.tsx`
- Test: `frontend/src/pages/Login.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 14).
- Produces: `Register`, `Login` components consumed by the router in Task 18.

- [ ] **Step 1: Write the failing `Register` test**

```typescript
// frontend/src/pages/Register.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { AuthProvider } from '../context/AuthContext';
import Register from './Register';
import * as authApi from '../api/auth';

vi.mock('../api/auth');

function renderRegister() {
  return render(
    <AuthProvider>
      <Register />
    </AuthProvider>,
  );
}

describe('Register page', () => {
  it('shows a validation error when password is too short', async () => {
    renderRegister();
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /register/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it('submits valid data and calls register', async () => {
    vi.mocked(authApi.registerRequest).mockResolvedValue({ accessToken: 'token' });
    renderRegister();

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => expect(authApi.registerRequest).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm run test -- Register.test.tsx`
Expected: FAIL — `./Register` module not found

- [ ] **Step 3: Implement `Register.tsx`**

```typescript
// frontend/src/pages/Register.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext';

const schema = z.object({
  name: z.string().min(2, 'name must be at least 2 characters'),
  phone: z.string().regex(/^\+?[0-9]{7,15}$/, 'enter a valid phone number'),
  email: z.string().email('enter a valid email'),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

type FormValues = z.infer<typeof schema>;

export default function Register() {
  const { register: doRegister } = useAuth();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    await doRegister(values);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label htmlFor="name">Name</label>
      <input id="name" {...register('name')} />
      {errors.name && <p>{errors.name.message}</p>}

      <label htmlFor="phone">Phone</label>
      <input id="phone" {...register('phone')} />
      {errors.phone && <p>{errors.phone.message}</p>}

      <label htmlFor="email">Email</label>
      <input id="email" {...register('email')} />
      {errors.email && <p>{errors.email.message}</p>}

      <label htmlFor="password">Password</label>
      <input id="password" type="password" {...register('password')} />
      {errors.password && <p>{errors.password.message}</p>}

      <button type="submit">Register</button>
    </form>
  );
}
```

- [ ] **Step 4: Run the `Register` test and confirm it passes**

Run: `npm run test -- Register.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing `Login` test**

```typescript
// frontend/src/pages/Login.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { AuthProvider } from '../context/AuthContext';
import Login from './Login';
import * as authApi from '../api/auth';

vi.mock('../api/auth');

describe('Login page', () => {
  it('submits credentials and calls login', async () => {
    vi.mocked(authApi.loginRequest).mockResolvedValue({ accessToken: 'token' });
    render(
      <AuthProvider>
        <Login />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(authApi.loginRequest).toHaveBeenCalledWith({
      email: 'jane@example.com',
      password: 'password123',
    }));
  });
});
```

- [ ] **Step 6: Run to confirm it fails**

Run: `npm run test -- Login.test.tsx`
Expected: FAIL — `./Login` module not found

- [ ] **Step 7: Implement `Login.tsx`**

```typescript
// frontend/src/pages/Login.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext';

const schema = z.object({
  email: z.string().email('enter a valid email'),
  password: z.string().min(1, 'password is required'),
});

type FormValues = z.infer<typeof schema>;

export default function Login() {
  const { login } = useAuth();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    await login(values.email, values.password);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label htmlFor="email">Email</label>
      <input id="email" {...register('email')} />
      {errors.email && <p>{errors.email.message}</p>}

      <label htmlFor="password">Password</label>
      <input id="password" type="password" {...register('password')} />
      {errors.password && <p>{errors.password.message}</p>}

      <button type="submit">Log In</button>
    </form>
  );
}
```

- [ ] **Step 8: Run both tests and confirm they pass**

Run: `npm run test -- Register.test.tsx Login.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Register.tsx frontend/src/pages/Login.tsx frontend/src/pages/Register.test.tsx frontend/src/pages/Login.test.tsx
git commit -m "feat(frontend): add Register and Login pages with validated forms"
```

---

### Task 17: Forgot/Reset password pages

**Files:**
- Create: `frontend/src/pages/ForgotPassword.tsx`
- Create: `frontend/src/pages/ResetPassword.tsx`
- Test: `frontend/src/pages/ForgotPassword.test.tsx`
- Test: `frontend/src/pages/ResetPassword.test.tsx`

**Interfaces:**
- Consumes: `forgotPasswordRequest`, `resetPasswordRequest` (Task 14).
- Produces: `ForgotPassword`, `ResetPassword` components consumed by the router in Task 18.

- [ ] **Step 1: Write the failing `ForgotPassword` test**

```typescript
// frontend/src/pages/ForgotPassword.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ForgotPassword from './ForgotPassword';
import * as authApi from '../api/auth';

vi.mock('../api/auth');

describe('ForgotPassword page', () => {
  it('submits the email and shows the confirmation message', async () => {
    vi.mocked(authApi.forgotPasswordRequest).mockResolvedValue({
      message: 'If that email is registered, a reset link has been sent.',
    });
    render(<ForgotPassword />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/reset link has been sent/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm run test -- ForgotPassword.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `ForgotPassword.tsx`**

```typescript
// frontend/src/pages/ForgotPassword.tsx
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { forgotPasswordRequest } from '../api/auth';

const schema = z.object({ email: z.string().email('enter a valid email') });
type FormValues = z.infer<typeof schema>;

export default function ForgotPassword() {
  const [message, setMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    const res = await forgotPasswordRequest(values.email);
    setMessage(res.message);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label htmlFor="email">Email</label>
      <input id="email" {...register('email')} />
      {errors.email && <p>{errors.email.message}</p>}
      <button type="submit">Send reset link</button>
      {message && <p>{message}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm run test -- ForgotPassword.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing `ResetPassword` test**

```typescript
// frontend/src/pages/ResetPassword.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResetPassword from './ResetPassword';
import * as authApi from '../api/auth';

vi.mock('../api/auth');

describe('ResetPassword page', () => {
  it('reads the token from the query string and submits a new password', async () => {
    vi.mocked(authApi.resetPasswordRequest).mockResolvedValue({
      message: 'Password has been reset successfully.',
    });

    render(
      <MemoryRouter initialEntries={['/reset-password?token=abc123']}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() =>
      expect(authApi.resetPasswordRequest).toHaveBeenCalledWith('abc123', 'newpassword123'),
    );
    expect(await screen.findByText(/reset successfully/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to confirm it fails**

Run: `npm run test -- ResetPassword.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 7: Implement `ResetPassword.tsx`**

```typescript
// frontend/src/pages/ResetPassword.tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { resetPasswordRequest } from '../api/auth';

const schema = z.object({
  newPassword: z.string().min(8, 'password must be at least 8 characters'),
});
type FormValues = z.infer<typeof schema>;

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [message, setMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    const res = await resetPasswordRequest(token, values.newPassword);
    setMessage(res.message);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label htmlFor="newPassword">New password</label>
      <input id="newPassword" type="password" {...register('newPassword')} />
      {errors.newPassword && <p>{errors.newPassword.message}</p>}
      <button type="submit">Reset password</button>
      {message && <p>{message}</p>}
    </form>
  );
}
```

- [ ] **Step 8: Run both tests and confirm they pass**

Run: `npm run test -- ForgotPassword.test.tsx ResetPassword.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/ForgotPassword.tsx frontend/src/pages/ResetPassword.tsx frontend/src/pages/ForgotPassword.test.tsx frontend/src/pages/ResetPassword.test.tsx
git commit -m "feat(frontend): add forgot-password and reset-password pages"
```

---

### Task 18: ProtectedRoute, Home stub, and routing wiring

**Files:**
- Create: `frontend/src/components/ProtectedRoute.tsx`
- Create: `frontend/src/pages/Home.tsx`
- Modify: `frontend/src/App.tsx` (wire up `AuthProvider`, `BrowserRouter`, all routes)
- Test: `frontend/src/components/ProtectedRoute.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 14), `Register`/`Login`/`ForgotPassword`/`ResetPassword` (Tasks 16–17).
- Produces: the fully wired frontend app — final deliverable of the frontend side of this sub-project.

- [ ] **Step 1: Write the failing `ProtectedRoute` test**

```typescript
// frontend/src/components/ProtectedRoute.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import ProtectedRoute from './ProtectedRoute';

function renderWithAuth(user: { userId: string; email: string; role: string } | null) {
  return render(
    <AuthContext.Provider
      value={{ user, isLoading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }}
    >
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route
            path="/home"
            element={
              <ProtectedRoute>
                <div>home page</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('ProtectedRoute', () => {
  it('redirects to /login when there is no user', () => {
    renderWithAuth(null);
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('renders children when a user is present', () => {
    renderWithAuth({ userId: '1', email: 'a@example.com', role: 'CUSTOMER' });
    expect(screen.getByText('home page')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Export `AuthContext` itself from `AuthContext.tsx`**

```typescript
// frontend/src/context/AuthContext.tsx — change this line:
const AuthContext = createContext<AuthContextValue | undefined>(undefined);
// to:
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
```

- [ ] **Step 3: Run to confirm the new test fails**

Run: `npm run test -- ProtectedRoute.test.tsx`
Expected: FAIL — `./ProtectedRoute` module not found

- [ ] **Step 4: Implement `ProtectedRoute.tsx`**

```typescript
// frontend/src/components/ProtectedRoute.tsx
import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npm run test -- ProtectedRoute.test.tsx`
Expected: PASS

- [ ] **Step 6: Write the `Home` stub page**

```typescript
// frontend/src/pages/Home.tsx
import { useAuth } from '../context/AuthContext';

export default function Home() {
  const { user, logout } = useAuth();
  return (
    <div>
      <p>Welcome, {user?.email}</p>
      <button onClick={() => logout()}>Log out</button>
      <p>Bus search coming soon.</p>
    </div>
  );
}
```

- [ ] **Step 7: Wire everything together in `App.tsx`**

```typescript
// frontend/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Register from './pages/Register';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Home from './pages/Home';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/home"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
```

- [ ] **Step 8: Update `App.test.tsx` for the new shell (it now needs a router context)**

```typescript
// frontend/src/App.test.tsx — replace contents
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('redirects an unauthenticated user to the login page', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run the full frontend test suite and confirm everything passes**

Run: `npm run test` (from `frontend/`)
Expected: PASS — all suites from Tasks 13–18.

- [ ] **Step 10: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): wire up routing, ProtectedRoute, and Home stub"
```

---

### Task 19: Frontend Dockerfile + Nginx proxy + full-stack smoke test

**Files:**
- Create: `frontend/Dockerfile`
- Create: `frontend/.dockerignore`
- Create: `frontend/nginx.conf`
- Modify: `docker-compose.yml` (add `frontend` service)
- Create: `README.md` (root quickstart)

**Interfaces:**
- Consumes: `backend` service (Task 12).
- Produces: the complete `docker compose up --build` stack — final deliverable of this sub-project.

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
dist
.env
*.log
```

- [ ] **Step 2: Write the Nginx config proxying `/api` to the backend**

```nginx
# frontend/nginx.conf
server {
  listen 80;

  location /api/ {
    proxy_pass http://backend:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location / {
    root /usr/share/nginx/html;
    try_files $uri /index.html;
  }
}
```

- [ ] **Step 3: Write the multi-stage `Dockerfile`**

```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

Note: in the dockerized stack the frontend calls its own origin's `/api` (proxied by Nginx), not the backend's host port directly — so `VITE_API_URL=/api` is baked in at build time for this image, distinct from the `http://localhost:3000` used in local (non-Docker) dev.

- [ ] **Step 4: Add the `frontend` service to `docker-compose.yml`**

```yaml
# docker-compose.yml — add under services:
  frontend:
    build:
      context: ./frontend
      args:
        VITE_API_URL: /api
    restart: unless-stopped
    ports:
      - '8080:80'
    depends_on:
      - backend
```

- [ ] **Step 5: Bring up the full stack**

Run: `docker compose up -d --build`

- [ ] **Step 6: Verify the frontend serves and proxies correctly**

Run: `curl -sf http://localhost:8080/ | grep -o '<title>[^<]*</title>'`
Expected: the built `index.html`'s title tag.

Run: `curl -sf http://localhost:8080/api/health`
Expected: `{"status":"ok"}` (proxied through Nginx to the backend container).

- [ ] **Step 7: Run a full register→login→forgot→reset smoke test against the running stack**

Run:
```bash
EMAIL="smoke-$(date +%s)@example.com"
curl -sf -c /tmp/cookies.txt -X POST http://localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Test\",\"phone\":\"9876543210\",\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -sf -b /tmp/cookies.txt -c /tmp/cookies.txt -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -sf -X POST http://localhost:8080/api/auth/forgot-password \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\"}"
```
Expected: each call returns a 2xx JSON response (register/login return `accessToken`, forgot-password returns the generic message).

- [ ] **Step 8: Write the root README quickstart**

```markdown
# Bus Ticket Management

## Quickstart

1. `cp .env.example .env` and fill in real secrets (JWT secrets, SMTP creds).
2. `docker compose up --build`
3. Frontend: http://localhost:8080
4. Backend API docs: http://localhost:3000/api/docs
5. Backend health check: http://localhost:3000/health

## Local development (without Docker)

- Backend: `cd backend && npm install && docker compose up -d postgres && npx prisma migrate dev && npm run start:dev`
- Frontend: `cd frontend && npm install && npm run dev` (expects `VITE_API_URL=http://localhost:3000` in `frontend/.env`)
```

- [ ] **Step 9: Commit**

```bash
git add frontend/Dockerfile frontend/.dockerignore frontend/nginx.conf docker-compose.yml README.md
git commit -m "chore(frontend): dockerize frontend with nginx proxy; add root quickstart README"
```

---

## Self-Review Notes

- **Spec coverage:** Register/login/logout/forgot/reset (Tasks 4–9), customer-only + JWT guard (Task 6), rate limiting (Task 10), secure password storage via bcrypt (Task 4), catalog schema + seed for later search (Task 11), Docker for backend/frontend/DB (Tasks 2, 12, 19) — all spec sections have a corresponding task.
- **Type consistency checked:** `AuthService` method names/signatures (`register`, `login`, `refresh`, `logout`, `forgotPassword`, `resetPassword`) match between the design spec, unit tests, and controller across Tasks 4–9. Frontend `api/auth.ts` function names match what `AuthContext.tsx` and page components call.
- **No placeholders:** every step has concrete code; no TBD/TODO markers.
