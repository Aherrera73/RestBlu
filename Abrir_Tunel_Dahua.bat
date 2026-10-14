@echo off
setlocal
title RestBlu - Tunel ngrok Dahua
cd /d "%~dp0dahua-hub"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instala Node 22 o superior.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Instalando dependencias del hub...
  call npm.cmd install --no-fund --no-audit
)

echo Tunel ngrok para el hub Dahua de RestBlu
echo ngrok se abre en su propia ventana: cerrarla corta la conexion de los Dahua.
echo.
node scripts\start-tunnel.mjs
echo.
pause
