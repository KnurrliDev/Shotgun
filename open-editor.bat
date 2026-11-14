@echo off
rem Opens VS Code with the Shotgun extension of this folder. The title of the window starts with
rem "[Extension Development Host]". The script compiles the extension first. If VS Code has the window already, it
rem loads the window again with the new code.
rem
rem Usage: open-editor.bat [folder or file] [other arguments of VS Code]
rem With no folder, VS Code opens the last folder of the window.
rem Shotgun needs DataFlow 0.6.0 or a later version. The window uses the DataFlow extension of VS Code. To use DataFlow
rem from its repository folder, set the environment variable DATAFLOW_REPO to that folder. The script then compiles
rem DataFlow too.
rem If VS Code runs as administrator, also run this script as administrator.
setlocal
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

rem VS Code: the command code of the PATH, else a user installation, else a system installation
set "CODE="
for /f "delims=" %%c in ('where code.cmd 2^>nul') do if not defined CODE set "CODE=%%c"
if not defined CODE if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd" set "CODE=%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"
if not defined CODE if exist "%ProgramFiles%\Microsoft VS Code\bin\code.cmd" set "CODE=%ProgramFiles%\Microsoft VS Code\bin\code.cmd"
if not defined CODE (
	echo VS Code is not in the PATH and not in its usual folders. Add the folder bin of VS Code to the PATH.
	pause
	exit /b 1
)

echo Compiling the extension...
pushd "%ROOT%"
call npm run compile
if errorlevel 1 (
	popd
	echo The compilation failed. Read the errors above.
	pause
	exit /b 1
)
popd

rem DataFlow: the repository folder of DATAFLOW_REPO, else the extension in VS Code
set "DATAFLOW="
if not defined DATAFLOW_REPO goto installed
rem a backslash before the quote at the end of an argument makes the quote a part of the path
if "%DATAFLOW_REPO:~-1%"=="\" set "DATAFLOW_REPO=%DATAFLOW_REPO:~0,-1%"
if not exist "%DATAFLOW_REPO%\package.json" (
	echo DATAFLOW_REPO is not the folder of the DataFlow repository: %DATAFLOW_REPO%
	pause
	exit /b 1
)
echo Compiling DataFlow...
pushd "%DATAFLOW_REPO%"
call npm run compile
if errorlevel 1 (
	popd
	echo The compilation of DataFlow failed. Read the errors above.
	pause
	exit /b 1
)
popd
if not exist "%DATAFLOW_REPO%\engine\bin\dataflow-engine.exe" if not exist "%DATAFLOW_REPO%\build\engine\dataflow-engine.exe" (
	echo DataFlow has no engine in build\engine. DataFlow cannot parse C++ code until you build the engine.
	echo Read engine\README.md of DataFlow.
	pause
)
set DATAFLOW=--extensionDevelopmentPath="%DATAFLOW_REPO%"
goto open

:installed
if not exist "%USERPROFILE%\.vscode\extensions\knurrlidev.dataflow-*" (
	echo VS Code has no DataFlow extension. Shotgun needs DataFlow 0.6.0 or a later version.
	echo Install DataFlow, or set DATAFLOW_REPO to the folder of the DataFlow repository.
	pause
)

:open
call "%CODE%" --new-window --extensionDevelopmentPath="%ROOT%" %DATAFLOW% %*
endlocal
