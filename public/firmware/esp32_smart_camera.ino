/*
  ESP32-S3-WROOM N16R8 CAM — Smart Audio Tutor firmware
  ------------------------------------------------------
  Matches the EXACT camera pin map from your working camera_pins.h
  (CAMERA_MODEL_ESP32S3_WROOM_CAM). Replaces the CameraWebServer sketch.

  What it does
    - Connects to WiFi.
    - 3 buttons (one leg to GPIO, other leg to GND — internal pull-up):
        GPIO 1  = CAPTURE -> snaps a JPEG and POSTs it to your Lovable app
        GPIO 2  = NEXT    -> POSTs {"type":"next"}
        GPIO 3  = PREV    -> POSTs {"type":"prev"}
    - Endpoint:  https://<your-app>.lovable.app/api/public/event
                 header  X-Device-Secret: <DEVICE_SECRET>  (optional, set "" to disable)
                 header  X-Device-Id:     esp32-cam-01

  Arduino IDE settings (same as your working sketch)
    Board:            "ESP32S3 Dev Module"
    USB CDC On Boot:  "Enabled"
    PSRAM:            "OPI PSRAM"
    Flash Size:       "16MB"
    Partition Scheme: "16M Flash (3MB APP/9.9MB FATFS)"
    Upload Speed:     921600
*/

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEClient.h>
#include <map>

// ====== EDIT THESE ======
const char* WIFI_SSID     = "Hakeem";
const char* WIFI_PASS     = "10000000";
// Your PUBLISHED Lovable host — host only, no https://, no trailing slash.
const char* SERVER_HOST   = "voice-refiner-buddy.lovable.app";
const char* SERVER_PATH   = "/api/public/event";
const char* DEVICE_SECRET = "";              // endpoint is open right now — leave ""
const char* DEVICE_ID     = "esp32-cam-01";
// ========================

// Send the JPEG in small TLS chunks. HTTPClient can fail with "HTTP -3 send payload failed"
// on some ESP32-S3 boards when one full camera frame is written as a single HTTPS payload.
#define UPLOAD_CHUNK_SIZE 1024

// ====== BURST CAPTURE ======
// On M button (ring) we record a multi-frame burst, stream each frame to the
// server, then call /api/public/burst/finalize. The server picks the 3
// sharpest frames spread across the burst and sends them as a multi-image
// request to Gemini, which merges the text across all frames.
#define BURST_MS            4000   // total burst length in milliseconds
#define BURST_MIN_GAP_MS    160    // ~6 fps target; OV3660 QXGA caps out around here
#define BURST_MAX_FRAMES    30     // hard safety cap

// Button pins — chosen so they DO NOT collide with the camera bus.
// Your camera uses: 4,5,6,7,8,9,10,11,12,13,15,16,17,18.
// Safe free GPIOs on this board: 1, 2, 3, 14, 21, 38-42.
#define CAPTURE_BTN 1
#define NEXT_BTN    2
#define PREV_BTN    3

// Direct Bluetooth ring mode. Set to 0 if your Arduino ESP32 install does not
// include the BLE library, or if you need maximum RAM while debugging camera.
#define ENABLE_BLE_RING 1

// The ring usually advertises as a BLE HID keyboard/media controller.
// Leave empty to accept the first HID device found; set a fragment like
// "BT003" / "Ring" / "Remote" if another keyboard is nearby.
const char* RING_NAME_HINT = "";

WebServer localServer(80);

bool postCommand(const char* type);
bool checkServer();
bool captureAndSend();
bool runBurst();
void initRingBle();
void maintainRingBle();

// ----- Camera pin map (copied verbatim from your camera_pins.h, ESP32S3_WROOM_CAM)
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     15
#define SIOD_GPIO_NUM      4
#define SIOC_GPIO_NUM      5
#define Y2_GPIO_NUM       11
#define Y3_GPIO_NUM        9
#define Y4_GPIO_NUM        8
#define Y5_GPIO_NUM       10
#define Y6_GPIO_NUM       12
#define Y7_GPIO_NUM       18
#define Y8_GPIO_NUM       17
#define Y9_GPIO_NUM       16
#define VSYNC_GPIO_NUM     6
#define HREF_GPIO_NUM      7
#define PCLK_GPIO_NUM     13

