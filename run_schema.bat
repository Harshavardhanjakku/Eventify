@echo off
REM Windows batch file to run the schema script
REM Update the database connection details below

echo Installing pg package if not already installed...
npm install pg

echo.
echo Running database schema report...
echo Make sure to update the database connection details in get_schema_windows.js
echo.

node get_schema_windows.js

pause
