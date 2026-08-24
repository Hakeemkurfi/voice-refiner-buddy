/* ============================================================================
   AXON DYNAMICS — NeuroSync Edge Node  (ESP32)
   Developed by Hakeem Kurfi — Katsina, Nigeria
   Harbin Engineering University · Dept. of Science and Intelligent Systems
   Class of AI · Research: Neuroscience

   WHAT THIS SKETCH DOES
   ---------------------
   1. Hosts the BLE HID ring (same ring used in the previous project) directly
      on the ESP32 — no phone pairing needed.
        · middle click  -> toggle the physical bulb relay + tell the web app
        · swipe RIGHT   -> next emotion channel
        · swipe LEFT    -> previous emotion channel
        · swipe UP      -> raise arousal intensity
        · swipe DOWN    -> lower arousal intensity
   2. Drives a relay on RELAY_PIN (GPIO 26) for the real bulb.
   3. Streams a simulated/real EEG waveform (ADC on EEG_PIN, GPIO 34) to the
      web dashboard so the graphs move with the brain signal.
   4. Talks to the web console at:
        POST https://<SERVER_HOST>/api/public/neuro
        body: {"toggle_bulb":true} | {"cycle_emotion":true} |
              {"emotion":"anger"}  | {"intensity":0.7}      | {"eeg":[...]}
   5. Serves a LOCAL dashboard at http://<esp-ip>/ that also works as a
      BROWSER RELAY: if the ESP32's own HTTPS is blocked by the hotspot, keep
      that page open on your phone and it forwards every ring action for you.

   WIRING
   ------
     Relay IN  -> GPIO 26        (RELAY_ACTIVE_LOW = 1 for most blue relays)
     Relay VCC -> 5V, GND -> GND
     EEG / analog electrode front-end -> GPIO 34 (ADC1_CH6), optional

   ARDUINO IDE / USB (ESP32-S3 boards with two USB sockets)
   ----------------------------------------------------------
     Board: "ESP32S3 Dev Module"   USB CDC On Boot: "Enabled"
     Use the socket/COM port that successfully uploads for BOTH upload and
     Serial Monitor. Set Serial Monitor to 115200 baud. The other socket may
     be the native USB/OTG connector and can disappear unless the sketch
     exposes a USB device; a stale COM9 must not be selected.
   ========================================================================== */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEClient.h>
#include <BLESecurity.h>
#include <BLERemoteDescriptor.h>
#include <math.h>

// ─────────────────────────── USER SETTINGS ────────────────────────────────
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"

// Your published Axon Dynamics app host (no https://, no trailing slash)
#define SERVER_HOST     "axondynamics.lovable.app"
#define SERVER_PATH     "/api/public/neuro"
#define DEVICE_ID       "esp32-neuro-01"

#define RELAY_PIN        19       // matches the relay pin shown in your serial log
#define RELAY_ACTIVE_LOW 1        // 1 = relay closes when pin is LOW
#define EEG_PIN          34       // ADC input; leave floating to use simulation
#define USE_REAL_ADC     0        // 1 = read GPIO34, 0 = synthesise the wave

#define ENABLE_BLE_RING  1
#define RING_NAME_HINT   ""       // "" accepts any BLE HID ring
#define EEG_POST_MS      5000     // leave network time for web-to-ESP command polling
#define COMMAND_POLL_MS  1500     // web lamp/emotion updates reach the ESP32 quickly
#define MIDDLE_LONGPRESS_MS 800

// ───────────────────────────── STATE ──────────────────────────────────────
static bool  bulbOn        = false;
static int   emotionIndex  = 0;
static float intensity     = 0.45f;

static const char* EMOTIONS[] = { "neutral", "rest", "happy", "laugh", "excitement", "stressed", "anger" };
static const int   EMOTION_COUNT = 7;

WebServer localServer(80);