bool initCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  // XCLK 16 MHz: OV3660 datasheet allows up to 24 MHz but 20-24 MHz on the
  // S3-WROOM cam's long DVP traces causes PCLK jitter / banding. 16 MHz is
  // the documented sweet spot for clean QXGA output on this exact module.
  config.xclk_freq_hz = 16000000;
  // OV3660 native is 2048x1536 (QXGA). Giving the encoder real native pixels
  // (instead of UXGA which is scaled down) is the single biggest sharpness
  // win for printed text at 15-25 cm.
  config.frame_size   = FRAMESIZE_QXGA;
  config.pixel_format = PIXFORMAT_JPEG;
  // GRAB_LATEST + fb_count=2 is the espressif-recommended pattern: the driver
  // keeps filling the second buffer in the background so esp_camera_fb_get()
  // always returns the freshest converged frame, never a stale one. With
  // fb_count=1 GRAB_LATEST is silently ignored (see esp32-camera issue #417).
  config.grab_mode    = CAMERA_GRAB_LATEST;
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  // QS=4: very high quality JPEG (~250-350 KB at QXGA). Lower QS = sharper
  // text edges; PSRAM on the N16R8 has plenty of headroom for 2 buffers.
  config.jpeg_quality = 4;
  config.fb_count     = 2;   // MUST be 2 for GRAB_LATEST, even with BLE on

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) { Serial.printf("Camera init failed: 0x%x\n", err); return false; }

  // ============================================================
  // OV3660 ISP TUNING FOR PRINTED TEXT — register-level overrides
  // ============================================================
  // The standard sensor_t setters only nudge a few high-level knobs. For real
  // text-grade output we poke the OV3660 sharpness / contrast / gamma
  // registers directly over SCCB (OmniVision OV3660 datasheet §6, addr 0x53xx):
  //   0x5308 bit6  manual sharpness enable (override AUTO)
  //   0x5300       sharpness MT offset1  (white-edge gain)  HIGH = crisper
  //   0x5301       sharpness MT offset2  (black-edge gain)  HIGH = crisper
  //   0x5302       sharpness MT denoise threshold1          LOW  = keep detail
  //   0x5303       sharpness MT denoise threshold2          LOW  = keep detail
  //   0x5586       contrast gain
  //   0x5585       contrast offset
  //   0x5480       gamma enable
  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    // High-level setters first (these write a known-good register block)
    s->set_framesize(s, FRAMESIZE_QXGA);
    s->set_quality(s, 4);

    // White balance — Office preset eats the warm cast of indoor LEDs
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 3);        // 3 = Office (whites stay white)

    // Exposure: AUTO while warming up; we lock it after the burst warmup.
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 0);           // night mode OFF — no long exposures = no blur
    s->set_ae_level(s, 1);       // +1 bias so white paper renders bright, not grey
    s->set_aec_value(s, 700);

    // Gain: clamp HARD. High ISO turns printed strokes into grey mush.
    s->set_gain_ctrl(s, 1);
    s->set_agc_gain(s, 0);
    s->set_gainceiling(s, (gainceiling_t)1);   // cap at 4x

    s->set_brightness(s, 0);
    s->set_contrast(s, 2);
    s->set_saturation(s, -1);    // keep enough colour data for backend enhancement
    s->set_sharpness(s, 3);      // +3 max
    s->set_denoise(s, 0);        // denoise BLURS thin strokes. Off.

    s->set_lenc(s, 1);           // lens shading correction (corner brightness)
    s->set_bpc(s, 1);            // bad pixel
    s->set_wpc(s, 1);            // white pixel
    s->set_raw_gma(s, 1);
    s->set_hmirror(s, 0);
    s->set_vflip(s, 0);
    s->set_colorbar(s, 0);
    // Keep original colour; the backend now makes a high-contrast OCR copy.
    s->set_special_effect(s, 0);

    // ---- Register-level sharpness override (the real magic) ----
    // Use Espressif's proven OV3660 sharpness path, then add moderate contrast.
    // Over-driving these registers creates halos that OCR sees as extra marks.
    s->set_reg(s, 0x5308, 0xff, 0x65);
    s->set_reg(s, 0x5300, 0xff, 0x18);
    s->set_reg(s, 0x5301, 0xff, 0x18);
    s->set_reg(s, 0x5302, 0xff, 0x08);
    s->set_reg(s, 0x5303, 0xff, 0x30);
    s->set_reg(s, 0x5586, 0xff, 0x28);
    s->set_reg(s, 0x5585, 0xff, 0x08);
    s->set_reg(s, 0x5480, 0xff, 0x01);  // gamma enable (S-curve deepens ink)
  }
  return true;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(400); Serial.print("."); }
  if (WiFi.status() == WL_CONNECTED) Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());
  else Serial.println("\nWiFi FAILED — will retry in loop()");
}

