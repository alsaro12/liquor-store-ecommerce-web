@echo off
cd /d "%~dp0"
npm.cmd run dev:react -- --host localhost --port 5174