// Browser-relay queue (used when ESP32 HTTPS is blocked by the network)
static String relayQueue[12];
static int relayHead = 0, relayTail = 0, relayCount = 0;
static bool browserRelayFirst = false;   // auto-enabled after 3 HTTPS failures
static uint8_t httpsFailures = 0;

static void queueBrowserRelay(const char* action) {
  if (relayCount >= 12) { relayHead = (relayHead + 1) % 12; relayCount--; }
  relayQueue[relayTail] = String(action);
  relayTail = (relayTail + 1) % 12;
  relayCount++;
  Serial.printf("[relay] queued '%s' for the browser dashboard (%d waiting)\n", action, relayCount);
}
static String popBrowserRelay() {
  if (relayCount == 0) return "";
  String a = relayQueue[relayHead];
  relayHead = (relayHead + 1) % 12;
  relayCount--;
  return a;
}

// ─────────────────────── RELAY / BULB CONTROL ─────────────────────────────
static void applyRelay() {
#if RELAY_ACTIVE_LOW
  digitalWrite(RELAY_PIN, bulbOn ? LOW : HIGH);
#else
  digitalWrite(RELAY_PIN, bulbOn ? HIGH : LOW);
#endif
  Serial.printf("[bulb] %s  (GPIO%d -> %s)\n", bulbOn ? "ON" : "OFF", RELAY_PIN,
                (RELAY_ACTIVE_LOW ? (bulbOn ? "LOW" : "HIGH") : (bulbOn ? "HIGH" : "LOW")));
}

// ───────────────────────────── HTTPS POST ─────────────────────────────────
static bool postJson(const String& json) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[net] WiFi down — cannot POST");
    return false;
  }
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(12000);
  client.setHandshakeTimeout(15);

  bool connected = false;
  for (int attempt = 1; attempt <= 3 && !connected; attempt++) {
    Serial.printf("[tls] connect attempt %d/3 to %s:443\n", attempt, SERVER_HOST);
    connected = client.connect(SERVER_HOST, 443);
    if (!connected) delay(400);
  }
  if (!connected) {
    httpsFailures++;
    Serial.printf("[tls] connect FAILED (WiFi RSSI %d). failures=%u\n", WiFi.RSSI(), httpsFailures);
    if (httpsFailures >= 3 && !browserRelayFirst) {
      browserRelayFirst = true;
      Serial.println("[relay] Browser-relay mode ENABLED — keep the local dashboard open on your phone.");
    }
    return false;
  }

  client.printf("POST %s HTTP/1.1\r\n", SERVER_PATH);
  client.printf("Host: %s\r\n", SERVER_HOST);
  client.printf("X-Device-Id: %s\r\n", DEVICE_ID);
  client.print("Content-Type: application/json\r\n");
  client.print("Connection: close\r\n");
  client.printf("Content-Length: %d\r\n\r\n", json.length());
  client.print(json);

  unsigned long t0 = millis();
  String resp;
  while (client.connected() && millis() - t0 < 8000) {
    while (client.available()) resp += (char)client.read();
  }
  client.stop();
  int code = 0;
  int sp = resp.indexOf(' ');
  if (sp > 0 && resp.startsWith("HTTP/")) code = resp.substring(sp + 1, sp + 4).toInt();
  int bodyAt = resp.indexOf("\r\n\r\n");
  String responseBody = bodyAt >= 0 ? resp.substring(bodyAt + 4) : resp;
  responseBody.trim();
  if (responseBody.length() > 240) responseBody = responseBody.substring(0, 240) + "...";
  Serial.printf("[server] POST https://%s%s -> HTTP %d\n", SERVER_HOST, SERVER_PATH, code);
  if (responseBody.length()) Serial.printf("[server] response: %s\n", responseBody.c_str());
  if (code >= 200 && code < 300) {
    httpsFailures = 0;
    Serial.println("[server] SUCCESS — web dashboard received the update");
    return true;
  }
  Serial.println("[server] FAILED — update was not accepted");
  return false;
}

