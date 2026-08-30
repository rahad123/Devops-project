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
