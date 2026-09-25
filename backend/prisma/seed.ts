import { PrismaClient, BusType, Deck, SeatType, SeatStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const OPERATORS = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Shyamoli Paribahan' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Hanif Enterprise' },
];

const BUSES = [
  { id: '00000000-0000-0000-0001-000000000001', operatorIdx: 0, name: 'Shyamoli Volvo 1', busType: BusType.AC_SEATER, rows: 10, totalSeats: 40 },
  { id: '00000000-0000-0000-0001-000000000002', operatorIdx: 0, name: 'Shyamoli Sleeper 1', busType: BusType.AC_SLEEPER, rows: 9, totalSeats: 36 },
  { id: '00000000-0000-0000-0001-000000000003', operatorIdx: 1, name: 'Hanif Non-AC 1', busType: BusType.NON_AC_SEATER, rows: 10, totalSeats: 40 },
  { id: '00000000-0000-0000-0001-000000000004', operatorIdx: 1, name: 'Hanif Sleeper 1', busType: BusType.NON_AC_SLEEPER, rows: 8, totalSeats: 32 },
  { id: '00000000-0000-0000-0001-000000000005', operatorIdx: 0, name: 'Shyamoli Volvo 2', busType: BusType.AC_SEATER, rows: 10, totalSeats: 40 },
];

const ROUTES = [
  { id: '00000000-0000-0000-0002-000000000001', source: 'Sylhet', destination: 'Dhaka', distanceKm: 247 },
  { id: '00000000-0000-0000-0002-000000000002', source: 'Dhaka', destination: 'Chattogram', distanceKm: 264 },
  { id: '00000000-0000-0000-0002-000000000003', source: 'Dhaka', destination: 'Cox\'s Bazar', distanceKm: 414 },
  { id: '00000000-0000-0000-0002-000000000004', source: 'Dhaka', destination: 'Rajshahi', distanceKm: 256 },
];

const BOARDING_POINTS: Record<string, string[]> = {
  Sylhet: ['Sylhet Kadamtoli Bus Terminal', 'Sylhet Amberkhana'],
  Dhaka: ['Dhaka Gabtoli', 'Dhaka Sayedabad'],
};

const DROPPING_POINTS: Record<string, string[]> = {
  Dhaka: ['Dhaka Sayedabad Bus Terminal'],
  Chattogram: ['Chattogram GEC Circle'],
  "Cox's Bazar": ["Cox's Bazar Bus Terminal"],
  Rajshahi: ['Rajshahi Shiroil Bus Terminal'],
};

const COLUMNS = ['A', 'B', 'C', 'D'];

function generateSeats(busId: string, rows: number, isSleeper: boolean) {
  const seats: { busId: string; seatNumber: string; deck: Deck; seatType: SeatType; row: number; column: number }[] = [];
  for (let row = 1; row <= rows; row++) {
    for (let col = 1; col <= 4; col++) {
      seats.push({
        busId,
        seatNumber: `${row}${COLUMNS[col - 1]}`,
        deck: Deck.LOWER,
        seatType: isSleeper ? SeatType.SLEEPER : SeatType.SEATER,
        row,
        column: col,
      });
    }
  }
  return seats;
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('  Skipped admin seed: ADMIN_EMAIL/ADMIN_PASSWORD not set');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {},
    create: {
      name: 'Admin',
      phone: '0000000000',
      email: email.toLowerCase(),
      passwordHash,
      role: Role.ADMIN,
    },
  });
  console.log(`  Upserted admin user (${email})`);
}

async function main() {
  console.log('Seeding...');

  await seedAdmin();

  // Upsert operators
  for (const op of OPERATORS) {
    await prisma.operator.upsert({
      where: { id: op.id },
      update: { name: op.name },
      create: op,
    });
  }
  console.log(`  Upserted ${OPERATORS.length} operators`);

  // Clear schedule seats first (foreign key dependency)
  await prisma.scheduleSeat.deleteMany();
  console.log('  Cleared schedule seats');

  // Upsert buses and regenerate seats
  for (const bus of BUSES) {
    await prisma.bus.upsert({
      where: { id: bus.id },
      update: { name: bus.name, busType: bus.busType, totalSeats: bus.totalSeats },
      create: {
        id: bus.id,
        operatorId: OPERATORS[bus.operatorIdx].id,
        name: bus.name,
        busType: bus.busType,
        totalSeats: bus.totalSeats,
      },
    });
    await prisma.seat.deleteMany({ where: { busId: bus.id } });
    const seats = generateSeats(bus.id, bus.rows, bus.busType.includes('SLEEPER'));
    await prisma.seat.createMany({ data: seats });
  }
  console.log(`  Upserted ${BUSES.length} buses with seats`);

  // Upsert routes
  for (const route of ROUTES) {
    await prisma.route.upsert({
      where: { id: route.id },
      update: { source: route.source, destination: route.destination, distanceKm: route.distanceKm },
      create: route,
    });
  }
  console.log(`  Upserted ${ROUTES.length} routes`);

  // Bookings reference schedules/boarding/dropping points, which are about to be
  // wiped and regenerated with new ids - any existing bookings are stale.
  await prisma.booking.deleteMany();
  console.log('  Cleared bookings');

  // Delete and recreate schedules + boarding/dropping points
  await prisma.boardingPoint.deleteMany();
  await prisma.droppingPoint.deleteMany();
  await prisma.schedule.deleteMany();
  console.log('  Cleared old schedules');

  const now = new Date();
  let scheduleCount = 0;

  for (let day = 0; day < 14; day++) {
    for (let i = 0; i < BUSES.length; i++) {
      const bus = BUSES[i];
      const route = ROUTES[i % ROUTES.length];

      const departure = new Date(now);
      departure.setDate(departure.getDate() + day);
      departure.setHours(6 + i * 2, 0, 0, 0);

      const arrival = new Date(departure);
      arrival.setHours(arrival.getHours() + 5);

      const fare = 500 + i * 100;

      // Get all seats for this bus
      const busSeats = await prisma.seat.findMany({
        where: { busId: bus.id },
      });

      const boardingNames = BOARDING_POINTS[route.source] ?? [`${route.source} Bus Terminal`];
      const droppingNames = DROPPING_POINTS[route.destination] ?? [`${route.destination} Bus Terminal`];

      await prisma.schedule.create({
        data: {
          busId: bus.id,
          routeId: route.id,
          departureTime: departure,
          arrivalTime: arrival,
          fare,
          serviceCharge: 25,
          boardingPoints: {
            create: boardingNames.map((name, idx) => ({
              name,
              time: new Date(departure.getTime() + idx * 15 * 60 * 1000),
            })),
          },
          droppingPoints: {
            create: droppingNames.map((name) => ({
              name,
              time: arrival,
            })),
          },
          scheduleSeats: {
            create: busSeats.map((seat) => ({
              seatId: seat.id,
              status: SeatStatus.AVAILABLE,
            })),
          },
        },
      });
      scheduleCount++;
    }
  }

  console.log(`  Created ${scheduleCount} schedules with seats and boarding/dropping points`);
  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
