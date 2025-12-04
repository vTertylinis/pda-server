@echo off
cd /d "C:\PersonalTest\restaurant-backend"
start /MIN "Node Server" node server.js

rem Launch ngrok from the script's directory on port 4300
rem Keep window open to show ngrok output/errors
start /MIN "ngrok" cmd /k "%~dp0ngrok.exe" http 4300
