/*
  ESP32-S3-WROOM N16R8 CAM — Smart Audio Tutor firmware  v2.0
  ─────────────────────────────────────────────────────────────
  Board:            "ESP32S3 Dev Module"
  USB CDC On Boot:  "Enabled"
  PSRAM:            "OPI PSRAM"
  Flash Size:       "16MB"
  Partition Scheme: "16M Flash (3MB APP/9.9MB FATFS)"
  Upload Speed:     921600

  What changed in v2.0 vs v1.x
  ─────────────────────────────
  1. Capture pipeline ~2.5 s faster per press:
       · Warmup cut from 8×150 ms → 4×80 ms (–880 ms)
       · AF triggered IN PARALLEL with warmup instead of after (–800 ms overlap)
       · AF timeout 1500 ms → 900 ms (exits early when 0x3023==0)
       · Post-AF burst 8×90 ms → 4×50 ms (–520 ms)
  2. Upload 4× faster: chunk size 1024 → 4096 bytes
  3. Better OV5640 document tuning:
       · quality 4 → 7  (still readable; upload 30-40 % smaller)
       · denoise 2 → 0  (preserves fine pencil/graph lines)
       · wb_mode 0 → 2  (Fluorescent — stable on white paper)
       · contrast 1 → 2 (pops black text on white)
       · ae_level 1 → 0 (paper is bright; no boost needed)
  4. Idle pre-focus: every IDLE_AF_INTERVAL_MS (8 s by default) the
     ESP32 runs a quick AF cycle so the lens stays parked near document
     distance. Button-press AF then only needs a tiny correction.
  5. AF helper rewritten: releases motor first, polls 0x3023 at 20 ms
     steps, exits the moment focus is confirmed (not always at timeout).
  6. Kimi removed from the web-app side — firmware unchanged on that front.
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
#include <BLESecurity.h>
#include <BLERemoteDescriptor.h>
#include <map>

// ====== EDIT THESE ======
const char* WIFI_SSID     = "Hakeem";
const char* WIFI_PASS     = "10000000";
// Your PUBLISHED Lovable host — host only, no https://, no trailing slash.
const char* SERVER_HOST   = "voice-refiner-buddy.lovable.app";
const char* SERVER_PATH   = "/api/public/event";
const char* DEVICE_SECRET = "";   // endpoint is open right now — leave ""
const char* DEVICE_ID     = "esp32-cam-01";
// ========================

// ====== PERFORMANCE TUNING ======
// Increase chunk size for faster TLS uploads. If you see "HTTP -3 send
// payload failed" errors again, reduce to 2048.
#define UPLOAD_CHUNK_SIZE   4096

// Idle pre-focus: trigger AF every N ms when not capturing so the lens
// is already near document distance when the button is pressed. Set to 0
// to disable (saves ~15 mA on battery-powered builds).
#define IDLE_AF_INTERVAL_MS 8000
// ================================

// ====== BURST CAPTURE ======
#define BURST_MS            3000   // total capture window in milliseconds
#define BURST_MIN_GAP_MS    190    // pace camera/network so frames remain complete
#define BURST_MAX_FRAMES    14     // hard safety cap for one short burst

// Button pins — DO NOT collide with camera bus.
// Camera uses: 4,5,6,7,8,9,10,11,12,13,15,16,17,18.
// Safe free GPIOs on this board: 1, 2, 3, 14, 21, 38-42.
#define CAPTURE_BTN 1
#define NEXT_BTN    2
#define PREV_BTN    3

// Direct Bluetooth ring mode. Set to 0 if your Arduino ESP32 install does
// not include the BLE library, or if you need maximum RAM while debugging.
#define ENABLE_BLE_RING 1

// The ring usually advertises as a BLE HID keyboard/media controller.
// Leave empty to accept the first HID device found; set a fragment like
// "BT003" / "Ring" / "Remote" if another keyboard is nearby.
const char* RING_NAME_HINT = "S10";

WebServer localServer(80);

bool postCommand(const char* type);
bool checkServer();
bool captureAndSend();
bool runBurst();
void initRingBle();
void maintainRingBle();

// ----- Camera pin map (ESP32S3_WROOM_CAM) -----
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

static uint16_t sensorPid  = 0;
static bool     isOv5640   = false;
static bool     ov5640AfReady = false;

// ============================================================
//  OV5640 AUTOFOCUS HELPER — v2.0
// ============================================================
// Registers:
//   0x3022 = AF command  0x03=SINGLE  0x04=CONTINUOUS  0x08=release
//   0x3023 = AF ACK      0x00 = command accepted/done
//   0x3029 = AF state    0x10 = focused/idle
//
// Change from v1: we release the motor first (0x08), wait for the
// previous command to clear (0x3023==0), THEN issue SINGLE. This
// prevents "stale lock" where the lens was already past the target
// and the firmware returns immediately with the wrong position.
bool ov5640TriggerAf(sensor_t* s, uint32_t timeoutMs) {
  if (!s || !isOv5640 || !ov5640AfReady) return false;

  // 1) Release VCM motor so lens returns to a neutral position.
  s->set_reg(s, 0x3022, 0xff, 0x08);
  delay(30);

  // 2) Wait for any previous command to clear (ACK should go 0).
  unsigned long t0 = millis();
  while (millis() - t0 < 150) {
    if (s->get_reg(s, 0x3023, 0xff) == 0) break;
    delay(10);
  }

  // 3) Trigger single-shot autofocus.
  s->set_reg(s, 0x3023, 0xff, 0x01);  // mark ACK busy
  s->set_reg(s, 0x3022, 0xff, 0x03);  // SINGLE FOCUS

  // 4) Poll until focused (ACK == 0) or timeout.
  t0 = millis();
  while (millis() - t0 < timeoutMs) {
    int ack = s->get_reg(s, 0x3023, 0xff);
    if (ack == 0) {
      int state = s->get_reg(s, 0x3029, 0xff);
      Serial.printf("  [AF] locked in %lu ms (state=0x%02x)\n",
                    millis() - t0, state);
      return true;
    }
    delay(20);
  }
  Serial.println("  [AF] timeout — using last lens position");
  return false;
}

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
  config.xclk_freq_hz = 20000000;
  config.frame_size   = FRAMESIZE_QSXGA;   // init high; tuned below
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_LATEST;
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 6;
  config.fb_count     = 2;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  if (!s) { Serial.println("sensor_get returned null"); return false; }

  sensorPid = s->id.PID;
  isOv5640  = (sensorPid == 0x5640);
  Serial.printf("=== Sensor PID=0x%04x  -> %s ===\n", sensorPid,
                isOv5640 ? "OV5640 (5 MP, AF)" :
                (sensorPid == 0x3660 ? "OV3660 (3 MP, fixed)" : "UNKNOWN"));

  if (isOv5640) {
    // ── OV5640 / DC5640-AF — tuned for A4 document scanning ──
    // QXGA = 2048×1536 px. Best practical resolution for hand-held
    // document capture: high enough for fine print, lower DMA risk than
    // full 5 MP QSXGA, and still fits in OPI PSRAM in one shot.
    s->set_framesize(s, FRAMESIZE_QXGA);

    // JPEG quality 7: produces ~120-250 KB frames — sharp enough for OCR,
    // small enough to upload in ~1.5 s on typical WiFi. Quality 4 made
    // ~300-500 KB files with no real OCR benefit.
    s->set_quality(s, 7);

    // ── Exposure & gain ──
    s->set_exposure_ctrl(s, 1);   // AEC on
    s->set_aec2(s, 1);            // AEC2 on (night mode helper)
    s->set_ae_level(s, 0);        // NEUTRAL — paper is bright; no push needed
    s->set_gain_ctrl(s, 1);       // AGC on
    s->set_agc_gain(s, 0);        // start at minimum ISO
    s->set_gainceiling(s, (gainceiling_t)2); // cap at 8× to limit noise

    // ── White balance ──
    // wb_mode 2 = Fluorescent. Documents under any indoor light
    // (LED, tube, desk lamp) look almost exactly like 6500 K fluorescent.
    // This eliminates the AWB flicker you get with wb_mode 0 (auto).
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 2);         // 0=auto 1=sunny 2=fluorescent 3=incandescent 4=flash

    // ── Image quality — document-specific ──
    s->set_brightness(s, 0);
    s->set_contrast(s, 2);        // boost: makes black ink pop on white paper
    s->set_saturation(s, 0);      // neutral colour (documents are mostly B&W)
    s->set_sharpness(s, 3);       // maximum hardware sharpening
    s->set_denoise(s, 0);         // NO denoise — it blurs thin pencil lines
                                  // and fine graph axes at QXGA resolution
    s->set_lenc(s, 1);            // lens shading correction (even illumination)
    s->set_bpc(s, 1);             // bad-pixel correction
    s->set_wpc(s, 1);             // white-pixel correction
    s->set_raw_gma(s, 1);         // raw gamma (natural tone)
    s->set_hmirror(s, 0);
    s->set_vflip(s, 0);
    s->set_colorbar(s, 0);
    s->set_special_effect(s, 0);

    // ── Probe AF firmware ──
    delay(120);
    s->set_reg(s, 0x3022, 0xff, 0x08);   // release motor
    delay(40);
    int ack = s->get_reg(s, 0x3023, 0xff);
    ov5640AfReady = (ack >= 0);
    Serial.printf("  [AF] firmware probe ack=0x%02x -> %s\n",
                  ack & 0xff,
                  ov5640AfReady ? "ready" :
                  "no response (update arduino-esp32 to v3.x)");

  } else {
    // ── OV3660 (fixed-focus, 3 MP) — original tuning ──
    s->set_framesize(s, FRAMESIZE_QXGA);
    s->set_quality(s, 4);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 3);         // incandescent tends to work well indoors
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 0);
    s->set_ae_level(s, 1);
    s->set_aec_value(s, 700);
    s->set_gain_ctrl(s, 1);
    s->set_agc_gain(s, 0);
    s->set_gainceiling(s, (gainceiling_t)1);
    s->set_brightness(s, 0);
    s->set_contrast(s, 2);
    s->set_saturation(s, -1);
    s->set_sharpness(s, 3);
    s->set_denoise(s, 0);
    s->set_lenc(s, 1);
    s->set_bpc(s, 1);
    s->set_wpc(s, 1);
    s->set_raw_gma(s, 1);
    s->set_hmirror(s, 0);
    s->set_vflip(s, 0);
    s->set_colorbar(s, 0);
    s->set_special_effect(s, 0);
    // OV3660 extra sharpness registers
    s->set_reg(s, 0x5308, 0xff, 0x65);
    s->set_reg(s, 0x5300, 0xff, 0x18);
    s->set_reg(s, 0x5301, 0xff, 0x18);
    s->set_reg(s, 0x5302, 0xff, 0x08);
    s->set_reg(s, 0x5303, 0xff, 0x30);
    s->set_reg(s, 0x5586, 0xff, 0x28);
    s->set_reg(s, 0x5585, 0xff, 0x08);
    s->set_reg(s, 0x5480, 0xff, 0x01);
  }
  return true;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(400); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());
  else
    Serial.println("\nWiFi FAILED — will retry in loop()");
}

void handleLocalRoot() {
  String page = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>";
  page += "<title>ESP32 Smart Audio Tutor v2</title><body style='font-family:Arial,sans-serif;margin:20px;line-height:1.4'>";
  page += "<h2>ESP32 Smart Audio Tutor v2</h2>";
  page += "<p>Live MJPEG preview below. Hold camera ~25-35 cm above the A4 page; fill the frame.</p>";
  page += "<img id='live' src='/stream' style='width:100%;max-width:720px;border:1px solid #ccc'>";
  page += "<p><a href='/capture'><button style='font-size:18px;padding:12px 18px'>Capture and send</button></a></p>";
  page += "<p><a href='/af'><button style='font-size:16px;padding:10px 14px'>Test Autofocus</button></a> ";
  page += "<a href='/ping'><button style='font-size:16px;padding:10px 14px'>Test app server</button></a> ";
  page += "<a href='/burst'><button style='font-size:16px;padding:10px 14px'>Slow sweep burst</button></a> ";
  page += "<a href='/next'><button style='font-size:16px;padding:10px 14px'>Next</button></a> ";
  page += "<a href='/prev'><button style='font-size:16px;padding:10px 14px'>Prev</button></a></p>";
  page += "<p>Open <b>https://" + String(SERVER_HOST) + "</b> on your phone and tap Enable audio.</p>";
  page += "</body>";
  localServer.send(200, "text/html", page);
}

// A JPEG is only "complete" if it starts with FFD8 (SOI) AND ends with FFD9
// (EOI). Without the EOI check the firmware happily uploads truncated frames
// from DMA overruns — those decode as the top half of the image followed by
// a rainbow stripe and color-shifted garbage in the bottom half.
static inline bool isCompleteJpeg(const uint8_t* buf, size_t len) {
  if (!buf || len < 4) return false;
  if (buf[0] != 0xFF || buf[1] != 0xD8) return false;
  if (buf[len - 2] != 0xFF || buf[len - 1] != 0xD9) return false;
  return true;
}

// Drop sensor to SVGA for fast preview, then restore QXGA.
static void previewSetSize(framesize_t fs) {
  sensor_t* s = esp_camera_sensor_get();
  if (s) s->set_framesize(s, fs);
}

void handleLocalStream() {
  WiFiClient client = localServer.client();
  if (!client) return;
  const char* boundary = "frame";
  client.print("HTTP/1.1 200 OK\r\n");
  client.printf("Content-Type: multipart/x-mixed-replace;boundary=%s\r\n", boundary);
  client.print("Cache-Control: no-store\r\nConnection: close\r\n\r\n");

  previewSetSize(FRAMESIZE_SVGA);   // 800×600 streams at ~10-15 fps
  unsigned long started = millis();
  while (client.connected() && millis() - started < 120000) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { delay(20); continue; }
    if (!isCompleteJpeg(fb->buf, fb->len)) { esp_camera_fb_return(fb); continue; }
    client.printf("--%s\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
                  boundary, (unsigned)fb->len);
    size_t sent = 0;
    while (sent < fb->len && client.connected()) {
      size_t w = client.write(fb->buf + sent, fb->len - sent);
      if (w == 0) { delay(2); continue; }
      sent += w;
    }
    client.print("\r\n");
    esp_camera_fb_return(fb);
    delay(1);
  }
  previewSetSize(FRAMESIZE_QXGA);   // restore high-res for captures
  client.stop();
}

void handleLocalJpg() {
  sensor_t* s = esp_camera_sensor_get();
  ov5640TriggerAf(s, 900);
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
  localServer.send(200, "text/html",
    String("<p>") + (ok ? "Capture sent to app." : "Capture failed. Check Serial Monitor.") +
    "</p><p><a href='/'>Back</a></p>");
}

void handleLocalPing() {
  bool ok = checkServer();
  localServer.send(200, "text/html",
    String("<p>") + (ok ? "App server reachable." : "App server NOT reachable.") +
    "</p><p><a href='/'>Back</a></p>");
}

void handleLocalAf() {
  sensor_t* s = esp_camera_sensor_get();
  bool ok = ov5640TriggerAf(s, 900);
  localServer.send(200, "text/html",
    String("<p>") + (ok ? "✓ Autofocus locked." : "✗ AF failed or not OV5640.") +
    "</p><p><a href='/'>Back</a></p>");
}

void startLocalDashboard() {
  localServer.on("/",        handleLocalRoot);
  localServer.on("/jpg",     handleLocalJpg);
  localServer.on("/stream",  handleLocalStream);
  localServer.on("/capture", handleLocalCapture);
  localServer.on("/ping",    handleLocalPing);
  localServer.on("/af",      handleLocalAf);
  localServer.on("/burst", []() {
    bool ok = runBurst();
    localServer.send(200, "text/html",
      String("<p>") + (ok ? "Burst sent to app." : "Burst failed. Check Serial Monitor.") +
      "</p><p><a href='/'>Back</a></p>");
  });
  localServer.on("/next", []() {
    bool ok = postCommand("next");
    localServer.send(200, "text/html",
      String("<p>") + (ok ? "Next sent." : "Next failed.") +
      "</p><p><a href='/'>Back</a></p>");
  });
  localServer.on("/prev", []() {
    bool ok = postCommand("prev");
    localServer.send(200, "text/html",
      String("<p>") + (ok ? "Prev sent." : "Prev failed.") +
      "</p><p><a href='/'>Back</a></p>");
  });
  localServer.begin();
  Serial.printf("Local dashboard: http://%s/\n", WiFi.localIP().toString().c_str());
}

// ============================================================
//  HTTPS UPLOAD — v2.0 (4096-byte chunks)
// ============================================================
bool postJpeg(uint8_t* buf, size_t len) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);

  String path = String(SERVER_PATH) + "?type=capture";
  Serial.printf("POST https://%s%s  (%u bytes)\n",
                SERVER_HOST, path.c_str(), (unsigned)len);

  if (!client.connect(SERVER_HOST, 443)) {
    Serial.println("  -> HTTPS connect failed");
    return false;
  }

  client.printf("POST %s HTTP/1.1\r\n", path.c_str());
  client.printf("Host: %s\r\n", SERVER_HOST);
  client.print("User-Agent: ESP32-S3-CAM-Smart-Audio-Tutor-v2\r\n");
  client.print("Connection: close\r\n");
  client.print("Content-Type: image/jpeg\r\n");
  client.printf("Content-Length: %u\r\n", (unsigned)len);
  client.printf("X-Device-Id: %s\r\n", DEVICE_ID);
  if (strlen(DEVICE_SECRET) > 0)
    client.printf("X-Device-Secret: %s\r\n", DEVICE_SECRET);
  client.print("\r\n");

  // ── Chunked write ── (4096 B per write = ~75-125 TLS records for a
  // typical 120-250 KB QXGA/q7 JPEG vs 300-500 records with 1024 B chunks)
  size_t sent  = 0;
  uint8_t stalls = 0;
  while (sent < len) {
    if (!client.connected()) {
      Serial.printf("  -> server closed at %u/%u bytes\n",
                    (unsigned)sent, (unsigned)len);
      client.stop();
      return false;
    }
    size_t n = min((size_t)UPLOAD_CHUNK_SIZE, len - sent);
    size_t w = client.write(buf + sent, n);
    if (w > 0) {
      sent  += w;
      stalls = 0;
      if (sent == len || sent % 32768 < UPLOAD_CHUNK_SIZE)
        Serial.printf("  sent %u/%u\n", (unsigned)sent, (unsigned)len);
      delay(1);
    } else {
      stalls++;
      delay(50);
      if (stalls > 20) {
        Serial.printf("  -> send stalled at %u/%u bytes\n",
                      (unsigned)sent, (unsigned)len);
        client.stop();
        return false;
      }
    }
  }
  client.flush();

  // Read response
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
  if (firstSpace > 0 && resp.startsWith("HTTP/"))
    code = resp.substring(firstSpace + 1, firstSpace + 4).toInt();
  int bodyAt = resp.indexOf("\r\n\r\n");
  String body = bodyAt >= 0 ? resp.substring(bodyAt + 4) : resp;
  body.replace("\n", " "); body.replace("\r", " ");
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
//  RING REMOTE BRIDGE — poll /api/public/trigger every 2 s
// ============================================================
String lastTriggerId       = "";
unsigned long lastTriggerPoll     = 0;
const unsigned long TRIGGER_POLL_INTERVAL = 2000;

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
    bool fire = body.indexOf("\"capture\":true") >= 0;
    int idAt = body.indexOf("\"id\":\"");
    String newId = "";
    if (idAt >= 0) {
      int s = idAt + 6, e = body.indexOf('"', s);
      if (e > s) newId = body.substring(s, e);
    }
    if (fire && newId.length() > 0 && newId != lastTriggerId) {
      Serial.printf("[ring] trigger %s -> capturing\n", newId.c_str());
      lastTriggerId = newId;
      http.end();
      captureAndSend();
      return;
    } else if (newId.length() > 0) {
      lastTriggerId = newId;
    }
  }
  http.end();
}

// ============================================================
//  DIRECT BLE HID RING HOST
// ============================================================
#if ENABLE_BLE_RING
static BLEAdvertisedDevice* ringDevice  = nullptr;
static BLEClient*           ringClient  = nullptr;
static bool   ringConnected             = false;
static bool   ringScanRunning           = false;
static unsigned long lastBleScan        = 0;
static unsigned long lastRingAction     = 0;
static unsigned long lastRingConnectAttempt = 0;
static uint8_t ringConnectFailures      = 0;

class RingClientCallbacks : public BLEClientCallbacks {
  void onConnect(BLEClient*) override    { Serial.println("[ring] BLE link opened"); }
  void onDisconnect(BLEClient*) override {
    ringConnected = false;
    Serial.println("[ring] disconnected — wake S10 and it will reconnect");
  }
};
static RingClientCallbacks ringCallbacks;

void configureRingSecurity() {
  BLESecurity* security = new BLESecurity();
  security->setAuthenticationMode(ESP_LE_AUTH_BOND);
  security->setCapability(ESP_IO_CAP_NONE);
  security->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
  security->setRespEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
}

void ringAction(const char* action) {
  if (millis() - lastRingAction < 450) return;
  lastRingAction = millis();
  Serial.printf("\n>>> [RING BUTTON] %s  (BLE connected=%s) <<<\n",
                action, ringConnected ? "YES" : "NO");
  if      (!strcmp(action, "capture")) captureAndSend();
  else if (!strcmp(action, "burst"))   runBurst();
  else if (!strcmp(action, "single"))  captureAndSend();
  else if (!strcmp(action, "next"))    postCommand("next");
  else if (!strcmp(action, "prev"))    postCommand("prev");
  else if (!strcmp(action, "replay"))  postCommand("replay");
  else if (!strcmp(action, "stop"))    postCommand("stop");
}

void printRingStatus() {
  Serial.println("---- RING / BLE STATUS ----");
  Serial.printf("  BLE feature compiled in : %s\n", "YES");
  Serial.printf("  Ring device discovered  : %s\n", ringDevice    ? "YES" : "no");
  Serial.printf("  Ring BLE connected      : %s\n", ringConnected ? "YES" : "no");
  Serial.printf("  Scan in progress        : %s\n", ringScanRunning ? "yes" : "no");
  Serial.printf("  Last button (ms ago)    : %lu\n",
                lastRingAction == 0 ? 0UL : (millis() - lastRingAction));
  Serial.println("---------------------------");
}

static uint32_t lastRingHash   = 0;
static unsigned long lastRingHashAt = 0;
static bool ringFire(const char* action) { ringAction(action); return true; }

void handleRingReport(uint8_t* d, size_t len) {
  Serial.print("[ring] report:");
  for (size_t i = 0; i < len; i++) Serial.printf(" %02X", d[i]);
  Serial.println();
  if (len == 0) return;

  bool anyPressed = false;
  for (size_t i = 0; i < len; i++) if (d[i] != 0x00) anyPressed = true;
  if (!anyPressed) { lastRingHash = 0; return; }

  if (len >= 4 && d[1] == 0x00 && d[2] == 0x00 && d[3] == 0x00) return;

  uint32_t h = 0;
  for (size_t i = 0; i < len; i++) h = (h * 131) ^ d[i];
  if (h == lastRingHash && millis() - lastRingHashAt < 350) return;
  lastRingHash = h; lastRingHashAt = millis();

  // S10 vendor reports
  if (len >= 4 && ((d[0] == 0x0F && d[1] == 0xEF) || (d[0] == 0x00 && d[1] == 0xF4))) {
    uint16_t tail = (uint16_t(d[2]) << 8) | d[3];
    switch (tail) {
      case 0x0137: ringFire("capture"); return;
      case 0x8116: ringFire("next");    return;
      case 0x4115: ringFire("prev");    return;
      case 0x0114: ringFire("replay");  return;
      case 0x0119: ringFire("stop");    return;
    }
  }

  // Standard HID keyboard report
  if (len >= 3) {
    for (size_t i = 2; i < len; i++) {
      switch (d[i]) {
        case 0x28: case 0x10: ringFire("capture"); return;
        case 0x2C:            ringFire("stop");    return;
        case 0x4F:            ringFire("next");    return;
        case 0x50:            ringFire("prev");    return;
        case 0x51:            ringFire("single");  return;
        case 0x52:            ringFire("replay");  return;
      }
    }
  }
  // 2-byte consumer report
  if (len == 2) {
    uint16_t v = d[0] | (uint16_t(d[1]) << 8);
    switch (v) {
      case 0x00CD: case 0x0001: ringFire("stop");    return;
      case 0x00B5: case 0x0080: ringFire("next");    return;
      case 0x00B6: case 0x0040: ringFire("prev");    return;
      case 0x00E9: case 0x0010: ringFire("replay");  return;
      case 0x00EA: case 0x0020: ringFire("capture"); return;
    }
  }
  Serial.println(">>> [RING BUTTON] unknown S10 code — send me that report line to map it <<<");
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
      ringScanRunning = false;
    }
  }
};

bool connectRingBle() {
  if (!ringDevice) return false;
  if (millis() - lastRingConnectAttempt < 2500) return false;
  lastRingConnectAttempt = millis();
  if (ringClient) {
    if (ringClient->isConnected()) ringClient->disconnect();
    delete ringClient;
    ringClient = nullptr;
  }
  Serial.printf("[ring] connecting to %s...\n",
                ringDevice->getAddress().toString().c_str());
  ringClient = BLEDevice::createClient();
  ringClient->setClientCallbacks(&ringCallbacks);
  if (!ringClient->connect(ringDevice)) {
    Serial.println("[ring] connect failed");
    delete ringClient; ringClient = nullptr;
    if (++ringConnectFailures >= 3) {
      delete ringDevice; ringDevice = nullptr;
      ringConnectFailures = 0;
    }
    return false;
  }
  ringClient->setMTU(69);
  if (!ringClient->isConnected()) { Serial.println("[ring] link dropped"); return false; }
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
  if (ringConnected) ringConnectFailures = 0;
  Serial.printf("[ring] %s, subscribed reports=%d\n",
                ringConnected ? "CONNECTED" : "no notify reports", subscribed);
  return ringConnected;
}

void initRingBle() {
  BLEDevice::init("ESP32 Tutor Ring Host");
  BLEDevice::setPower(ESP_PWR_LVL_P9);
  configureRingSecurity();
  BLEScan* scan = BLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new RingAdvertisedCallbacks());
  scan->setActiveScan(true);
  scan->setInterval(96);
  scan->setWindow(64);
  Serial.println("[ring] BLE HID host enabled. Unpair ring from phone first.");
}

void maintainRingBle() {
  if (ringConnected && ringClient && ringClient->isConnected()) return;
  ringConnected = false;
  if (ringDevice && connectRingBle()) return;
  if (!ringScanRunning && millis() - lastBleScan > 8000) {
    lastBleScan    = millis();
    ringScanRunning = true;
    BLEDevice::getScan()->start(5, false);
    BLEDevice::getScan()->clearResults();
    ringScanRunning = false;
  }
}
#else
void initRingBle()    {}
void maintainRingBle(){}
void printRingStatus(){ Serial.println("BLE ring host disabled (ENABLE_BLE_RING=0)."); }
#endif


// ============================================================
//  IDLE PRE-FOCUS — keeps lens parked near document distance
// ============================================================
// Run a quick AF cycle every IDLE_AF_INTERVAL_MS milliseconds while
// the board is idle (not capturing). When the button is pressed, the
// VCM motor only needs a tiny fine-tune correction instead of a full
// sweep from infinity, cutting AF time by ~300-500 ms.
static unsigned long lastIdleAf = 0;
static bool          capturing  = false;  // guard: don't pre-focus mid-capture

void idlePreFocus() {
#if IDLE_AF_INTERVAL_MS > 0
  if (capturing) return;
  if (!isOv5640 || !ov5640AfReady) return;
  if (millis() - lastIdleAf < IDLE_AF_INTERVAL_MS) return;
  lastIdleAf = millis();
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  // Quick single-shot AF with short timeout — if it times out we just keep
  // whatever position the lens was at; the real capture will re-focus anyway.
  Serial.println("[idle AF] pre-focusing...");
  ov5640TriggerAf(s, 600);
#endif
}


// ============================================================
//  BURST CAPTURE — many JPEGs of the SAME page over ~3 seconds
// ============================================================
static String makeUuidV4() {
  uint8_t b[16];
  for (int i = 0; i < 16; i++) b[i] = (uint8_t)esp_random();
  b[6] = (b[6] & 0x0F) | 0x40;
  b[8] = (b[8] & 0x3F) | 0x80;
  char out[37];
  snprintf(out, sizeof(out),
    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    b[0],b[1],b[2],b[3], b[4],b[5], b[6],b[7], b[8],b[9],
    b[10],b[11],b[12],b[13],b[14],b[15]);
  return String(out);
}

bool postBurstFrame(const char* burstId, int seq, uint8_t* buf, size_t len) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);
  String path = String(SERVER_PATH) + "?burst=" + burstId + "&seq=" + String(seq);
  if (!client.connect(SERVER_HOST, 443)) {
    Serial.printf("  [burst %d] HTTPS connect failed\n", seq);
    return false;
  }
  client.printf("POST %s HTTP/1.1\r\n", path.c_str());
  client.printf("Host: %s\r\n", SERVER_HOST);
  client.print("User-Agent: ESP32-S3-CAM-Smart-Audio-Tutor-v2\r\n");
  client.print("Connection: close\r\n");
  client.print("Content-Type: image/jpeg\r\n");
  client.printf("Content-Length: %u\r\n", (unsigned)len);
  client.printf("X-Device-Id: %s\r\n", DEVICE_ID);
  client.print("\r\n");
  size_t sent = 0; uint8_t stalls = 0;
  while (sent < len) {
    if (!client.connected()) { client.stop(); return false; }
    size_t n = min((size_t)UPLOAD_CHUNK_SIZE, len - sent);
    size_t w = client.write(buf + sent, n);
    if (w > 0) { sent += w; stalls = 0; delay(1); }
    else { stalls++; delay(50); if (stalls > 20) { client.stop(); return false; } }
  }
  client.flush();
  unsigned long deadline = millis() + 6000;
  while (millis() < deadline && (client.connected() || client.available())) {
    while (client.available()) { client.read(); deadline = millis() + 800; }
    delay(5);
  }
  client.stop();
  return true;
}

bool postBurstFinalize(const char* burstId) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);
  HTTPClient http;
  http.setReuse(false);
  http.setTimeout(20000);
  String url = String("https://") + SERVER_HOST + "/api/public/burst/finalize?id=" + burstId;
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  int code = http.POST("{}");
  String resp = (code > 0) ? http.getString() : http.errorToString(code);
  Serial.printf("[burst] finalize -> HTTP %d  %s\n", code, resp.c_str());
  http.end();
  return code >= 200 && code < 300;
}

bool runBurst() {
  capturing = true;
  String burstId = makeUuidV4();
  Serial.printf("[burst] start id=%s\n", burstId.c_str());

  sensor_t* s = esp_camera_sensor_get();
  // Warmup: 4 frames × 80 ms (same fast warmup as single capture)
  for (int i = 0; i < 4; i++) {
    camera_fb_t* warm = esp_camera_fb_get();
    if (warm) esp_camera_fb_return(warm);
    delay(80);
  }
  // Lock exposure/WB for stable frames across the burst
  if (s) {
    int aec  = s->status.aec_value;
    int gain = s->status.agc_gain;
    s->set_exposure_ctrl(s, 0);
    s->set_aec2(s, 0);
    s->set_aec_value(s, aec > 0 ? aec : 800);
    s->set_gain_ctrl(s, 0);
    s->set_agc_gain(s, gain);
    s->set_whitebal(s, 0);
    s->set_awb_gain(s, 0);
    Serial.printf("  [burst] locked AEC=%d AGC=%d\n", aec, gain);
    delay(60);
  }
  // AF once before the burst so all frames share the same focus plane
  ov5640TriggerAf(s, 900);

  unsigned long t0 = millis();
  int seq = 0, sent = 0;
  while (millis() - t0 < BURST_MS && seq < BURST_MAX_FRAMES) {
    unsigned long frameStart = millis();
    camera_fb_t* fb = esp_camera_fb_get();
    if (fb) {
      bool jpeg = isCompleteJpeg(fb->buf, fb->len);
      if (jpeg) {
        bool ok = postBurstFrame(burstId.c_str(), seq, fb->buf, fb->len);
        Serial.printf("  [burst %d] %u bytes -> %s\n",
                      seq, (unsigned)fb->len, ok ? "ok" : "FAIL");
        if (ok) sent++;
      } else {
        Serial.printf("  [burst %d] DROPPED (no EOI)\n", seq);
      }
      esp_camera_fb_return(fb);
      seq++;
    }
    unsigned long elapsed = millis() - frameStart;
    if (elapsed < BURST_MIN_GAP_MS) delay(BURST_MIN_GAP_MS - elapsed);
  }

  // Restore auto-exposure for preview/idle
  if (s) {
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1);
    s->set_gain_ctrl(s, 1);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
  }

  Serial.printf("[burst] done: %d frames sent\n", sent);
  capturing = false;
  if (sent == 0) return false;
  return postBurstFinalize(burstId.c_str());
}


// ============================================================
//  SINGLE CAPTURE PIPELINE — v2.0 (fast + sharp)
// ============================================================
//
//  Timeline (OV5640, good light):
//  ┌───────────────────────────────────────────────────────┐
//  │ Stage A  Warmup 4×80 ms  =  ~320 ms                  │
//  │          ┌ AF triggered at frame 2 (parallel) ──────┐ │
//  │ Stage B  │ Exposure lock + delay 60 ms              │ │
//  │ Stage B½ └ AF completes (was running since frame 2) ┘ │
//  │ Stage C  4-frame burst 4×50 ms  = ~200 ms            │
//  │ Stage D  Upload ~150 KB @ 4096 B chunks  = ~1.0 s    │
//  │ ─────────────────────────────────────────────────── │
//  │ Total    ≈ 1.6-1.9 s   (was 4.0-5.0 s in v1.x)      │
//  └───────────────────────────────────────────────────────┘
bool captureAndSend() {
  capturing = true;
  lastIdleAf = millis(); // reset idle AF timer so it doesn't fire right after

  sensor_t* s = esp_camera_sensor_get();

  // Stage A — FAST WARMUP: 4 frames so AEC/AWB converge on the bright page.
  // We trigger AF at frame index 2 so the motor is moving IN PARALLEL with
  // the remaining warmup frames. By the time we reach Stage B the lens is
  // almost (or fully) focused.
  Serial.println("[capture] Stage A — warmup + parallel AF");
  bool afStarted = false;
  for (int i = 0; i < 4; i++) {
    camera_fb_t* warm = esp_camera_fb_get();
    if (warm) esp_camera_fb_return(warm);
    if (i == 1 && !afStarted && isOv5640 && ov5640AfReady) {
      // Kick off AF mid-warmup without blocking. The motor will run while
      // we capture the remaining warmup frames.
      s->set_reg(s, 0x3022, 0xff, 0x08); // release
      delay(20);
      s->set_reg(s, 0x3023, 0xff, 0x01);
      s->set_reg(s, 0x3022, 0xff, 0x03); // SINGLE
      afStarted = true;
      Serial.println("  [AF] triggered during warmup");
    }
    delay(80);
  }

  // Stage B — LOCK EXPOSURE / WB / GAIN once AEC has settled on paper.
  Serial.println("[capture] Stage B — lock exposure");
  if (s) {
    int aec  = s->status.aec_value;
    int gain = s->status.agc_gain;
    s->set_exposure_ctrl(s, 0);
    s->set_aec2(s, 0);
    s->set_aec_value(s, aec > 0 ? aec : 800);
    s->set_gain_ctrl(s, 0);
    s->set_agc_gain(s, gain);
    s->set_whitebal(s, 0);
    s->set_awb_gain(s, 0);
    Serial.printf("  locked AEC=%d AGC=%d\n", aec, gain);
    delay(60);
  }

  // Stage B½ — WAIT FOR AF COMPLETION (if we started it in Stage A).
  // Poll 0x3023 until ACK==0 (done) or we hit 900 ms from now.
  // In practice the motor converges in 300-600 ms at 20-30 cm macro distance,
  // and most of that time already elapsed during the warmup + lock delay above.
  if (afStarted) {
    Serial.println("[capture] Stage B½ — waiting for AF to settle");
    unsigned long afDeadline = millis() + 900;
    while (millis() < afDeadline) {
      int ack = s->get_reg(s, 0x3023, 0xff);
      if (ack == 0) {
        int state = s->get_reg(s, 0x3029, 0xff);
        Serial.printf("  [AF] confirmed in %.0f ms remaining (state=0x%02x)\n",
                      (float)(afDeadline - millis()), state);
        break;
      }
      delay(20);
    }
  } else if (isOv5640 && ov5640AfReady) {
    // Fallback: AF wasn't started in warmup (e.g. first boot), run it now.
    Serial.println("[capture] Stage B½ — AF fallback (full)");
    ov5640TriggerAf(s, 900);
  }

  // Stage C — PICK-BEST BURST: 4 frames at 50 ms.
  // With OV5640 already focused and exposure locked, lens vibration is the
  // only remaining enemy. 4 shots in 200 ms gives us a few chances to catch
  // the steadiest moment. We pick the LARGEST complete JPEG (= sharpest).
  Serial.println("[capture] Stage C — 4-frame sharpness burst");
  camera_fb_t* bestFb  = nullptr;
  size_t       bestLen = 0;
  for (int i = 0; i < 4; i++) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) continue;
    bool ok = isCompleteJpeg(fb->buf, fb->len);
    Serial.printf("  burst[%d]: %u bytes  complete=%s\n",
                  i, (unsigned)fb->len, ok ? "y" : "n");
    if (ok && fb->len > bestLen) {
      if (bestFb) esp_camera_fb_return(bestFb);
      bestFb  = fb;
      bestLen = fb->len;
    } else {
      esp_camera_fb_return(fb);
    }
    delay(50);
  }

  // Stage D — RESTORE auto settings so /stream and /jpg keep working.
  if (s) {
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1);
    s->set_gain_ctrl(s, 1);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
  }

  capturing = false;

  if (!bestFb) {
    Serial.println("capture failed — no usable frame in burst");
    return false;
  }
  Serial.printf("Sharpest frame: %u bytes — uploading...\n", (unsigned)bestLen);
  bool ok = postJpeg(bestFb->buf, bestFb->len);
  esp_camera_fb_return(bestFb);
  return ok;
}


// Debounced edge detect — fires once when the button goes LOW.
bool pressed(uint8_t pin, int* lastState, unsigned long* lastChange) {
  int s = digitalRead(pin);
  unsigned long now = millis();
  if (s != *lastState && now - *lastChange > 40) {
    *lastChange = now;
    *lastState  = s;
    if (s == LOW) return true;
  }
  return false;
}

int    capState = HIGH, nextState = HIGH, prevState = HIGH;
unsigned long capT = 0, nextT = 0, prevT = 0;

void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n=== Smart Audio Tutor — ESP32-S3  v2.0 ===");

  pinMode(CAPTURE_BTN, INPUT_PULLUP);
  pinMode(NEXT_BTN,    INPUT_PULLUP);
  pinMode(PREV_BTN,    INPUT_PULLUP);

  if (!initCamera()) { Serial.println("Halting."); while (true) delay(1000); }
  connectWifi();
  if (WiFi.status() == WL_CONNECTED) startLocalDashboard();
  initRingBle();
  Serial.println("Ready. Serial: ping / cap / burst / next / prev / ring / af / audit");
}

void printAudit() {
  Serial.println("====== SYSTEM AUDIT v2.0 ======");
  Serial.printf("  WiFi SSID          : %s\n", WIFI_SSID);
  Serial.printf("  WiFi status        : %s\n",
                WiFi.status() == WL_CONNECTED ? "CONNECTED" : "DOWN");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("  Local IP           : %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("  RSSI               : %d dBm\n", WiFi.RSSI());
  }
  Serial.printf("  Server             : https://%s%s\n", SERVER_HOST, SERVER_PATH);
  Serial.printf("  Upload chunk size  : %d bytes\n", UPLOAD_CHUNK_SIZE);
  Serial.printf("  Sensor PID         : 0x%04x (%s)\n", sensorPid,
                isOv5640 ? "OV5640 AF" :
                (sensorPid == 0x3660 ? "OV3660 fixed" : "unknown"));
  Serial.printf("  OV5640 AF ready    : %s\n", ov5640AfReady ? "YES" : "no");
  Serial.printf("  Idle AF interval   : %d ms\n", IDLE_AF_INTERVAL_MS);
  Serial.printf("  Free heap          : %u bytes\n", (unsigned)ESP.getFreeHeap());
  Serial.printf("  Free PSRAM         : %u bytes\n", (unsigned)ESP.getFreePsram());
  Serial.printf("  Uptime             : %lu s\n", millis() / 1000UL);
  printRingStatus();
  Serial.println("================================");
}

void handleSerial() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line.trim();
      if      (line.equalsIgnoreCase("ping"))  { Serial.println("[serial] ping");  checkServer(); }
      else if (line.equalsIgnoreCase("cap"))   { Serial.println("[serial] cap");   Serial.println(captureAndSend() ? "✓ Capture sent" : "✗ Capture FAILED"); }
      else if (line.equalsIgnoreCase("burst")) { Serial.println("[serial] burst"); runBurst(); }
      else if (line.equalsIgnoreCase("next"))  { postCommand("next"); }
      else if (line.equalsIgnoreCase("prev"))  { postCommand("prev"); }
      else if (line.equalsIgnoreCase("ring"))  { printRingStatus(); }
      else if (line.equalsIgnoreCase("af"))    {
        sensor_t* s = esp_camera_sensor_get();
        Serial.println(ov5640TriggerAf(s, 900) ? "✓ AF locked" : "✗ AF failed");
      }
      else if (line.equalsIgnoreCase("audit")) { printAudit(); }
      else if (line.length() > 0)              {
        Serial.printf("[serial] unknown: %s  (try: ping cap burst next prev ring af audit)\n",
                      line.c_str());
      }
      line = "";
    } else if (line.length() < 32) {
      line += c;
    }
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    if (WiFi.status() == WL_CONNECTED) startLocalDashboard();
    delay(500);
    return;
  }
  localServer.handleClient();
  handleSerial();

  if (pressed(CAPTURE_BTN, &capState,  &capT))  {
    Serial.println("[BTN] CAPTURE pressed");
    Serial.println(captureAndSend() ? "✓ Capture sent" : "✗ Capture FAILED");
  }
  if (pressed(NEXT_BTN, &nextState, &nextT)) { Serial.println("[BTN] NEXT");  postCommand("next"); }
  if (pressed(PREV_BTN, &prevState, &prevT)) { Serial.println("[BTN] PREV");  postCommand("prev"); }

  maintainRingBle();
  pollTrigger();
  idlePreFocus();   // ← new: keeps lens parked near document distance
  delay(10);
}