static bool extractJsonBool(const String& body, const char* key, bool& value) {
  String marker = String("\"") + key + "\":";
  int at = body.indexOf(marker);
  if (at < 0) return false;
  at += marker.length();
  while (at < (int)body.length() && body[at] == ' ') at++;
  if (body.startsWith("true", at)) { value = true; return true; }
  if (body.startsWith("false", at)) { value = false; return true; }
  return false;
}

static bool extractJsonString(const String& body, const char* key, String& value) {
  String marker = String("\"") + key + "\":\"";
  int at = body.indexOf(marker);
  if (at < 0) return false;
  at += marker.length();
  int end = body.indexOf('"', at);
  if (end < 0) return false;
  value = body.substring(at, end);
  return true;
}

// Pull commands created by the public web console. This is what lets the
// website's lamp switch drive the same real relay as the ring middle button.
static unsigned long lastCommandPoll = 0;
static void pollRemoteState() {
  if (browserRelayFirst || WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastCommandPoll < COMMAND_POLL_MS) return;
  lastCommandPoll = millis();

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5000);
  client.setHandshakeTimeout(8);
  if (!client.connect(SERVER_HOST, 443)) return;
  client.printf("GET %s HTTP/1.1\r\n", SERVER_PATH);
  client.printf("Host: %s\r\n", SERVER_HOST);
  client.print("Accept: application/json\r\nConnection: close\r\n\r\n");

  unsigned long started = millis();
  String response;
  while (client.connected() && millis() - started < 5000) {
    while (client.available()) response += (char)client.read();
    delay(1);
  }
  client.stop();
  int bodyAt = response.indexOf("\r\n\r\n");
  if (bodyAt < 0 || !response.startsWith("HTTP/1.1 200") && !response.startsWith("HTTP/2 200")) return;
  String body = response.substring(bodyAt + 4);

  bool remoteBulb = bulbOn;
  if (extractJsonBool(body, "bulb", remoteBulb) && remoteBulb != bulbOn) {
    bulbOn = remoteBulb;
    Serial.printf("[server->esp] web lamp command: %s\n", bulbOn ? "ON" : "OFF");
    applyRelay();
  }
  String remoteEmotion;
  if (extractJsonString(body, "emotion", remoteEmotion)) {
    for (int i = 0; i < EMOTION_COUNT; i++) {
      if (remoteEmotion == EMOTIONS[i] && emotionIndex != i) {
        emotionIndex = i;
        Serial.printf("[server->esp] web emotion: %s\n", EMOTIONS[emotionIndex]);
        break;
      }
    }
  }
}

static void sendState(const String& json, const char* relayAction) {
  if (browserRelayFirst) { queueBrowserRelay(relayAction); return; }
  if (!postJson(json))   queueBrowserRelay(relayAction);
}

// ───────────────────────── ACTIONS (ring + serial) ────────────────────────
static void actToggleBulb() {
  bulbOn = !bulbOn;
  applyRelay();
  String j = String("{\"bulb\":") + (bulbOn ? "true" : "false") +
             ",\"device_id\":\"" DEVICE_ID "\"}";
  sendState(j, bulbOn ? "bulb_on" : "bulb_off");
}
static void actEmotion(int dir) {
  emotionIndex = (emotionIndex + dir + EMOTION_COUNT) % EMOTION_COUNT;
  Serial.printf("[emotion] -> %s\n", EMOTIONS[emotionIndex]);
  String j = String("{\"emotion\":\"") + EMOTIONS[emotionIndex] + "\",\"device_id\":\"" DEVICE_ID "\"}";
  sendState(j, dir > 0 ? "emotion_next" : "emotion_prev");
}
static void actIntensity(float delta) {
  intensity += delta;
  if (intensity > 1.0f) intensity = 1.0f;
  if (intensity < 0.0f) intensity = 0.0f;
  Serial.printf("[arousal] %.2f\n", intensity);
  String j = String("{\"intensity\":") + String(intensity, 2) + ",\"device_id\":\"" DEVICE_ID "\"}";
  sendState(j, delta > 0 ? "intensity_up" : "intensity_down");
}

