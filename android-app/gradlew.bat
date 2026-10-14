@rem Gradle startup script for Windows
@echo off
setlocal

set APP_HOME=%~dp0
if "%APP_HOME%"=="" set APP_HOME=.
set CLASSPATH=%APP_HOME%gradle\wrapper\gradle-wrapper.jar

if defined JAVA_HOME goto findJavaFromJavaHome
set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if %ERRORLEVEL% equ 0 goto execute
echo ERROR: JAVA_HOME no esta definido y Java no se encuentra en PATH. 1>&2
echo Abre el proyecto con Android Studio o define JAVA_HOME. 1>&2
exit /b 1

:findJavaFromJavaHome
set JAVA_HOME=%JAVA_HOME:"=%
set JAVA_EXE=%JAVA_HOME%\bin\java.exe
if exist "%JAVA_EXE%" goto execute
echo ERROR: JAVA_HOME apunta a una carpeta sin java.exe: %JAVA_HOME% 1>&2
exit /b 1

:execute
"%JAVA_EXE%" %JAVA_OPTS% %GRADLE_OPTS% "-Dorg.gradle.appname=gradlew" -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
endlocal