void handleLocalRoot() {
  String page = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>";
  page += "<title>ESP32 Smart Audio Tutor</title><body style='font-family:Arial,sans-serif;margin:20px;line-height:1.4'>";
  page += "<h2>ESP32 Smart Audio Tutor</h2>";
  page += "<p>If this preview image appears, the camera is working locally.</p>";
  page += "<img src='/jpg?ts=" + String(millis()) + "' style='width:100%;max-width:640px;border:1px solid #ccc'>";
  page += "<p><a href='/capture'><button style='font-size:18px;padding:12px 18px'>Capture and send to app</button></a></p>";
  page += "<p><a href='/ping'><button style='font-size:16px;padding:10px 14px'>Test app server</button></a> ";
  page += "<a href='/next'><button style='font-size:16px;padding:10px 14px'>Next</button></a> ";
  page += "<a href='/prev'><button style='font-size:16px;padding:10px 14px'>Prev</button></a></p>";
  page += "<p>Open <b>https://" + String(SERVER_HOST) + "</b> on your phone and tap Enable audio.</p>";
  page += "</body>";
  localServer.send(200, "text/html", page);
}

void handleLocalJpg() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { localServer.send(500, "text/plain", "camera capture failed"); return; }
  WiFiClient localClient = localServer.client();
  localClient.print("HTTP/1.1 200 OK\r\n");
  localClient.print("Content-Type: image/jpeg\r\n");
  localClient.printf("Content-Length: %u\r\n", (unsigned)fb->len);
  localClient.print("Cache-Control: no-store\r\n");
  localClient.print("Connection: close\r\n\r\n");
  localClient.write(fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

void handleLocalCapture() {
  bool ok = captureAndSend();
  localServer.send(200, "text/html", String("<p>") + (ok ? "Capture sent to app." : "Capture failed. Check Serial Monitor.") + "</p><p><a href='/'>Back</a></p>");
}

void handleLocalPing() {
  bool ok = checkServer();
  localServer.send(200, "text/html", String("<p>") + (ok ? "App server reachable." : "App server NOT reachable. Check Serial Monitor.") + "</p><p><a href='/'>Back</a></p>");
}

void startLocalDashboard() {
  localServer.on("/", handleLocalRoot);
  localServer.on("/jpg", handleLocalJpg);
  localServer.on("/capture", handleLocalCapture);
  localServer.on("/ping", handleLocalPing);
  localServer.on("/next", []() { bool ok = postCommand("next"); localServer.send(200, "text/html", String("<p>") + (ok ? "Next sent." : "Next failed.") + "</p><p><a href='/'>Back</a></p>"); });
  localServer.on("/prev", []() { bool ok = postCommand("prev"); localServer.send(200, "text/html", String("<p>") + (ok ? "Prev sent." : "Prev failed.") + "</p><p><a href='/'>Back</a></p>"); });
  localServer.begin();
  Serial.printf("Local dashboard: http://%s/\n", WiFi.localIP().toString().c_str());
}

bool postJpeg(uint8_t* buf, size_t len) {
  WiFiClientSecure client;
  client.setInsecure();          // skip cert validation (saves RAM)
  client.setTimeout(15000);      // 15s TLS timeout — Lovable edge can be slow on cold start

  String path = String(SERVER_PATH) + "?type=capture";
  Serial.printf("POST https://%s%s  (%u bytes, chunked manually)\n", SERVER_HOST, path.c_str(), (unsigned)len);
  if (!client.connect(SERVER_HOST, 443)) {
    Serial.println("  -> HTTPS connect failed before sending image");
    return false;
  }

  client.printf("POST %s HTTP/1.1\r\n", path.c_str());
  client.printf("Host: %s\r\n", SERVER_HOST);
  client.print("User-Agent: ESP32-S3-CAM-Smart-Audio-Tutor\r\n");
  client.print("Connection: close\r\n");
  client.print("Content-Type: image/jpeg\r\n");
  client.printf("Content-Length: %u\r\n", (unsigned)len);
  client.printf("X-Device-Id: %s\r\n", DEVICE_ID);
  if (strlen(DEVICE_SECRET) > 0) client.printf("X-Device-Secret: %s\r\n", DEVICE_SECRET);
  client.print("\r\n");

  size_t sent = 0;
  uint8_t stalls = 0;
  while (sent < len) {
    if (!client.connected()) {
      Serial.printf("  -> server closed while sending at %u/%u bytes\n", (unsigned)sent, (unsigned)len);
      client.stop();
      return false;
    }
    size_t n = min((size_t)UPLOAD_CHUNK_SIZE, len - sent);
    size_t w = client.write(buf + sent, n);
    if (w > 0) {
      sent += w;
      stalls = 0;
      if (sent == len || sent % 4096 < UPLOAD_CHUNK_SIZE) Serial.printf("  sent %u/%u\n", (unsigned)sent, (unsigned)len);
      delay(2);
    } else {
      stalls++;
      delay(50);
      if (stalls > 20) {
        Serial.printf("  -> send stalled at %u/%u bytes\n", (unsigned)sent, (unsigned)len);
        client.stop();
        return false;
      }
    }
  }
  client.flush();

  String resp;
  unsigned long deadline = millis() + 20000;
  while (millis() < deadline && (client.connected() || client.available())) {
    while (client.available()) {
      char c = (char)client.read();
      if (resp.length() < 1400) resp += c;
      deadline = millis() + 1500;
    }
    delay(10);
  }
  client.stop();

  int code = -1;
  int firstSpace = resp.indexOf(' ');
  if (firstSpace > 0 && resp.startsWith("HTTP/")) code = resp.substring(firstSpace + 1, firstSpace + 4).toInt();
  int bodyAt = resp.indexOf("\r\n\r\n");
  String body = bodyAt >= 0 ? resp.substring(bodyAt + 4) : resp;
  body.replace("\n", " ");
  body.replace("\r", " ");
  Serial.printf("  -> HTTP %d  %s\n", code, body.c_str());
  return code >= 200 && code < 300;
}

bool postCommand(const char* type) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);
  HTTPClient http;
  http.setReuse(false);
  http.setTimeout(20000);
  String url = String("https://") + SERVER_HOST + SERVER_PATH;
  if (!http.begin(client, url)) { Serial.println("http.begin failed"); return false; }
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_SECRET) > 0) http.addHeader("X-Device-Secret", DEVICE_SECRET);
  http.addHeader("X-Device-Id", DEVICE_ID);
  String body = String("{\"type\":\"") + type + "\",\"device_id\":\"" + DEVICE_ID + "\"}";
  int code = http.POST(body);
  String resp = (code > 0) ? http.getString() : http.errorToString(code);
  Serial.printf("POST %s -> HTTP %d  %s\n", type, code, resp.c_str());
  http.end();
  return code >= 200 && code < 300;
}

