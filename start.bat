@echo off
echo Starting SpriteForge Backend...
:: Open a new window for the backend
start "SpriteForge Backend" cmd /k "cd backend && venv\Scripts\python main.py"

echo Starting SpriteForge Frontend...
:: Run the frontend in the current window
npm run dev
