#!/usr/bin/env bash
# Axon AI Reader — one-line installer for Raspberry Pi Zero 2 W
#
#   curl -fsSL https://axondynamics.lovable.app/pi/install.sh | bash
#
# Installs the camera + audio tools, downloads the Axon client, and sets up an
# optional service so it starts on boot. Safe to re-run: it just updates.

set -euo pipefail

BASE="${AXON_BASE:-https://axondynamics.lovable.app}"
DIR="$HOME/axon"

echo "== Axon installer =="
echo "server: $BASE"

echo "-- installing packages (needs your sudo password once)"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
  python3 python3-requests python3-evdev python3-pil \
  mpg123 espeak-ng \
  rpicam-apps 2>/dev/null || sudo apt-get install -y --no-install-recommends \
  python3 python3-requests python3-evdev python3-pil mpg123 espeak-ng libcamera-apps

mkdir -p "$DIR"
echo "-- downloading client"
if [ -f "$DIR/axon.py" ]; then
  cp "$DIR/axon.py" "$DIR/axon.py.bak.$(date +%Y%m%d%H%M%S)"
fi
curl -fsSL "$BASE/pi/axon.py" -o "$DIR/axon.py"
chmod +x "$DIR/axon.py"

# keep existing settings if re-running
if [ ! -f "$DIR/axon.env" ]; then
  cat > "$DIR/axon.env" <<EOF
AXON_BASE=$BASE
# AXON_COURSE=PHY202     # limit answers to one course's material
AXON_VOICE=sage
AXON_SPEED=0.95
AXON_WIDTH=2328
AXON_HEIGHT=1748
# Upload resize tunables: keep detail for text/math/graphs
# AXON_MAX_SIDE=3000     # longest edge of the upload copy (px)
# AXON_QUALITY=90        # JPEG quality of upload copy
# AXON_TARGET_KB=1200    # try to stay under this size (adaptive fallback)
EOF
fi

# allow reading HID keys (ring remote) without root
sudo usermod -aG input,video,audio "$USER" || true

echo "-- installing service (axon.service)"
if [ -f /etc/systemd/system/axon.service ]; then
  sudo cp /etc/systemd/system/axon.service \
    "$DIR/axon.service.bak.$(date +%Y%m%d%H%M%S)"
fi
sudo tee /etc/systemd/system/axon.service >/dev/null <<EOF
[Unit]
Description=Axon AI Reader
After=network-online.target bluetooth.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
EnvironmentFile=$DIR/axon.env
ExecStart=/usr/bin/python3 $DIR/axon.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload

cat <<EOF

Done. Quick test (single photo, speaks the answer):

    python3 $DIR/axon.py --once

Run it interactively (ENTER = capture, r = repeat, q = quit):

    python3 $DIR/axon.py

Start on boot:

    sudo systemctl enable --now axon
    journalctl -u axon -f          # watch what it is doing

Settings live in $DIR/axon.env  (course, voice, photo size).
Log file: $DIR/axon.log
Note: log out and back in once so the input/audio group access takes effect.
EOF
