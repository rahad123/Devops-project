#!/bin/sh
set -e

echo "Waiting for postgres..."
until nc -z postgres 5432 2>/dev/null; do
  sleep 1
done
echo "Postgres is ready"

echo "Running migrations..."
npx prisma migrate deploy

echo "Seeding database..."
npx prisma db seed

echo "Starting app..."
exec node dist/main