// ────────────────────────── EEG TELEMETRY ─────────────────────────────────
static unsigned long lastEegPost = 0;
static float eegPhase = 0;

static void postEeg() {
  if (millis() - lastEegPost < EEG_POST_MS) return;
  lastEegPost = millis();

  // Band signature per emotion: {freq, amp, noise}
  const float F[7] = { 0.8, 1.0, 1.5, 2.6, 3.4, 3.0, 4.0 };
  const float A[7] = { 0.30, 0.42, 0.55, 0.72, 0.80, 0.60, 0.95 };
  const float N[7] = { 0.04, 0.05, 0.08, 0.16, 0.20, 0.30, 0.40 };

  String arr = "[";
  for (int i = 0; i < 64; i++) {
    float v;
#if USE_REAL_ADC
    v = (analogRead(EEG_PIN) - 2048) / 2048.0f;   // centre and normalise
#else
    eegPhase += 0.09f + F[emotionIndex] * 0.02f;
    v = sinf(eegPhase * F[emotionIndex]) * A[emotionIndex] * (0.5f + intensity)
      + sinf(eegPhase * F[emotionIndex] * 2.7f) * A[emotionIndex] * 0.3f
      + ((random(1000) / 1000.0f) - 0.5f) * N[emotionIndex] * 2.0f;
#endif
    if (i) arr += ",";
    arr += String(v, 3);
  }
  arr += "]";

  String j = String("{\"eeg\":") + arr +
             ",\"intensity\":" + String(intensity, 2) +
             ",\"device_id\":\"" DEVICE_ID "\"}";
  if (browserRelayFirst) return;   // waveform is optional; skip while relaying
  postJson(j);
}

// ═══════════════════════ BLE HID RING HOST ════════════════════════════════
#if ENABLE_BLE_RING
static BLEAdvertisedDevice* ringDevice = nullptr;
static BLEClient*           ringClient = nullptr;
static bool ringConnected  = false;
static bool ringScanRunning = false;
static unsigned long lastBleScan = 0;
static unsigned long lastRingAction = 0;
static unsigned long lastRingConnectAttempt = 0;
static uint8_t ringConnectFailures = 0;
static unsigned long ringConnectBackoff = 2500;
static bool ringMiddleHeld = false;
static unsigned long ringMiddleHeldAt = 0;
volatile unsigned long lastMiddlePatternAt = 0;

class RingClientCallbacks : public BLEClientCallbacks {
  void onConnect(BLEClient*) override    { Serial.println("[ring] BLE link opened"); }
  void onDisconnect(BLEClient*) override {
    ringConnected = false;
    lastBleScan = 0;
    Serial.println("[ring] disconnected — rescanning");
  }
};
static RingClientCallbacks ringCallbacks;

static void configureRingSecurity() {
  BLESecurity* security = new BLESecurity();
  security->setAuthenticationMode(ESP_LE_AUTH_BOND);
  security->setCapability(ESP_IO_CAP_NONE);
  security->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
  security->setRespEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
}

static void ringAction(const char* action) {
  if (millis() - lastRingAction < 400) return;
  lastRingAction = millis();
  Serial.printf("\n>>> [RING] %s  (BLE=%s) <<<\n", action, ringConnected ? "YES" : "NO");
  if      (!strcmp(action, "bulb"))      actToggleBulb();
  else if (!strcmp(action, "next"))      actEmotion(+1);
  else if (!strcmp(action, "prev"))      actEmotion(-1);
  else if (!strcmp(action, "int_up"))    actIntensity(+0.1f);
  else if (!strcmp(action, "int_down"))  actIntensity(-0.1f);
}

