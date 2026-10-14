@echo off
setlocal EnableExtensions
title Configurar servicios RestBlu

set "GESTOR_DIR=%~dp0backend"
set "CONFIG_DIR=%LOCALAPPDATA%\RestBlu"
set "CONFIG_FILE=%CONFIG_DIR%\.env.local"
set "EXAMPLE_FILE=%GESTOR_DIR%\.env.local.example"
set "NODE_EXE="

where node.exe >nul 2>&1
if not errorlevel 1 set "NODE_EXE=node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%EXAMPLE_FILE%" (
  echo No se encontro la plantilla de configuracion.
  pause
  exit /b 1
)

if /I "%~1"=="--check" goto CHECK_ONLY

if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"
if not exist "%CONFIG_FILE%" copy /Y "%EXAMPLE_FILE%" "%CONFIG_FILE%" >nul

echo.
echo Revisando el estado actual sin mostrar datos privados...
call :RUN_SETUP_CHECK
echo.
echo Se abrira la configuracion privada de RestBlu.
echo.
echo CORREO SMTP
echo - Completa SMTP_HOST, SMTP_USER y SMTP_PASS.
echo - Si usas Gmail, activa la verificacion en dos pasos y usa una
echo   contrasena de aplicacion de Google; no uses tu contrasena normal.
echo.
echo FIREBASE
echo - Descarga una clave JSON de cuenta de servicio del proyecto Firebase.
echo - Escribe su ruta absoluta en FIREBASE_SERVICE_ACCOUNT_PATH.
echo - No compartas ni adjuntes ese JSON: contiene credenciales privadas.
echo.
echo Guarda el archivo y cierra el Bloc de notas para aplicar los cambios.
echo.
echo La configuracion queda fuera de la carpeta del proyecto para no incluirla en un ZIP.
start "" /wait notepad.exe "%CONFIG_FILE%"
echo.
echo Comprobando nuevamente la configuracion...
call :RUN_SETUP_CHECK
set "SETUP_STATUS=%ERRORLEVEL%"
echo.
if "%SETUP_STATUS%"=="0" (
  echo Configuracion basica lista. Se reiniciara el gestor para aplicarla.
) else (
  echo La configuracion sigue pendiente. Puedes volver a ejecutar este archivo cuando quieras.
  echo El gestor se abrira en modo limitado. Con Firebase configurado puede
  echo sincronizar reservas de telefonos, pero el correo necesita SMTP.
)
echo.
call "%~dp0Abrir_Gestor_RestBlu.bat"
exit /b %errorlevel%

:CHECK_ONLY
call :RUN_SETUP_CHECK
exit /b %errorlevel%

:RUN_SETUP_CHECK
if not defined NODE_EXE (
  echo [AVISO] No se encontro Node.js; no se pudo ejecutar la revision automatica.
  echo Instala Node.js 22 o superior. El archivo privado se puede completar igualmente.
  exit /b 3
)
"%NODE_EXE%" "%GESTOR_DIR%\scripts\check-setup.mjs" --config "%CONFIG_FILE%"
exit /b %errorlevel%
