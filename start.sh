#!/bin/sh
# Démarrer Xvfb (écran virtuel) pour Chrome non-headless
Xvfb :99 -screen 0 1280x720x24 -ac &
XVFB_PID=$!

# Attendre que Xvfb soit prêt
sleep 1

export DISPLAY=:99

echo "[start.sh] Xvfb démarré (PID=$XVFB_PID), DISPLAY=$DISPLAY"
exec node server.js