static void ringFireMiddle(bool isRelease) {
  if (!isRelease) {
    if (!ringMiddleHeld) { ringMiddleHeld = true; ringMiddleHeldAt = millis(); }
  } else if (ringMiddleHeld) {
    unsigned long held = millis() - ringMiddleHeldAt;
    ringMiddleHeld = false;
    // short OR long press both toggle the bulb — one button, one job.
    (void)held;
    ringAction("bulb");
  }
}

static void handleRingReport(uint8_t* d, size_t len) {
  Serial.print("[ring] report:");
  for (size_t i = 0; i < len; i++) Serial.printf(" %02X", d[i]);
  Serial.println();
  if (len == 0) return;

  bool isMouseMode = (len == 4 && d[3] == 0x1F);
  uint8_t mouseBtn = isMouseMode ? (d[0] & 0x07) : 0;

  bool anyPressed = false;
  if (isMouseMode) anyPressed = (mouseBtn != 0);
  else for (size_t i = 0; i < len; i++) if (d[i]) anyPressed = true;

  if (!anyPressed) { ringFireMiddle(true); return; }

  // Ring's own middle-button signature captured previously: [XX] F4 01 19
  if (len == 4 && d[1] == 0xF4 && d[2] == 0x01 && d[3] == 0x19) {
    lastMiddlePatternAt = millis();
    if (!ringMiddleHeld) ringFireMiddle(false);
    return;
  }
  if (len >= 3 && d[1] == 0xF4) return;   // gyro / air-mouse drift

  if (isMouseMode) {
    static bool mmPrevBtn = false;
    int8_t dx = (int8_t)d[1], dy = (int8_t)d[2];
    bool moving = abs((int)dx) > 12 || abs((int)dy) > 12;
    bool btnNow = (mouseBtn != 0 && !moving);
    if (btnNow && !mmPrevBtn)      ringFireMiddle(false);
    else if (!btnNow && mmPrevBtn) ringFireMiddle(true);
    mmPrevBtn = btnNow;

    static int32_t accX = 0, accY = 0;
    static uint32_t lastMoveAt = 0, lastDirAt = 0;
    const int32_t THRESH = 60;
    if (millis() - lastMoveAt > 250) { accX = 0; accY = 0; }
    if (dx || dy) lastMoveAt = millis();
    accX += dx; accY += dy;
    if (millis() - lastDirAt > 180) {
      if (accX >  THRESH) { ringAction("next");     accX = accY = 0; lastDirAt = millis(); return; }
      if (accX < -THRESH) { ringAction("prev");     accX = accY = 0; lastDirAt = millis(); return; }
      if (accY < -THRESH) { ringAction("int_up");   accX = accY = 0; lastDirAt = millis(); return; }
      if (accY >  THRESH) { ringAction("int_down"); accX = accY = 0; lastDirAt = millis(); return; }
    }
    return;
  }

  // Vendor air-mouse format
  if (len >= 4 && d[0] == 0x0F && d[1] == 0xEF) {
    uint16_t tail = (uint16_t(d[2]) << 8) | d[3];
    switch (tail) {
      case 0x0137: ringFireMiddle(false); return;
      case 0x8116: ringAction("next");     return;
      case 0x4115: ringAction("prev");     return;
      case 0x0114: ringAction("int_up");   return;
      case 0x0119: ringAction("int_down"); return;
      default: return;
    }
  }

  if (len >= 2 && d[1] == 0x2C) { ringFireMiddle(false); return; }   // Space

  // Standard HID keyboard report
  if (len >= 3) {
    for (size_t i = 2; i < len; i++) {
      switch (d[i]) {
        case 0x28: case 0x10: case 0x2C: ringFireMiddle(false); return;
        case 0x4F: ringAction("next");     return;   // →
        case 0x50: ringAction("prev");     return;   // ←
        case 0x52: ringAction("int_up");   return;   // ↑
        case 0x51: ringAction("int_down"); return;   // ↓
      }
    }
  }

  // 2-byte consumer report
  if (len == 2) {
    uint16_t v = d[0] | (uint16_t(d[1]) << 8);
    switch (v) {
      case 0x00CD: case 0x0001: ringFireMiddle(false); return;
      case 0x00B5: case 0x0080: ringAction("next");     return;
      case 0x00B6: case 0x0040: ringAction("prev");     return;
      case 0x00E9: case 0x0010: ringAction("int_up");   return;
      case 0x00EA: case 0x0020: ringAction("int_down"); return;
    }
  }
  Serial.println(">>> [RING] unmatched report <<<");
}

