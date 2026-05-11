@echo off
echo Starting SpriteForge Backend...
start cmd /k "cd backend && python main.py"

echo Starting SpriteForge Frontend...
start cmd /k "cd frontend && npm run dev"

echo.
echo ========================================
echo SpriteForge is starting!
echo Backend: http://localhost:8000
echo Frontend: http://localhost:5173
echo ========================================
pause
