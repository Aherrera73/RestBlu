@echo off
setlocal EnableExtensions
title Configurar Dahua para reservas RestBlu
set "GESTOR_DIR=%~dp0backend"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo No se encontro Node.js 22 o superior.
  pause
  exit /b 1
)
pushd "%GESTOR_DIR%"
node.exe scripts\configure-dahua-reservas.mjs
set "RESULTADO=%errorlevel%"
popd
pause
exit /b %RESULTADO%
