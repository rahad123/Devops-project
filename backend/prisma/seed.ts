import { PrismaClient, BusType, Deck, SeatType, SeatStatus } from '@prisma/client';

const prisma = new PrismaClient();

const OPERATORS = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Green Line Travels' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Royal Express' },
];

const BUSES = [
  { id: '00000000-0000-0000-0001-000000000001', operatorIdx: 0, name: 'GL Volvo 1', busType: BusType.AC_SEATER, rows: 10, totalSeats: 40 },
  { id: '00000000-0000-0000-0001-000000000002', operatorIdx: 0, name: 'GL Sleeper 1', busType: BusType.AC_SLEEPER, rows: 9, totalSeats: 36 },
  { id: '00000000-0000-0000-0001-000000000003', operatorIdx: 1, name: 'RE Non-AC 1', busType: BusType.NON_AC_SEATER, rows: 10, totalSeats: 40 },
  { id: '00000000-0000-0000-0001-000000000004', operatorIdx: 1, name: 'RE Sleeper 1', busType: BusType.NON_AC_SLEEPER, rows: 8, totalSeats: 32 },
  { id: '00000000-0000-0000-0001-000000000005', operatorIdx: 0, name: 'GL Volvo 2', busType: BusType.AC_SEATER, rows: 10, totalSeats: 40 },
];

const ROUTES = [
  { id: '00000000-0000-0000-0002-000000000001', source: 'Mumbai', destination: 'Pune', distanceKm: 150 },
  { id: '00000000-0000-0000-0002-000000000002', source: 'Bangalore', destination: 'Chennai', distanceKm: 350 },
  { id: '00000000-0000-0000-0002-000000000003', source: 'Delhi', destination: 'Jaipur', distanceKm: 280 },
  { id: '00000000-0000-0000-0002-000000000004', source: 'Hyderabad', destination: 'Bangalore', distanceKm: 570 },
];

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

async function main() {
  console.log('Seeding...');

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

      const schedule = await prisma.schedule.create({
        data: {
          busId: bus.id,
          routeId: route.id,
          departureTime: departure,
          arrivalTime: arrival,
          fare,
          serviceCharge: 25,
          boardingPoints: {
            create: [
              { name: `${route.source} Central Station`, time: departure },
              { name: `${route.source} Bypass`, time: new Date(departure.getTime() + 15 * 60 * 1000) },
            ],
          },
          droppingPoints: {
            create: [
              { name: `${route.destination} Main Stand`, time: arrival },
            ],
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