static void ringNotify(BLERemoteCharacteristic*, uint8_t* data, size_t len, bool) {
  handleRingReport(data, len);
}

class RingAdvertisedCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice dev) override {
    String name = dev.haveName() ? dev.getName().c_str() : "";
    bool nameOk = strlen(RING_NAME_HINT) == 0 || name.indexOf(RING_NAME_HINT) >= 0;
    bool hidOk  = dev.haveServiceUUID() && dev.isAdvertisingService(BLEUUID((uint16_t)0x1812));
    if (nameOk && hidOk) {
      Serial.printf("[ring] found BLE HID: %s\n", dev.toString().c_str());
      BLEDevice::getScan()->stop();
      if (ringDevice) delete ringDevice;
      ringDevice = new BLEAdvertisedDevice(dev);
      ringConnectFailures = 0;
      ringConnectBackoff = 2500;
      ringScanRunning = false;
    }
  }
};

static bool connectRingBle() {
  if (!ringDevice) return false;
  if (millis() - lastRingConnectAttempt < ringConnectBackoff) return false;
  lastRingConnectAttempt = millis();

  if (ringClient) {
    if (ringClient->isConnected()) ringClient->disconnect();
    delete ringClient; ringClient = nullptr;
  }
  Serial.printf("[ring] connecting to %s...\n", ringDevice->getAddress().toString().c_str());
  ringClient = BLEDevice::createClient();
  ringClient->setClientCallbacks(&ringCallbacks);

  if (!ringClient->connect(ringDevice)) {
    Serial.println("[ring] connect failed");
    delete ringClient; ringClient = nullptr;
    ringConnectFailures++;
    ringConnectBackoff = min((unsigned long)30000, ringConnectBackoff * 2);
    if (ringConnectFailures >= 5) {
      delete ringDevice; ringDevice = nullptr;
      ringConnectFailures = 0; ringConnectBackoff = 2500;
    }
    return false;
  }
  ringClient->setMTU(69);
  BLERemoteService* hid = ringClient->getService(BLEUUID((uint16_t)0x1812));
  if (!hid) { Serial.println("[ring] HID service missing"); ringClient->disconnect(); return false; }

  int subscribed = 0;
  std::map<std::string, BLERemoteCharacteristic*>* chars = hid->getCharacteristics();
  for (auto const& it : *chars) {
    BLERemoteCharacteristic* c = it.second;
    if (c->getUUID().equals(BLEUUID((uint16_t)0x2A4D)) && c->canNotify()) {
      c->registerForNotify(ringNotify);
      BLERemoteDescriptor* cccd = c->getDescriptor(BLEUUID((uint16_t)0x2902));
      if (cccd) { uint8_t on[] = {0x01, 0x00}; cccd->writeValue(on, 2, true); }
      subscribed++;
    }
  }
  ringConnected = subscribed > 0;
  Serial.printf("[ring] %s, reports=%d\n", ringConnected ? "CONNECTED" : "no notify", subscribed);
  return ringConnected;
}

static void initRingBle() {
  BLEDevice::init("Axon NeuroSync Node");
  BLEDevice::setPower(ESP_PWR_LVL_P9);
  configureRingSecurity();
  BLEScan* scan = BLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new RingAdvertisedCallbacks());
  scan->setActiveScan(true);
  scan->setInterval(96);
  scan->setWindow(64);
  Serial.println("[ring] BLE HID host ready. Unpair the ring from your phone first.");
}

