@echo off
setlocal
title RestBlu Dahua Hub
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
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 9500 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo El hub Dahua ya esta funcionando en otra ventana ^(puerto 9500 ocupado^).
  echo No hace falta abrirlo de nuevo.
  pause
  exit /b 0
)

echo Servicio central Dahua de RestBlu
echo   Auto Register (TCP): puerto 9500
echo   API: http://127.0.0.1:3200/api/devices/online
echo.
echo Para exponerlo a Internet abre otra ventana y ejecuta:  ngrok tcp 9500
echo Ctrl+C para detener.
echo.
node src\main.mjs
pause
