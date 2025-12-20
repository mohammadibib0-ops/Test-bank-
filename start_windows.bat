@echo off
setlocal
cd /d %~dp0

echo === TestBank: first-time setup ===
if not exist server\.env (
  copy server\.env.example server\.env >nul
  echo Created server\.env from .env.example
)

echo Installing server dependencies (npm install)...
cd server
call npm install
if errorlevel 1 (
  echo Failed npm install. Make sure Node.js is installed.
  pause
  exit /b 1
)

echo Starting server on http://localhost:8080 ...
call npm run start
start "" "http://localhost:8080"