static void maintainRingBle() {
  if (ringConnected && ringClient && ringClient->isConnected()) return;
  ringConnected = false;
  if (ringDevice && connectRingBle()) return;
  unsigned long scanInterval = (lastBleScan == 0) ? 0 : 8000;
  if (!ringScanRunning && millis() - lastBleScan > scanInterval) {
    lastBleScan = millis();
    ringScanRunning = true;
    BLEDevice::getScan()->start(5, false);
    BLEDevice::getScan()->clearResults();
    ringScanRunning = false;
  }
}
#else
static void initRingBle() {}
static void maintainRingBle() {}
#endif

// ─────────────────────── LOCAL DASHBOARD / RELAY ──────────────────────────
static void handleRoot() {
  String p = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>";
  p += "<title>Axon Dynamics — NeuroSync Node</title>";
  p += "<body style='font-family:system-ui;background:#0b1020;color:#e8ecf5;margin:0;padding:24px'>";
  p += "<h2 style='margin:0 0 4px'>Axon Dynamics — NeuroSync Edge Node</h2>";
  p += "<p style='opacity:.7;margin:0 0 18px'>Hakeem Kurfi · Katsina, Nigeria</p>";
  p += "<p>Bulb: <b id='b'>" + String(bulbOn ? "ON" : "OFF") + "</b> &nbsp;|&nbsp; Emotion: <b>" + String(EMOTIONS[emotionIndex]) + "</b></p>";
  p += "<p><button onclick=\"go('bulb')\" style='padding:12px 20px;font-size:16px'>Toggle bulb</button> ";
  p += "<button onclick=\"go('next')\" style='padding:12px 20px;font-size:16px'>Next emotion</button></p>";
  p += "<p id='s' style='opacity:.7'>relay idle</p>";
  p += "<script>const H='https://" SERVER_HOST "';const P='" SERVER_PATH "';";
  p += "async function send(a){let b={};if(a=='bulb'||a=='toggle_bulb'||a=='bulb_on'||a=='bulb_off')b={bulb:a=='bulb_on'?true:a=='bulb_off'?false:undefined,toggle_bulb:a=='bulb'||a=='toggle_bulb'};";
  p += "else if(a=='next'||a=='emotion_next')b={cycle_emotion:true};else if(a=='prev'||a=='emotion_prev')b={cycle_emotion:true};else if(a=='intensity_up'||a=='intensity_down')return;else return;";
  p += "await fetch(H+P,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});}";
  p += "async function go(a){document.getElementById('s').textContent='relaying '+a+'...';await fetch('/act?a='+a);await send(a);document.getElementById('s').textContent='sent '+a;}";
  p += "setInterval(async()=>{try{let r=await fetch('/relay',{cache:'no-store'});let j=await r.json();";
  p += "if(j.action){document.getElementById('s').textContent='ring -> '+j.action;await send(j.action);}}catch(e){}},900);";
  p += "</script></body>";
  localServer.send(200, "text/html", p);
}

static void handleAct() {
  String a = localServer.arg("a");
  if      (a == "bulb") actToggleBulb();
  else if (a == "next") actEmotion(+1);
  else if (a == "prev") actEmotion(-1);
  localServer.send(200, "application/json", "{\"ok\":true}");
}

static void handleRelay() {
  String a = popBrowserRelay();
  localServer.send(200, "application/json",
                   String("{\"action\":\"") + a + "\",\"queued\":" + String(relayCount) + "}");
}

