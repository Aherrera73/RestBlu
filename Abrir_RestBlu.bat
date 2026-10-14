@echo off
setlocal EnableExtensions EnableDelayedExpansion
title RestBlu - Iniciador

rem El inicio normal abre siempre la web y el backend requerido para correos,
rem Firebase, SQLite y comprobantes. Usa --solo-web solo para desarrollo visual.
if /I not "%~1"=="--solo-web" (
  call "%~dp0Abrir_RestBlu_Completo.bat" %*
  exit /b !errorlevel!
)

set "APP_PORT=3000"
set "APP_URL=http://localhost:%APP_PORT%"
set "BASE_DIR=%~dp0"
set "PROJECT_DIR="

rem El BAT funciona desde la raiz del proyecto o desde la carpeta frontend.
if exist "%BASE_DIR%package.json" set "PROJECT_DIR=%BASE_DIR%"
if not defined PROJECT_DIR if exist "%BASE_DIR%frontend\package.json" set "PROJECT_DIR=%BASE_DIR%frontend"

if not defined PROJECT_DIR goto project_error

rem Primero busca Node.js instalado en Windows. Si no existe, usa el runtime incluido con Codex.
where node.exe >nul 2>&1
if errorlevel 1 (
  set "CODEX_NODE_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
  if exist "!CODEX_NODE_DIR!\node.exe" set "PATH=!CODEX_NODE_DIR!;!PATH!"
)

where node.exe >nul 2>&1
if errorlevel 1 goto node_error

for /f "delims=" %%V in ('node.exe -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto node_error
if !NODE_MAJOR! LSS 22 goto node_version_error

pushd "%PROJECT_DIR%"

if not exist "node_modules\.bin\vinext.cmd" (
  where npm.cmd >nul 2>&1
  if errorlevel 1 (
    if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" (
      echo.
      echo Primera ejecucion: instalando dependencias de RestBlu...
      call "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" install
      if errorlevel 1 (
        popd
        goto install_error
      )
      goto dependencies_ready
    ) else (
      popd
      goto npm_error
    )
  )
  echo.
  echo Primera ejecucion: instalando dependencias de RestBlu...
  echo Este proceso puede tardar varios minutos.
  call npm.cmd install
  if errorlevel 1 (
    popd
    goto install_error
  )
)

:dependencies_ready

if /I "%~1"=="--check" (
  echo.
  echo RestBlu esta listo para iniciarse.
  echo Proyecto: !PROJECT_DIR!
  echo Node.js:
  node.exe --version
  popd
  exit /b 0
)

popd

powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 goto port_error

echo.
echo Iniciando RestBlu...
echo Se abrira una segunda ventana para mantener el programa funcionando.
echo Para detenerlo, cierre la ventana llamada "Servidor RestBlu".

start "Servidor RestBlu - dejar abierto" /D "%PROJECT_DIR%" cmd.exe /k "node.exe node_modules\vinext\dist\cli.js dev --host 127.0.0.1 --port %APP_PORT% --strictPort"

powershell.exe -NoProfile -Command "$url='%APP_URL%'; for ($i=0; $i -lt 40; $i++) { try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2; if ($response.StatusCode -lt 500) { exit 0 } } catch {}; Start-Sleep -Milliseconds 750 }; exit 1"
if errorlevel 1 goto startup_error

start "" "%APP_URL%"
echo.
echo RestBlu se abrio correctamente en %APP_URL%
timeout /t 3 /nobreak >nul
exit /b 0

:project_error
echo.
echo ERROR: No se encontro el proyecto RestBlu.
echo Mantenga este archivo junto a la carpeta "frontend"
echo o dentro de la carpeta que contiene package.json.
goto finish_error

:node_error
echo.
echo ERROR: Node.js no esta instalado o no aparece en PATH.
echo Instale Node.js 22 o superior y vuelva a ejecutar este archivo.
goto finish_error

:npm_error
echo.
echo ERROR: npm no esta disponible.
echo Reinstale Node.js incluyendo npm y vuelva a intentarlo.
goto finish_error

:node_version_error
echo.
echo ERROR: RestBlu necesita Node.js 22 o superior.
echo Version detectada:
node.exe --version
goto finish_error

:install_error
echo.
echo ERROR: No fue posible instalar las dependencias de RestBlu.
echo Revise la conexion a Internet y vuelva a intentarlo.
goto finish_error

:port_error
echo.
echo ERROR: El puerto %APP_PORT% ya esta siendo usado por otro programa.
echo Cierre el otro servidor y vuelva a ejecutar este archivo.
goto finish_error

:startup_error
echo.
echo ERROR: El servidor no respondio a tiempo.
echo Revise los mensajes de la ventana "Servidor RestBlu".
goto finish_error

:finish_error
echo.
pause
exit /b 1
