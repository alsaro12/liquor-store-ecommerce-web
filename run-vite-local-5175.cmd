@echo off
cd /d "%~dp0"
npm.cmd run dev:react -- --host 0.0.0.0 --port 5175