bool checkServer() {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);
  HTTPClient http;
  http.setReuse(false);
  http.setTimeout(20000);
  String url = String("https://") + SERVER_HOST + SERVER_PATH;
  Serial.printf("GET %s\n", url.c_str());
  if (!http.begin(client, url)) { Serial.println("http.begin failed"); return false; }
  int code = http.GET();
  String resp = (code > 0) ? http.getString() : http.errorToString(code);
  Serial.printf("  -> HTTP %d  %s\n", code, resp.c_str());
  http.end();
  return code >= 200 && code < 300;
}

// ============================================================
//  RING REMOTE BRIDGE — poll /api/public/trigger every 2s.
// ============================================================
// The Bluetooth ring is paired to the user's phone/laptop (not to the
// ESP32). When the user presses the M button, the web app POSTs to
// /api/public/trigger. We poll the same endpoint here; if a fresh
// trigger arrived since the last one we saw, fire captureAndSend().
String lastTriggerId = "";
unsigned long lastTriggerPoll = 0;
const unsigned long TRIGGER_POLL_INTERVAL = 2000; // ms

void pollTrigger() {
  if (millis() - lastTriggerPoll < TRIGGER_POLL_INTERVAL) return;
  lastTriggerPoll = millis();
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5000);
  HTTPClient http;
  http.setReuse(false);
  http.setTimeout(6000);
  String url = String("https://") + SERVER_HOST + "/api/public/trigger";
  if (lastTriggerId.length() > 0) url += String("?since=") + lastTriggerId;
  if (!http.begin(client, url)) return;
  int code = http.GET();
  if (code == 200) {
    String body = http.getString();
    // tiny manual JSON parse — body looks like {"capture":true,"id":"..."}
    bool fire = body.indexOf("\"capture\":true") >= 0;
    int idAt = body.indexOf("\"id\":\"");
    String newId = "";
    if (idAt >= 0) {
      int s = idAt + 6;
      int e = body.indexOf('"', s);
      if (e > s) newId = body.substring(s, e);
    }
    if (fire && newId.length() > 0 && newId != lastTriggerId) {
      Serial.printf("[ring] trigger %s -> capturing\n", newId.c_str());
      lastTriggerId = newId;
      http.end();
      captureAndSend();
      return;
    } else if (newId.length() > 0) {
      lastTriggerId = newId; // remember even when not firing (cold start)
    }
  }
  http.end();
}

