#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "=== TestBank: first-time setup ==="
if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  echo "Created server/.env from .env.example"
fi

echo "Installing server dependencies (npm install)..."
cd server
npm install
echo "Starting server on http://localhost:8080 ..."
npm run start