// ──────────────────────────── SETUP / LOOP ────────────────────────────────
void setup() {
  Serial.begin(115200);
  unsigned long serialWaitStarted = millis();
  while (!Serial && millis() - serialWaitStarted < 3500) delay(20);
  delay(200);
  Serial.println("\n=== AXON DYNAMICS · NeuroSync Edge Node ===");
  Serial.println("[usb] Serial console READY at 115200 baud");
  Serial.println("[usb] Use the same COM port that uploaded this sketch; ignore stale COM9 if Windows cannot find it.");

  pinMode(RELAY_PIN, OUTPUT);
  applyRelay();
#if USE_REAL_ADC
  analogReadResolution(12);
  analogSetPinAttenuation(EEG_PIN, ADC_11db);
#endif

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) { delay(300); Serial.print("."); }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected. Dashboard: http://%s/  (RSSI %d)\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    Serial.printf("[wifi] IP=%s gateway=%s DNS=%s\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.gatewayIP().toString().c_str(),
                  WiFi.dnsIP().toString().c_str());
    Serial.printf("[server] testing https://%s%s ...\n", SERVER_HOST, SERVER_PATH);
    String startupState = String("{\"emotion\":\"") + EMOTIONS[emotionIndex] +
                          "\",\"intensity\":" + String(intensity, 2) +
                          ",\"bulb\":" + (bulbOn ? "true" : "false") +
                          ",\"device_id\":\"" DEVICE_ID "\"}";
    if (!postJson(startupState)) {
      Serial.println("[server] Direct HTTPS unavailable; ring actions will be queued for the local browser relay.");
    }
  } else {
    Serial.println("[wifi] NOT connected — ring + relay still work locally.");
    Serial.println("[wifi] Check 2.4 GHz SSID/password; ESP32 cannot join a 5 GHz-only network.");
  }

  localServer.on("/", handleRoot);
  localServer.on("/act", handleAct);
  localServer.on("/relay", handleRelay);
  localServer.begin();

  initRingBle();
  Serial.println("[ready] Serial commands: bulb / next / prev / up / down / status / testserver");
}

static unsigned long lastIpPrint = 0;

void loop() {
  localServer.handleClient();
  maintainRingBle();
  pollRemoteState();
  postEeg();

#if ENABLE_BLE_RING
  // The ring never sends an all-zero release for the F4 01 19 pattern, so
  // synthesise the release once the pattern stops arriving.
  if (ringMiddleHeld && millis() - lastMiddlePatternAt > 260) ringFireMiddle(true);
#endif

  if (Serial.available()) {
    String c = Serial.readStringUntil('\n');
    c.trim();
    if      (c == "bulb")   actToggleBulb();
    else if (c == "next")   actEmotion(+1);
    else if (c == "prev")   actEmotion(-1);
    else if (c == "up")     actIntensity(+0.1f);
    else if (c == "down")   actIntensity(-0.1f);
    else if (c == "testserver") {
      Serial.println("[server] manual connection test started");
      String testState = String("{\"emotion\":\"") + EMOTIONS[emotionIndex] +
                         "\",\"intensity\":" + String(intensity, 2) +
                         ",\"bulb\":" + (bulbOn ? "true" : "false") +
                         ",\"device_id\":\"" DEVICE_ID "\"}";
      postJson(testState);
    }
    else if (c == "status") {
      Serial.printf("[status] bulb=%s emotion=%s arousal=%.2f ring=%s wifi=%s relayMode=%s\n",
        bulbOn ? "ON" : "OFF", EMOTIONS[emotionIndex], intensity,
        ringConnected ? "CONNECTED" : "SEARCHING",
        WiFi.status() == WL_CONNECTED ? "OK" : "DOWN",
        browserRelayFirst ? "BROWSER" : "DIRECT");
      if (WiFi.status() == WL_CONNECTED)
        Serial.printf("[status] dashboard=http://%s/ server=https://%s%s RSSI=%d dBm\n",
                      WiFi.localIP().toString().c_str(), SERVER_HOST, SERVER_PATH, WiFi.RSSI());
    }
  }

  if (millis() - lastIpPrint > 15000) {
    lastIpPrint = millis();
    if (WiFi.status() == WL_CONNECTED)
      Serial.printf("[net] Dashboard: http://%s/  (RSSI %d dBm)\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
  }
  delay(5);
}