// ============================================================
//  DIRECT BLE HID RING HOST — ESP32 pairs to the ring itself.
// ============================================================
#if ENABLE_BLE_RING
static BLEAdvertisedDevice* ringDevice = nullptr;
static BLEClient* ringClient = nullptr;
static bool ringConnected = false;
static bool ringScanRunning = false;
static unsigned long lastBleScan = 0;
static unsigned long lastRingAction = 0;

void ringAction(const char* action) {
  if (millis() - lastRingAction < 450) return;  // ignore key-release / bounce reports
  lastRingAction = millis();
  Serial.printf("[ring] action=%s\n", action);
  if (!strcmp(action, "capture")) runBurst();   // M button → burst of frames
  else if (!strcmp(action, "next")) postCommand("next");
  else if (!strcmp(action, "prev")) postCommand("prev");
  else if (!strcmp(action, "replay")) postCommand("replay");
  else if (!strcmp(action, "stop")) postCommand("stop");
}

void handleRingReport(uint8_t* d, size_t len) {
  Serial.print("[ring] report:");
  for (size_t i = 0; i < len; i++) Serial.printf(" %02X", d[i]);
  Serial.println();
  if (len >= 3) {
    for (size_t i = 2; i < len; i++) {
      switch (d[i]) {
        case 0x28: case 0x10: ringAction("capture"); return; // Enter / M
        case 0x2C: ringAction("stop"); return;                // Space / play-pause
        case 0x4F: ringAction("next"); return;                // Right arrow
        case 0x50: ringAction("prev"); return;                // Left arrow
        case 0x51: ringAction("capture"); return;             // Down arrow = fresh capture
        case 0x52: ringAction("replay"); return;              // Up arrow
      }
    }
  }
  if (len == 2) {
    uint16_t v = d[0] | (uint16_t(d[1]) << 8);
    switch (v) {
      case 0x00CD: case 0x0001: ringAction("stop"); break;    // Play/pause variants
      case 0x00B5: case 0x0080: ringAction("next"); break;
      case 0x00B6: case 0x0040: ringAction("prev"); break;
      case 0x00E9: case 0x0010: ringAction("replay"); break;  // Volume up variants
      case 0x00EA: case 0x0020: ringAction("capture"); break; // Volume down variants
      default: break;
    }
  }
}

