@echo off
setlocal
title RestBlu Android

set "PROJECT_DIR=%~dp0android-app"
set "STUDIO_EXE=C:\Program Files\Android\Android Studio\bin\studio64.exe"

if not exist "%PROJECT_DIR%\settings.gradle.kts" (
  echo No se encontro el proyecto Android en:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

if not exist "%STUDIO_EXE%" (
  echo No se encontro Android Studio en la ruta habitual.
  echo Abre Android Studio manualmente y selecciona esta carpeta:
  echo %PROJECT_DIR%
  echo.
  start "" explorer.exe "%PROJECT_DIR%"
  pause
  exit /b 1
)

start "RestBlu Android" "%STUDIO_EXE%" "%PROJECT_DIR%"
exit /b 0
