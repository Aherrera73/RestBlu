@echo off
setlocal EnableExtensions EnableDelayedExpansion
title RestBlu completo

set "BASE_DIR=%~dp0"
set "GESTOR_DIR=%BASE_DIR%backend"
set "WEB_DIR=%BASE_DIR%frontend"
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
set "PACKAGE_CMD="
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
where npm.cmd >nul 2>&1
if not errorlevel 1 set "PACKAGE_CMD=npm.cmd"
if not defined PACKAGE_CMD if exist "!USERPROFILE!\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" (
  set "PATH=!USERPROFILE!\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback;!PATH!"
  set "PACKAGE_CMD=pnpm.cmd"
)
if not defined PACKAGE_CMD (
  echo No se encontro npm.
  pause
  exit /b 1
)
if not exist "!GESTOR_DIR!\server.mjs" (
  echo No se encontro el gestor local.
  pause
  exit /b 1
)
if not exist "!WEB_DIR!\package.json" (
  echo No se encontro la plataforma RestBlu.
  pause
  exit /b 1
)
if not exist "!WEB_DIR!\node_modules\.bin\vinext.cmd" (
  echo Primera ejecucion: instalando dependencias de RestBlu...
  pushd "!WEB_DIR!"
  call !PACKAGE_CMD! install
  if errorlevel 1 (
    popd
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
  popd
)
if not exist "!GESTOR_DIR!\node_modules\firebase-admin\package.json" (
  echo Primera ejecucion: instalando dependencias del gestor local...
  pushd "!GESTOR_DIR!"
  call !PACKAGE_CMD! install
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
  echo RestBlu completo esta listo.
  node.exe --version
  exit /b 0
)

node.exe "!GESTOR_DIR!\scripts\check-setup.mjs" --config "!RESTBLU_ENV_PATH!" --smtp-connect --firebase-connect
if errorlevel 1 (
  echo.
  echo No se completaron las comprobaciones de correo y Firebase.
  echo Revisa el mensaje anterior y vuelve a intentarlo cuando este resuelto.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $health=Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:3100/api/health'; if($health.ok -and $health.emailConfigured -and $health.firebaseConfigured){ exit 0 }; Write-Host 'El gestor ya abierto necesita correo o Firebase. Reinicialo para aplicar la configuracion.'; exit 1 } catch { exit 1 }"
if errorlevel 1 (
  powershell -NoProfile -Command "$client=New-Object System.Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1',3100); exit 1 } catch { exit 0 } finally { $client.Dispose() }"
  if errorlevel 1 (
    echo.
    echo Hay un gestor anterior en el puerto 3100 que no pudo reiniciarse.
    echo Cierra su ventana, incluso si dice Administrador, y ejecuta otra vez este BAT.
    echo No se abrira la web mientras el gestor no pueda recibir reservas.
    pause
    exit /b 1
  )
  start "Gestor local RestBlu" /D "!GESTOR_DIR!" cmd.exe /k node.exe server.mjs
)

powershell -NoProfile -Command "try { $null=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://localhost:3000'; exit 0 } catch { exit 1 }"
if errorlevel 1 start "Plataforma RestBlu" /D "!WEB_DIR!" cmd.exe /k node.exe node_modules\vinext\dist\cli.js dev --host 127.0.0.1 --port 3000 --strictPort

echo Esperando que ambos programas esten disponibles...
powershell -NoProfile -Command "$urls=@('http://127.0.0.1:3100/api/health','http://localhost:3000'); foreach($url in $urls){ $ok=$false; 1..40 | ForEach-Object { try { $null=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $url; $ok=$true; break } catch { Start-Sleep -Milliseconds 500 } }; if(-not $ok){ Write-Host ('No respondio: '+$url); exit 1 } }"
if errorlevel 1 (
  echo Revisa las ventanas del gestor y de la plataforma para ver el error.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $health=Invoke-RestMethod -TimeoutSec 3 'http://127.0.0.1:3100/api/health'; if($health.ok -and $health.emailConfigured -and $health.firebaseConfigured){ exit 0 }; Write-Host 'El gestor respondio, pero correo o Firebase requieren revision.'; exit 1 } catch { exit 1 }"
if errorlevel 1 (
  echo Revisa la configuracion privada y la ventana del gestor antes de abrir la web.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3100"
start "" "http://localhost:3000"
exit /b 0