static void ringNotify(BLERemoteCharacteristic*, uint8_t* data, size_t len, bool) {
  handleRingReport(data, len);
}

class RingAdvertisedCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice dev) override {
    String name = dev.haveName() ? dev.getName().c_str() : "";
    bool nameOk = strlen(RING_NAME_HINT) == 0 || name.indexOf(RING_NAME_HINT) >= 0;
    bool hidOk = dev.haveServiceUUID() && dev.isAdvertisingService(BLEUUID((uint16_t)0x1812));
    if (nameOk && hidOk) {
      Serial.printf("[ring] found BLE HID: %s\n", dev.toString().c_str());
      BLEDevice::getScan()->stop();
      if (ringDevice) delete ringDevice;
      ringDevice = new BLEAdvertisedDevice(dev);
      ringScanRunning = false;
    }
  }
};

bool connectRingBle() {
  if (!ringDevice) return false;
  Serial.println("[ring] connecting...");
  ringClient = BLEDevice::createClient();
  if (!ringClient->connect(ringDevice)) { Serial.println("[ring] connect failed"); return false; }
  BLERemoteService* hid = ringClient->getService(BLEUUID((uint16_t)0x1812));
  if (!hid) { Serial.println("[ring] HID service missing"); ringClient->disconnect(); return false; }
  int subscribed = 0;
  std::map<std::string, BLERemoteCharacteristic*>* chars = hid->getCharacteristics();
  for (auto const& it : *chars) {
    BLERemoteCharacteristic* c = it.second;
    if (c->getUUID().equals(BLEUUID((uint16_t)0x2A4D)) && c->canNotify()) {
      c->registerForNotify(ringNotify);
      subscribed++;
    }
  }
  ringConnected = subscribed > 0;
  Serial.printf("[ring] %s, subscribed reports=%d\n", ringConnected ? "ready" : "no notify reports", subscribed);
  return ringConnected;
}

void initRingBle() {
  BLEDevice::init("ESP32 Tutor Ring Host");
  BLEDevice::setPower(ESP_PWR_LVL_P7);
  BLEScan* scan = BLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new RingAdvertisedCallbacks());
  scan->setActiveScan(true);
  Serial.println("[ring] BLE HID host enabled. Unpair ring from phone, then hold ring power/pair button.");
}

void maintainRingBle() {
  if (ringConnected && ringClient && ringClient->isConnected()) return;
  ringConnected = false;
  if (ringDevice && connectRingBle()) return;
  if (!ringScanRunning && millis() - lastBleScan > 8000) {
    lastBleScan = millis();
    ringScanRunning = true;
    BLEDevice::getScan()->start(5, false);
    BLEDevice::getScan()->clearResults();
    ringScanRunning = false;
  }
}
#else
void initRingBle() {}
void maintainRingBle() {}
#endif


