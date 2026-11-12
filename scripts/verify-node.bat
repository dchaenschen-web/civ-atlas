@echo off
cd /d "%~dp0.."
node node_modules\typescript\bin\tsc -p tsconfig.node.json
if errorlevel 1 goto fail
if not exist out\jsbuild mkdir out\jsbuild
echo {"type":"commonjs"} > out\jsbuild\package.json
node out\jsbuild\scripts\node-verify.js
exit /b %ERRORLEVEL%
:fail
echo compile failed
exit /b 1
