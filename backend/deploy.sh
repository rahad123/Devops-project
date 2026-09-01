#!/bin/bash
set -e

echo "=== Bus Ticket Management - Deploy ==="

# Build the image
echo "Building Docker image..."
docker build -t bus-ticket-backend:latest .

# Stop existing containers
echo "Stopping existing containers..."
docker compose -f docker-compose.prod.yml down

# Start services
echo "Starting services..."
docker compose -f docker-compose.prod.yml up -d

# Wait for healthy
echo "Waiting for app to be healthy..."
sleep 10

# Check status
if curl -sf http://localhost:5000/health > /dev/null 2>&1; then
  echo "✅ App is running on http://localhost:5000"
  echo "📊 Health: $(curl -s http://localhost:5000/health)"
else
  echo "❌ App failed to start. Check logs with: docker compose -f docker-compose.prod.yml logs app"
  exit 1
fi
