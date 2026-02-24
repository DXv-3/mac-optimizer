#!/bin/bash
# Unset ELECTRON_RUN_AS_NODE to allow Electron to initialize properly
unset ELECTRON_RUN_AS_NODE
export VITE_DEV_SERVER_URL="http://localhost:5173"
exec electron .