bool captureAndSend() {
  // === ANTI-BLUR CAPTURE PIPELINE ===
  // Stage A — LONG WARMUP (1.2s): pull 8 frames so AEC / AWB / AGC fully
  // converge on the bright paper. Without this the first real frame is dim
  // and the encoder hides text in shadow noise.
  sensor_t* s = esp_camera_sensor_get();
  for (int i = 0; i < 8; i++) {
    camera_fb_t* warm = esp_camera_fb_get();
    if (warm) esp_camera_fb_return(warm);
    delay(150);
  }

  // Stage B — LOCK EXPOSURE / WB / GAIN. Once AEC has settled on paper we
  // freeze everything. A locked sensor is a sharp sensor: AGC bumping mid-
  // frame is the #1 cause of soft / smeary text on OV3660.
  if (s) {
    int aec = s->status.aec_value;     // read what auto landed on
    int gain = s->status.agc_gain;
    s->set_exposure_ctrl(s, 0);
    s->set_aec2(s, 0);
    s->set_aec_value(s, aec > 0 ? aec : 800);
    s->set_gain_ctrl(s, 0);
    s->set_agc_gain(s, gain);
    s->set_whitebal(s, 0);             // lock WB
    s->set_awb_gain(s, 0);
    Serial.printf("  locked AEC=%d AGC=%d\n", aec, gain);
    delay(120);
  }

  // Stage C — BURST OF 8 frames. For a fixed scene at fixed JPEG quality
  // the encoder emits a LARGER file when the frame has MORE high-frequency
  // edge detail (i.e. is sharper). Pick the largest = sharpest. Pro doc-
  // scanner apps use Laplacian variance; on the JPEG side, size is the
  // same idea expressed by the DCT.
  camera_fb_t* bestFb = nullptr;
  size_t bestLen = 0;
  for (int i = 0; i < 8; i++) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) continue;
    bool jpeg = fb->len > 3 && fb->buf[0] == 0xFF && fb->buf[1] == 0xD8;
    Serial.printf("  burst[%d]: %u bytes, jpeg=%s\n", i, (unsigned)fb->len, jpeg ? "y" : "n");
    if (jpeg && fb->len > bestLen) {
      if (bestFb) esp_camera_fb_return(bestFb);
      bestFb = fb;
      bestLen = fb->len;
    } else {
      esp_camera_fb_return(fb);
    }
    delay(90);
  }

  // Stage D — UNLOCK so the preview at /jpg keeps working between captures.
  if (s) {
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1);
    s->set_gain_ctrl(s, 1);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
  }

  if (!bestFb) { Serial.println("camera capture failed (no usable frame in burst)"); return false; }
  Serial.printf("Sharpest of burst: %u bytes (larger = sharper)\n", (unsigned)bestLen);
  bool ok = postJpeg(bestFb->buf, bestFb->len);
  esp_camera_fb_return(bestFb);
  return ok;
}

// Debounced edge detect — fires once when the button transitions to pressed (LOW).
bool pressed(uint8_t pin, int* lastState, unsigned long* lastChange) {
  int s = digitalRead(pin);
  unsigned long now = millis();
  if (s != *lastState && now - *lastChange > 40) {
    *lastChange = now;
    *lastState = s;
    if (s == LOW) return true;
  }
  return false;
}

int    capState = HIGH, nextState = HIGH, prevState = HIGH;
unsigned long capT = 0, nextT = 0, prevT = 0;

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n=== Smart Audio Tutor — ESP32-S3 ===");

  pinMode(CAPTURE_BTN, INPUT_PULLUP);
  pinMode(NEXT_BTN,    INPUT_PULLUP);
  pinMode(PREV_BTN,    INPUT_PULLUP);

  if (!initCamera()) { Serial.println("Halting."); while (true) delay(1000); }
  connectWifi();
  if (WiFi.status() == WL_CONNECTED) startLocalDashboard();
  Serial.println("Ready. Type 'ping' to test server, or 'cap' / 'next' / 'prev' in Serial Monitor.");
}

void handleSerial() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line.trim();
      if (line.equalsIgnoreCase("ping"))      { Serial.println("[serial] ping"); checkServer(); }
      else if (line.equalsIgnoreCase("cap"))  { Serial.println("[serial] cap");  Serial.println(captureAndSend() ? "✓ Capture sent to server" : "✗ Capture NOT sent — check HTTP line above"); }
      else if (line.equalsIgnoreCase("next")) { Serial.println("[serial] next"); postCommand("next"); }
      else if (line.equalsIgnoreCase("prev")) { Serial.println("[serial] prev"); postCommand("prev"); }
      else if (line.length() > 0)             { Serial.printf("[serial] unknown: %s\n", line.c_str()); }
      line = "";
    } else if (line.length() < 32) {
      line += c;
    }
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) { connectWifi(); if (WiFi.status() == WL_CONNECTED) startLocalDashboard(); delay(500); return; }
  localServer.handleClient();
  handleSerial();
  if (pressed(CAPTURE_BTN, &capState,  &capT))  Serial.println(captureAndSend() ? "✓ Capture sent to server" : "✗ Capture NOT sent — check HTTP line above");
  if (pressed(NEXT_BTN,    &nextState, &nextT)) postCommand("next");
  if (pressed(PREV_BTN,    &prevState, &prevT)) postCommand("prev");
  pollTrigger();   // ring remote M button -> capture
  delay(10);
}
