#!/usr/bin/env bash
# Axon — install the natural offline voice (Piper) on the Raspberry Pi.
#
#   curl -fsSL https://axondynamics.lovable.app/pi/voice.sh | bash
#
# Piper is a free neural text-to-speech engine that runs entirely on the Pi.
# It sounds close to a human reader, costs nothing per use, needs no account
# and works with no internet. After this, Axon speaks with it automatically.
#
# Voice: set AXON_VOICE_NAME before running to pick another one, e.g.
#   AXON_VOICE_NAME=en_US-ryan-low  curl -fsSL .../voice.sh | bash
# Available (small + fast, good for Pi Zero 2 W):
#   en_US-amy-low  en_US-ryan-low  en_US-lessac-low  en_GB-alan-low
# Bigger/clearer but slower on a Zero: swap "low" for "medium".

set -euo pipefail

DIR="$HOME/axon"
NAME="${AXON_VOICE_NAME:-en_US-amy-low}"
PIPER_VER="2023.11.14-2"
mkdir -p "$DIR/piper"

# --- pick the right build for this Pi -------------------------------------
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) PKG="piper_linux_aarch64.tar.gz" ;;
  armv7l|armv6l) PKG="piper_linux_armv7l.tar.gz" ;;
  x86_64)        PKG="piper_linux_x86_64.tar.gz" ;;
  *) echo "Unknown architecture $ARCH — staying with the basic voice."; exit 0 ;;
esac

echo "== Axon natural voice =="
echo "device: $ARCH   voice: $NAME"

sudo apt-get install -y --no-install-recommends alsa-utils curl >/dev/null 2>&1 || true

if [ ! -x "$DIR/piper/piper/piper" ]; then
  echo "-- downloading speech engine"
  curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/${PKG}" \
    -o /tmp/piper.tar.gz
  tar -xzf /tmp/piper.tar.gz -C "$DIR/piper"
  rm -f /tmp/piper.tar.gz
fi

# --- voice model ----------------------------------------------------------
LANG_DIR="$(echo "$NAME" | cut -d- -f1)"        # en_US
SPK="$(echo "$NAME" | cut -d- -f2)"             # amy
QUAL="$(echo "$NAME" | cut -d- -f3)"            # low
FAMILY="$(echo "$LANG_DIR" | cut -d_ -f1)"      # en
BASEURL="https://huggingface.co/rhasspy/piper-voices/resolve/main/${FAMILY}/${LANG_DIR}/${SPK}/${QUAL}/${NAME}"

if [ ! -f "$DIR/voice.onnx" ]; then
  echo "-- downloading voice"
  curl -fsSL "$BASEURL.onnx" -o "$DIR/voice.onnx"
  curl -fsSL "$BASEURL.onnx.json" -o "$DIR/voice.onnx.json"
fi

# --- tell Axon to use it --------------------------------------------------
touch "$DIR/axon.env"
sed -i '/^AXON_TTS=/d;/^AXON_PIPER=/d;/^AXON_PIPER_MODEL=/d' "$DIR/axon.env"
cat >> "$DIR/axon.env" <<EOF
AXON_TTS=local
AXON_PIPER=$DIR/piper/piper/piper
AXON_PIPER_MODEL=$DIR/voice.onnx
EOF

echo "-- test"
echo "Line one. The derivative of x squared is two x. Final answer, two x." \
  | "$DIR/piper/piper/piper" --model "$DIR/voice.onnx" --output_raw 2>/dev/null \
  | aplay -q -r 22050 -f S16_LE -t raw - || \
  echo "(no sound now? check your Bluetooth earbuds are connected, then rerun the test)"

cat <<EOF

Done. Axon now speaks with the natural offline voice — no credits, no internet.

  python3 $DIR/axon.py --once      # try a real page
  sudo systemctl restart axon      # if you run it as a service

Want the hosted voice back when credits exist? Set AXON_TTS=auto in $DIR/axon.env
Try another voice: AXON_VOICE_NAME=en_US-ryan-low curl -fsSL https://axondynamics.lovable.app/pi/voice.sh | bash
EOF
