-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('AVAILABLE', 'HELD', 'BOOKED');

-- CreateTable
CREATE TABLE "ScheduleSeat" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "status" "SeatStatus" NOT NULL DEFAULT 'AVAILABLE',
    "heldByUserId" TEXT,
    "heldAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "bookedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduleSeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSeat_scheduleId_seatId_key" ON "ScheduleSeat"("scheduleId", "seatId");

-- AddForeignKey
ALTER TABLE "ScheduleSeat" ADD CONSTRAINT "ScheduleSeat_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSeat" ADD CONSTRAINT "ScheduleSeat_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
