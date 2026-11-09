@echo off
rem Avvia l'editor: un piccolo server su http://localhost:8100 e la pagina in Edge.
rem Per chiuderlo basta chiudere questa finestra.
cd /d "%~dp0"
start "" msedge http://localhost:8100/
node tools\serve.js 8100
