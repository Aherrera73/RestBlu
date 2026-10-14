@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Gestor local RestBlu

set "GESTOR_DIR=%~dp0backend"
set "GESTOR_URL=http://127.0.0.1:3100"
if not defined RESTBLU_ENV_PATH (
  if defined LOCALAPPDATA (
    set "RESTBLU_ENV_PATH=%LOCALAPPDATA%\RestBlu\.env.local"
  ) else (
    set "RESTBLU_ENV_PATH=%USERPROFILE%\AppData\Local\RestBlu\.env.local"
  )
  if not exist "!RESTBLU_ENV_PATH!" if exist "%USERPROFILE%\AppData\Local\RestBlu\.env.local" (
    set "RESTBLU_ENV_PATH=%USERPROFILE%\AppData\Local\RestBlu\.env.local"
  )
)

if not exist "!GESTOR_DIR!\server.mjs" (
  echo No se encontro el gestor en:
  echo !GESTOR_DIR!
  pause
  exit /b 1
)

where node.exe >nul 2>&1
if errorlevel 1 if exist "!USERPROFILE!\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  set "PATH=!USERPROFILE!\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;!PATH!"
)
where node.exe >nul 2>&1
if errorlevel 1 (
  echo No se encontro Node.js. Instala Node.js 22 o superior.
  pause
  exit /b 1
)

if not exist "!GESTOR_DIR!\node_modules\firebase-admin\package.json" (
  where npm.cmd >nul 2>&1
  if not errorlevel 1 (
    set "GESTOR_PACKAGE_CMD=npm.cmd"
  ) else if exist "!USERPROFILE!\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" (
    set "PATH=!USERPROFILE!\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;!PATH!"
    set "GESTOR_PACKAGE_CMD=pnpm.cmd"
  )
  if not defined GESTOR_PACKAGE_CMD (
    echo No se encontro npm o pnpm para instalar las dependencias del gestor.
    pause
    exit /b 1
  )
  echo Primera ejecucion: instalando dependencias del gestor...
  pushd "!GESTOR_DIR!"
  call !GESTOR_PACKAGE_CMD! install
  if errorlevel 1 (
    popd
    echo No se pudieron instalar las dependencias del gestor.
    pause
    exit /b 1
  )
  popd
)

if /I "%~1"=="--check" (
  pushd "!GESTOR_DIR!"
  node.exe --check server.mjs
  if errorlevel 1 (
    popd
    exit /b 1
  )
  popd
  echo Gestor local RestBlu listo.
  node.exe --version
  exit /b 0
)

powershell -NoProfile -Command "try { $health=Invoke-RestMethod -TimeoutSec 2 '%GESTOR_URL%/api/health'; if($health.ok){ exit 0 }; exit 1 } catch { exit 1 }"
if errorlevel 1 (
  echo Se abrira una consola llamada Gestor local RestBlu.
  echo No cierres esa consola mientras quieras recibir reservas y enviar correos.
  powershell -NoProfile -Command "$client=New-Object System.Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1',3100); exit 1 } catch { exit 0 } finally { $client.Dispose() }"
  if errorlevel 1 (
    echo El puerto 3100 ya esta ocupado por otro programa.
    echo Cierra ese programa y vuelve a ejecutar este BAT.
    pause
    exit /b 1
  )
  start "Gestor local RestBlu" /D "!GESTOR_DIR!" cmd.exe /k node.exe server.mjs
)

echo Iniciando el gestor local...
powershell -NoProfile -Command "$ok=$false; 1..20 | ForEach-Object { try { $null=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%GESTOR_URL%/api/health'; $ok=$true; break } catch { Start-Sleep -Milliseconds 350 } }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
  echo No fue posible iniciar el gestor en el puerto 3100.
  pause
  exit /b 1
)

start "" "%GESTOR_URL%"
exit /b 0
