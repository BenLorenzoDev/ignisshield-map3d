@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Map3D.ps1"
if errorlevel 1 pause
