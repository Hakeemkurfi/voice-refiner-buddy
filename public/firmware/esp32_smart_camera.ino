/*
  ESP32-S3-WROOM N16R8 CAM — Smart Audio Tutor firmware  v3.0
  ─────────────────────────────────────────────────────────────
  Board:            "ESP32S3 Dev Module"
  USB CDC On Boot:  "Enabled"
  PSRAM:            "OPI PSRAM"
  Flash Size:       "16MB"
  Partition Scheme: "16M Flash (3MB APP/9.9MB FATFS)"
  Upload Speed:     921600

  What changed in v3.0 vs v2.0
  ─────────────────────────────
  1. Camera ON/OFF toggle:
       · `esp_camera_deinit()` shuts down the sensor pipeline (stops heat)
       · `initCamera()` restarts it
       · Mapped to S10 middle button (long-press ≥800 ms) for safety
       · Short-press middle = CAPTURE (unchanged)
       · /cam HTTP endpoint + serial command "cam"
  2. Fixed image rotation / crop:
       · Added hmirror/vflip tuning constants you can flip at the top
       · Dashboard stream CSS-rotated 90° if ROTATE_STREAM is set
  3. Sharpness improvements:
       · OV5640 sharpness register 0x530A set to 0x08 (max hardware edge)
       · ae_level → +1 for better visibility in typical indoor light
       · Denoise still 0 (preserves pencil lines)
       · quality 7 → 6 for better edge retention in JPEG
  4. Clean ring button mapping (calibrated):
       · ▲ Up        → replay
       · ▼ Down      → stop
       · ◀ Left      → prev
       · ▶ Right     → next
       · Middle short (≤800 ms) → capture
       · Middle long  (>800 ms) → camera_toggle (ON/OFF)
  5. BLE auto-reconnect improvement:
       · Bond info preserved across reboots (NVS)
       · Disconnect → immediately start rescan (no 8 s penalty on first miss)
       · Connect failure → exponential back-off up to 30 s
  6. Serial commands: ping / cap / burst / next / prev / ring / af / audit / calibrate / cam / flip
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
#include <LittleFS.h>
#include <map>

// ====== EDIT THESE ======
const char* WIFI_SSID     = "Hakeem";
const char* WIFI_PASS     = "10000000";
// Your PUBLISHED app host — host only, no https://, no trailing slash.
const char* SERVER_HOST   = "voice-refiner-buddy.lovable.app";
const char* SERVER_PATH   = "/api/public/event";
const char* DEVICE_SECRET = "";   // endpoint is open right now — leave ""
const char* DEVICE_ID     = "esp32-cam-01";
// ========================

// ====== IMAGE ORIENTATION ======
// If your stream/capture appears rotated or mirrored, flip these:
//   0 = off, 1 = on
#define HMIRROR  0   // horizontal mirror
#define VFLIP    0   // vertical flip
// If the stream looks 90° rotated, set this to 1 — the dashboard page will
// CSS-rotate the <img> by 90° so it looks upright on screen.
#define ROTATE_STREAM_CSS 0
// ================================

// ====== PERFORMANCE TUNING ======
#define UPLOAD_CHUNK_SIZE   4096
#define IDLE_AF_INTERVAL_MS 8000
// ================================

// ====== BURST CAPTURE ======
#define BURST_MS            3000
#define BURST_MIN_GAP_MS    190
#define BURST_MAX_FRAMES    14

// Button pins — safe GPIOs on this board: 1, 2, 3, 14, 21, 38-42.
#define CAPTURE_BTN 1
#define NEXT_BTN    2
#define PREV_BTN    3

// Ring BLE host
#define ENABLE_BLE_RING 1

// Ring device name hint — leave "" to accept any HID ring.
const char* RING_NAME_HINT = "S10";

// Middle-button long-press threshold (ms).
// Short press ≤ this → capture.  Long press > this → camera toggle.
#define MIDDLE_LONGPRESS_MS 800

WebServer localServer(80);

// ─── Forward declarations ───
bool postCommand(const char* type);
bool checkServer();
bool captureAndSend();
bool runBurst();
void initRingBle();
void maintainRingBle();
bool initCamera();
void toggleCamera();

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

static uint16_t sensorPid    = 0;
static bool     isOv5640     = false;
static bool     ov5640AfReady = false;
static bool     cameraOn     = false;   // starts false; set to true after initCamera()

// ============================================================
//  OV5640 AUTOFOCUS HELPER — v3.0
// ============================================================
bool ov5640TriggerAf(sensor_t* s, uint32_t timeoutMs) {
  // v3.1: do NOT gate on ov5640AfReady — many OV5640 modules don't ACK the
  // probe register but still focus correctly when commanded. Try anyway.
  if (!s || !isOv5640 || !cameraOn) return false;

  // 1) Release VCM motor so lens returns to a neutral position.
  s->set_reg(s, 0x3022, 0xff, 0x08);
  delay(30);

  // 2) Wait for any previous command to clear.
  unsigned long t0 = millis();
  while (millis() - t0 < 150) {
    if (s->get_reg(s, 0x3023, 0xff) == 0) break;
    delay(10);
  }

  // 3) Trigger single-shot autofocus.
  s->set_reg(s, 0x3023, 0xff, 0x01);  // mark ACK busy
  s->set_reg(s, 0x3022, 0xff, 0x03);  // SINGLE FOCUS

  // 4) Poll until focused or timeout.
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

// ============================================================
//  CAMERA INIT / DEINIT (for heat management)
// ============================================================
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
    cameraOn = false;
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  if (!s) { Serial.println("sensor_get returned null"); cameraOn = false; return false; }

  sensorPid = s->id.PID;
  isOv5640  = (sensorPid == 0x5640);
  Serial.printf("=== Sensor PID=0x%04x  -> %s ===\n", sensorPid,
                isOv5640 ? "OV5640 (5 MP, AF)" :
                (sensorPid == 0x3660 ? "OV3660 (3 MP, fixed)" : "UNKNOWN"));

  if (isOv5640) {
    // ── Resolution ──
    // QXGA = 2048×1536. Best for document OCR while fitting PSRAM.
    s->set_framesize(s, FRAMESIZE_QXGA);

    // ── JPEG quality 6: slightly sharper JPEG compression vs 7 ──
    s->set_quality(s, 6);

    // ── Exposure & gain ──
    s->set_exposure_ctrl(s, 1);    // AEC on
    s->set_aec2(s, 1);             // AEC2 on
    s->set_ae_level(s, 1);         // +1 exposure boost — helps under desk lamps
    s->set_gain_ctrl(s, 1);        // AGC on
    s->set_agc_gain(s, 0);         // start at minimum ISO
    s->set_gainceiling(s, (gainceiling_t)2); // cap at 8× noise limit

    // ── White balance ──
    // Fluorescent = stable on white paper under LED / tube / desk lamp
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 2);          // 0=auto 1=sunny 2=fluorescent 3=incandescent 4=flash

    // ── Image quality — document-specific ──
    s->set_brightness(s, 1);       // slight brightness boost for dim rooms
    s->set_contrast(s, 2);         // black ink pops on white paper
    s->set_saturation(s, 0);       // neutral (documents are mostly B&W)
    s->set_sharpness(s, 3);        // maximum hardware sharpening via API
    s->set_denoise(s, 0);          // NO denoise — it blurs pencil lines
    s->set_lenc(s, 1);             // lens shading correction
    s->set_bpc(s, 1);              // bad-pixel correction
    s->set_wpc(s, 1);              // white-pixel correction
    s->set_raw_gma(s, 1);          // raw gamma

    // ── Orientation ──
    s->set_hmirror(s, HMIRROR);
    s->set_vflip(s, VFLIP);
    s->set_colorbar(s, 0);
    s->set_special_effect(s, 0);

    // ── Extra sharpness via register 0x530A (OV5640 edge enhancement) ──
    // 0x08 = maximum edge enhance strength (default is 0x00 = disabled)
    s->set_reg(s, 0x530A, 0xff, 0x08);
    // Also enable OV5640's CIP (colour interpolation) sharpening path
    s->set_reg(s, 0x5300, 0xff, 0x08);  // sharpen MT threshold 1
    s->set_reg(s, 0x5301, 0xff, 0x30);  // sharpen MT threshold 2
    s->set_reg(s, 0x5303, 0xff, 0x08);  // sharpen MT offset 1
    s->set_reg(s, 0x5304, 0xff, 0x16);  // sharpen MT offset 2

    // ── Narrow the field of view (~1.3× center crop) for A4 framing ──
    // OV5640 ISP windowing: shrink the active sensor window so the lens
    // looks "less wide". X start 384, Y start 288, end at 2255/1679 →
    // ~1872×1392 crop of the 2592×1944 array, rescaled back to QXGA.
    s->set_reg(s, 0x3800, 0xff, 0x01); s->set_reg(s, 0x3801, 0xff, 0x80);
    s->set_reg(s, 0x3802, 0xff, 0x01); s->set_reg(s, 0x3803, 0xff, 0x20);
    s->set_reg(s, 0x3804, 0xff, 0x08); s->set_reg(s, 0x3805, 0xff, 0xCF);
    s->set_reg(s, 0x3806, 0xff, 0x06); s->set_reg(s, 0x3807, 0xff, 0x8F);

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
    // ── OV3660 (fixed-focus, 3 MP) ──
    s->set_framesize(s, FRAMESIZE_QXGA);
    s->set_quality(s, 6);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 3);          // incandescent works well indoors
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 0);
    s->set_ae_level(s, 1);
    s->set_aec_value(s, 700);
    s->set_gain_ctrl(s, 1);
    s->set_agc_gain(s, 0);
    s->set_gainceiling(s, (gainceiling_t)1);
    s->set_brightness(s, 1);
    s->set_contrast(s, 2);
    s->set_saturation(s, -1);
    s->set_sharpness(s, 3);
    s->set_denoise(s, 0);
    s->set_lenc(s, 1);
    s->set_bpc(s, 1);
    s->set_wpc(s, 1);
    s->set_raw_gma(s, 1);
    s->set_hmirror(s, HMIRROR);
    s->set_vflip(s, VFLIP);
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

  cameraOn = true;
  return true;
}

// ── Camera toggle (ON ↔ OFF) for heat management ──────────────────────────
void toggleCamera() {
  if (cameraOn) {
    Serial.println("[cam] Turning OFF — deinitializing sensor to reduce heat.");
    esp_camera_deinit();
    cameraOn = false;
    Serial.println("[cam] OFF. Press ring middle (long) or type 'cam' to turn back on.");
  } else {
    Serial.println("[cam] Turning ON — reinitializing sensor...");
    if (initCamera()) {
      Serial.println("[cam] ON. Camera ready.");
    } else {
      Serial.println("[cam] FAILED to reinit. Try again or reboot.");
    }
  }
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);             // better association reliability
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("WiFi connecting to \"%s\"", WIFI_SSID);
  unsigned long t0 = millis();
  // Short non-blocking-ish wait so BLE/wizard can start even if AP is down.
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) {
    delay(300); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[wifi] OK  IP=%s  RSSI=%d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    wl_status_t s = WiFi.status();
    Serial.printf("\n[wifi] not connected yet (status=%d). Will retry every 8s in loop().\n", (int)s);
    Serial.println("[wifi] Reasons: wrong SSID/password, 5GHz-only AP (ESP32 needs 2.4GHz), or weak signal.");
    Serial.println("[wifi] BLE ring + wizard will still work without WiFi.");
  }
}

// ============================================================
//  LOCAL WEB DASHBOARD  v3.0
// ============================================================
void handleLocalRoot() {
  String rotStyle = ROTATE_STREAM_CSS
    ? "transform:rotate(90deg);transform-origin:left top;width:100vh;margin-left:100%;"
    : "width:100%;max-width:720px;";

  String page = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>";
  page += "<title>ESP32 Smart Audio Tutor v3</title>";
  page += "<body style='font-family:Arial,sans-serif;margin:20px;line-height:1.6;background:#111;color:#eee'>";
  page += "<h2 style='color:#4af'>ESP32 Smart Audio Tutor v3</h2>";
  page += "<p>Live MJPEG preview — hold camera ~20–30 cm above A4 page, fill the frame.</p>";

  // Camera status indicator
  page += "<p id='camstatus' style='font-weight:bold;color:";
  page += cameraOn ? "#4f4" : "#f44";
  page += "'>Camera: ";
  page += cameraOn ? "🟢 ON" : "🔴 OFF";
  page += "</p>";

  // Stream (only show when camera is on)
  if (cameraOn) {
    page += "<div style='overflow:hidden;max-width:720px;border:2px solid #333;border-radius:8px;margin-bottom:12px'>";
    page += "<img id='live' src='/stream' style='" + rotStyle + "border:none'>";
    page += "</div>";
  } else {
    page += "<div style='width:100%;max-width:720px;height:200px;background:#222;border:2px solid #555;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;color:#888'>Camera is OFF — click \"Camera ON\" to start preview</div>";
  }

  // Buttons row
  page += "<div style='display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px'>";
  String btnStyle = "style='font-size:16px;padding:10px 18px;border:none;border-radius:6px;cursor:pointer;background:#333;color:#fff'";

  if (cameraOn) {
    page += "<a href='/capture'><button " + btnStyle + ">📸 Capture &amp; Send</button></a>";
    page += "<a href='/af'><button " + btnStyle + ">🔍 Autofocus</button></a>";
    page += "<a href='/burst'><button " + btnStyle + ">🎞 Burst</button></a>";
    page += "<a href='/cam'><button style='font-size:16px;padding:10px 18px;border:none;border-radius:6px;cursor:pointer;background:#800;color:#fff'>🔴 Camera OFF</button></a>";
  } else {
    page += "<a href='/cam'><button style='font-size:16px;padding:10px 18px;border:none;border-radius:6px;cursor:pointer;background:#040;color:#fff'>🟢 Camera ON</button></a>";
  }

  page += "<a href='/ping'><button " + btnStyle + ">🌐 Test App Server</button></a>";
  page += "<a href='/next'><button " + btnStyle + ">⏭ Next</button></a>";
  page += "<a href='/prev'><button " + btnStyle + ">⏮ Prev</button></a>";
  page += "</div>";

  // Button map
  page += "<div style='background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:12px;max-width:480px'>";
  page += "<p style='margin:0 0 8px;font-weight:bold;color:#4af'>🔵 S10 Ring Button Map (v3)</p>";
  page += "<table style='width:100%;border-collapse:collapse;font-size:14px'>";
  page += "<tr style='color:#888'><th style='text-align:left;padding:4px'>Button</th><th style='text-align:left;padding:4px'>Action</th></tr>";
  page += "<tr><td style='padding:4px'>▲ Up</td><td>🔁 Replay</td></tr>";
  page += "<tr><td style='padding:4px'>▼ Down</td><td>⏹ Stop speech</td></tr>";
  page += "<tr><td style='padding:4px'>◀ Left</td><td>⏮ Previous step</td></tr>";
  page += "<tr><td style='padding:4px'>▶ Right</td><td>⏭ Next step</td></tr>";
  page += "<tr><td style='padding:4px'>⏸ Middle (short &lt;0.8s)</td><td>📸 Capture photo</td></tr>";
  page += "<tr><td style='padding:4px'>⏸ Middle (hold &gt;0.8s)</td><td>🔴/🟢 Camera ON/OFF</td></tr>";
  page += "</table></div>";

  page += "<p style='margin-top:16px;font-size:13px;color:#666'>Serial: ping / cap / burst / next / prev / ring / af / audit / calibrate / cam / flip</p>";
  page += "<p>Open <b>https://" + String(SERVER_HOST) + "</b> on your phone and tap Enable audio.</p>";
  page += "</body>";

  localServer.send(200, "text/html", page);
}

// ── JPEG completeness check ────────────────────────────────────────────────
static inline bool isCompleteJpeg(const uint8_t* buf, size_t len) {
  if (!buf || len < 4) return false;
  if (buf[0] != 0xFF || buf[1] != 0xD8) return false;
  if (buf[len - 2] != 0xFF || buf[len - 1] != 0xD9) return false;
  return true;
}

static void previewSetSize(framesize_t fs) {
  if (!cameraOn) return;
  sensor_t* s = esp_camera_sensor_get();
  if (s) s->set_framesize(s, fs);
}

void handleLocalStream() {
  if (!cameraOn) {
    localServer.send(503, "text/plain", "Camera is OFF. Use /cam to turn it on.");
    return;
  }
  WiFiClient client = localServer.client();
  if (!client) return;
  const char* boundary = "frame";
  client.print("HTTP/1.1 200 OK\r\n");
  client.printf("Content-Type: multipart/x-mixed-replace;boundary=%s\r\n", boundary);
  client.print("Cache-Control: no-store\r\nConnection: close\r\n\r\n");

  previewSetSize(FRAMESIZE_VGA);   // 640×480 — much faster live view
  unsigned long started = millis();
  while (client.connected() && millis() - started < 120000 && cameraOn) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) { delay(10); continue; }
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
    // no extra delay — let the next frame come ASAP
  }
  // NOTE: do NOT re-set to QXGA here. The next /capture call sets QXGA
  // itself, and re-setting it on every stream-close caused multi-second
  // freezes after moving the camera.
  client.stop();
}

void handleLocalJpg() {
  if (!cameraOn) { localServer.send(503, "text/plain", "Camera is OFF."); return; }
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
  if (!cameraOn) {
    localServer.send(200, "text/html", "<p>Camera is OFF. <a href='/cam'>Turn it on</a> first.</p><p><a href='/'>Back</a></p>");
    return;
  }
  bool ok = captureAndSend();
  localServer.send(200, "text/html",
    String("<p>") + (ok ? "✓ Capture sent to app." : "✗ Capture failed. Check Serial Monitor.") +
    "</p><p><a href='/'>Back</a></p>");
}

void handleLocalPing() {
  bool ok = checkServer();
  localServer.send(200, "text/html",
    String("<p>") + (ok ? "✓ App server reachable." : "✗ App server NOT reachable.") +
    "</p><p><a href='/'>Back</a></p>");
}

void handleLocalAf() {
  if (!cameraOn) { localServer.send(503, "text/plain", "Camera is OFF."); return; }
  sensor_t* s = esp_camera_sensor_get();
  bool ok = ov5640TriggerAf(s, 900);
  localServer.send(200, "text/html",
    String("<p>") + (ok ? "✓ Autofocus locked." : "✗ AF failed or not OV5640.") +
    "</p><p><a href='/'>Back</a></p>");
}

void handleLocalCam() {
  toggleCamera();
  localServer.sendHeader("Location", "/");
  localServer.send(302, "text/plain", "Redirecting...");
}

void startLocalDashboard() {
  localServer.on("/",        handleLocalRoot);
  localServer.on("/jpg",     handleLocalJpg);
  localServer.on("/stream",  handleLocalStream);
  localServer.on("/capture", handleLocalCapture);
  localServer.on("/ping",    handleLocalPing);
  localServer.on("/af",      handleLocalAf);
  localServer.on("/cam",     handleLocalCam);
  localServer.on("/burst", []() {
    if (!cameraOn) {
      localServer.send(200, "text/html", "<p>Camera is OFF. <a href='/cam'>Turn it on</a> first.</p><p><a href='/'>Back</a></p>");
      return;
    }
    bool ok = runBurst();
    localServer.send(200, "text/html",
      String("<p>") + (ok ? "✓ Burst sent to app." : "✗ Burst failed. Check Serial Monitor.") +
      "</p><p><a href='/'>Back</a></p>");
  });
  localServer.on("/next", []() {
    bool ok = postCommand("next");
    localServer.send(200, "text/html",
      String("<p>") + (ok ? "✓ Next sent." : "✗ Next failed.") +
      "</p><p><a href='/'>Back</a></p>");
  });
  localServer.on("/prev", []() {
    bool ok = postCommand("prev");
    localServer.send(200, "text/html",
      String("<p>") + (ok ? "✓ Prev sent." : "✗ Prev failed.") +
      "</p><p><a href='/'>Back</a></p>");
  });
  auto serveWizlog = [](bool asDownload){
    if (!LittleFS.begin(true)) { localServer.send(500, "text/plain", "FS mount failed"); return; }
    File f = LittleFS.open("/wizlog.txt", FILE_READ);
    if (!f) { localServer.send(404, "text/plain", "No /wizlog.txt yet — run 'wizard' in Serial Monitor (then press each button 3x)"); return; }
    if (asDownload) {
      localServer.sendHeader("Content-Disposition", "attachment; filename=\"wizlog.txt\"");
    }
    localServer.streamFile(f, "text/plain");
    f.close();
  };
  // View in browser:
  localServer.on("/wizlog",        [serveWizlog](){ serveWizlog(false); });
  localServer.on("/wizlog.txt",    [serveWizlog](){ serveWizlog(false); });
  // Force download (right-click → Save As also works on /wizlog):
  localServer.on("/wizlog/download", [serveWizlog](){ serveWizlog(true);  });
  localServer.on("/download",        [serveWizlog](){ serveWizlog(true);  });
  localServer.begin();
  Serial.printf("Local dashboard: http://%s/\n", WiFi.localIP().toString().c_str());
}

// ============================================================
//  HTTPS UPLOAD
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
  client.print("User-Agent: ESP32-S3-CAM-Smart-Audio-Tutor-v3\r\n");
  client.print("Connection: close\r\n");
  client.print("Content-Type: image/jpeg\r\n");
  client.printf("Content-Length: %u\r\n", (unsigned)len);
  client.printf("X-Device-Id: %s\r\n", DEVICE_ID);
  if (strlen(DEVICE_SECRET) > 0)
    client.printf("X-Device-Secret: %s\r\n", DEVICE_SECRET);
  client.print("\r\n");

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
//  RING REMOTE BRIDGE
// ============================================================
String lastTriggerId              = "";
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
      if (cameraOn) captureAndSend();
      else Serial.println("[ring] trigger ignored — camera is OFF");
      return;
    } else if (newId.length() > 0) {
      lastTriggerId = newId;
    }
  }
  http.end();
}

// ============================================================
//  DIRECT BLE HID RING HOST  v3.0
// ============================================================
#if ENABLE_BLE_RING
static BLEAdvertisedDevice* ringDevice  = nullptr;
static BLEClient*           ringClient  = nullptr;
static bool   ringConnected             = false;
static bool   ringScanRunning           = false;
static bool   calibrateMode            = false;

// ── Guided calibration wizard v2 ──────────────────────────────────────
// Type "wizard" in Serial Monitor.  For each of 5 buttons it asks for 3
// presses, records the FULL raw report bytes of every notification that
// arrives during each press (so multi-report buttons are not lost), and
// writes everything to LittleFS at /wizlog.txt — pull that one file (or
// open http://<esp-ip>/wizlog) instead of screenshotting each line.
// Type "wizshow" to dump the saved log again.  Type "wizreset" to clear.
static bool   wizMode      = false;
static int    wizStep      = 0;          // 0=middle 1=left 2=right 3=up 4=down 5=done
static const char* WIZ_NAMES[5] = { "MIDDLE", "LEFT", "RIGHT", "UP", "DOWN" };
static const char* WIZ_ACT  [5] = { "capture", "prev", "next", "replay", "stop" };
static uint8_t wizCounts[5][256];        // [step][d1] = report count (legacy)
static uint8_t wizFinal [5];             // recorded d[1] per step
static bool    wizHas   [5];             // recorded flag
// New: press-event tracking (a "press" = transition all-zero → non-zero)
static int          wizPressIdx     = 0;       // 0..2 within current step
static bool         wizPrevPressed  = false;   // last report had any non-zero byte
static unsigned long wizLastEdgeAt  = 0;
static bool         wizFsReady      = false;
static unsigned long lastBleScan        = 0;
static unsigned long lastRingAction     = 0;
static unsigned long lastRingConnectAttempt = 0;
static uint8_t ringConnectFailures      = 0;
static unsigned long ringConnectBackoff = 2500;  // starts at 2.5 s, grows up to 30 s

// ── Middle button press-time tracking (for long-press detection) ──────────
static unsigned long middlePressTime = 0;   // millis() when middle went down
static bool          middleDown      = false;

class RingClientCallbacks : public BLEClientCallbacks {
  void onConnect(BLEClient*) override    { Serial.println("[ring] BLE link opened"); }
  void onDisconnect(BLEClient*) override {
    ringConnected = false;
    lastBleScan   = 0;   // trigger immediate rescan
    Serial.println("[ring] disconnected — rescanning immediately");
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

  if (calibrateMode) {
    Serial.println();
    Serial.println("╔══════════════════════════════════════════╗");
    Serial.printf( "║  CALIBRATE: button action = %-10s║\n", action);
    Serial.println("╚══════════════════════════════════════════╝");
    if      (!strcmp(action, "capture"))        Serial.println("  -> Would take a PHOTO & send to app");
    else if (!strcmp(action, "camera_toggle"))  Serial.println("  -> Would toggle camera ON/OFF");
    else if (!strcmp(action, "next"))           Serial.println("  -> Would read NEXT step aloud");
    else if (!strcmp(action, "prev"))           Serial.println("  -> Would read PREVIOUS step aloud");
    else if (!strcmp(action, "replay"))         Serial.println("  -> Would REPLAY current step");
    else if (!strcmp(action, "stop"))           Serial.println("  -> Would STOP/PAUSE speech");
    else if (!strcmp(action, "burst"))          Serial.println("  -> Would take a BURST (slow pan)");
    Serial.println("  (type 'calibrate' again to exit and activate buttons)");
    return;
  }

  Serial.printf("\n>>> [RING BUTTON] %s  (BLE=%s, cam=%s) <<<\n",
                action,
                ringConnected ? "YES" : "NO",
                cameraOn      ? "ON"  : "OFF");

  if      (!strcmp(action, "capture"))       { if (cameraOn) captureAndSend(); else Serial.println("  >> Camera is OFF — long-press middle to turn it ON first"); }
  else if (!strcmp(action, "camera_toggle")) toggleCamera();
  else if (!strcmp(action, "burst"))         { if (cameraOn) runBurst(); else Serial.println("  >> Camera is OFF"); }
  else if (!strcmp(action, "single"))        { if (cameraOn) captureAndSend(); else Serial.println("  >> Camera is OFF"); }
  else if (!strcmp(action, "next"))          postCommand("next");
  else if (!strcmp(action, "prev"))          postCommand("prev");
  else if (!strcmp(action, "replay"))        postCommand("replay");
  else if (!strcmp(action, "stop"))          postCommand("stop");
}

void printRingStatus() {
  Serial.println("──── S10 RING / BLE STATUS v3 ────");
  Serial.printf("  BLE compiled in      : YES\n");
  Serial.printf("  Ring hint            : \"%s\"\n", RING_NAME_HINT);
  Serial.printf("  Ring discovered      : %s\n", ringDevice    ? "YES" : "no");
  Serial.printf("  Ring connected       : %s\n", ringConnected ? "YES" : "no");
  Serial.printf("  Scan running         : %s\n", ringScanRunning ? "yes" : "no");
  Serial.printf("  Camera               : %s\n", cameraOn ? "ON" : "OFF");
  Serial.printf("  Last action (ms ago) : %lu\n",
                lastRingAction == 0 ? 0UL : (millis() - lastRingAction));
  Serial.printf("  Calibrate mode       : %s\n", calibrateMode ? "ON (safe)" : "OFF (live)");
  Serial.println();
  Serial.println("  Button Map (v3):");
  Serial.println("  ┌────────────────────────────────────────┐");
  Serial.println("  │  [▲ Up]        → REPLAY step           │");
  Serial.println("  │  [▼ Down]      → STOP / pause speech   │");
  Serial.println("  │  [◀ Left]      → PREV step             │");
  Serial.println("  │  [▶ Right]     → NEXT step             │");
  Serial.println("  │  [⏸ Mid SHORT] → CAPTURE photo         │");
  Serial.println("  │  [⏸ Mid LONG ] → CAMERA ON / OFF       │");
  Serial.println("  └────────────────────────────────────────┘");
  Serial.println("────────────────────────────────────");
}

static uint32_t lastRingHash   = 0;
static unsigned long lastRingHashAt = 0;

// ── Middle-button long-press state machine ────────────────────────────────
// We track press-time in handleRingReport and fire either "capture" (short)
// or "camera_toggle" (long) on release.  The S10 sends a non-zero report on
// press and an all-zero report on release.
static bool ringMiddleHeld = false;
static unsigned long ringMiddleHeldAt = 0;

void ringFireMiddle(bool isRelease) {
  if (!isRelease) {
    // press-down
    if (!ringMiddleHeld) {
      ringMiddleHeld   = true;
      ringMiddleHeldAt = millis();
    }
  } else {
    // release
    if (ringMiddleHeld) {
      unsigned long held = millis() - ringMiddleHeldAt;
      ringMiddleHeld = false;
      if (held >= MIDDLE_LONGPRESS_MS) {
        ringAction("camera_toggle");
      } else {
        ringAction("capture");
      }
    }
  }
}

// ── Wizard helpers: LittleFS log of every press, raw bytes intact ────
static void wizFsBoot() {
  if (wizFsReady) return;
  if (LittleFS.begin(true)) { wizFsReady = true; }
  else Serial.println("[wiz] LittleFS mount FAILED — log will be serial-only");
}
static void wizLog(const String& line) {
  Serial.println(line);
  if (!wizFsReady) return;
  File f = LittleFS.open("/wizlog.txt", FILE_APPEND);
  if (!f) return;
  f.println(line);
  f.close();
}
static void wizLogReset(const char* header) {
  wizFsBoot();
  if (!wizFsReady) return;
  File f = LittleFS.open("/wizlog.txt", FILE_WRITE);
  if (!f) return;
  f.println(header);
  f.close();
}
static void wizDumpFile() {
  wizFsBoot();
  if (!wizFsReady) { Serial.println("[wiz] no FS"); return; }
  File f = LittleFS.open("/wizlog.txt", FILE_READ);
  if (!f) { Serial.println("[wiz] /wizlog.txt not found yet — run 'wizard' first"); return; }
  Serial.println("──── /wizlog.txt ────");
  while (f.available()) Serial.write(f.read());
  Serial.println("\n──── end ────");
  f.close();
}

void handleRingReport(uint8_t* d, size_t len) {
  Serial.print("[ring] report:");
  for (size_t i = 0; i < len; i++) Serial.printf(" %02X", d[i]);
  Serial.println();
  if (len == 0) return;

  bool anyPressed = false;
  for (size_t i = 0; i < len; i++) if (d[i] != 0x00) anyPressed = true;

  // ── Wizard interception (must run BEFORE gyro filter & release handling)
  if (wizMode && wizStep < 5) {
    // Ignore obvious gyro stream so it doesn't pollute the log
    bool isGyro = (len >= 3 && d[1] == 0xF4);
    if (!isGyro) {
      // Format the raw report once
      String hex = "";
      for (size_t i = 0; i < len; i++) { char b[4]; snprintf(b, sizeof(b), "%02X ", d[i]); hex += b; }
      hex.trim();

      // Press = transition from all-zero to non-zero (debounced 80 ms)
      if (anyPressed && !wizPrevPressed && millis() - wizLastEdgeAt > 80) {
        wizPressIdx++;
        wizLastEdgeAt = millis();
        wizLog(String("[wiz] ") + WIZ_NAMES[wizStep] + " press #" + wizPressIdx + " edge");
        // Lock d[1] code from the FIRST press of each button
        if (len >= 2 && !wizHas[wizStep]) {
          wizFinal[wizStep] = d[1];
          wizHas[wizStep]   = true;
        }
      }
      if (!anyPressed && wizPrevPressed) {
        wizLastEdgeAt = millis();
        wizLog(String("[wiz] ") + WIZ_NAMES[wizStep] + " release");
      }
      wizPrevPressed = anyPressed;

      // Log every non-zero report in full (multi-byte buttons preserved)
      if (anyPressed) {
        if (len >= 2 && wizCounts[wizStep][d[1]] < 255) wizCounts[wizStep][d[1]]++;
        wizLog(String("[wiz] ") + WIZ_NAMES[wizStep]
               + " step=" + wizStep + " press=" + wizPressIdx
               + " len=" + len + " bytes=" + hex);
      }

      // After 3 press edges advance
      if (wizPressIdx >= 3) {
        wizLog(String("[wiz] ✓ ") + WIZ_NAMES[wizStep]
               + " LOCKED d[1]=0x" + String(wizFinal[wizStep], HEX)
               + " action=" + WIZ_ACT[wizStep]);
        wizStep++;
        wizPressIdx    = 0;
        wizPrevPressed = false;
        if (wizStep < 5) {
          wizLog(String("\n>>> Now press ") + WIZ_NAMES[wizStep] + " button 3 times <<<");
        } else {
          wizLog("\n╔════════════ WIZARD COMPLETE ════════════╗");
          wizLog(  "║  Paste this into handleRingReport():    ║");
          wizLog(  "╚═════════════════════════════════════════╝");
          for (int i = 0; i < 5; i++) {
            char buf[160];
            if (!wizHas[i]) {
              snprintf(buf, sizeof(buf), "  // %s — NOT captured", WIZ_NAMES[i]);
            } else if (i == 0) {
              snprintf(buf, sizeof(buf),
                "  if (len >= 2 && d[1] == 0x%02X) { ringFireMiddle(false); return; }  // %s",
                wizFinal[i], WIZ_NAMES[i]);
            } else {
              snprintf(buf, sizeof(buf),
                "  if (len >= 2 && d[1] == 0x%02X) { ringAction(\"%s\"); return; }  // %s",
                wizFinal[i], WIZ_ACT[i], WIZ_NAMES[i]);
            }
            wizLog(buf);
          }
          wizLog("\n  Full log saved to /wizlog.txt — type 'wizshow' to dump, or open http://<esp-ip>/wizlog");
          wizMode = false;
        }
      }
    }
    return;   // never trigger actions while wizard is active
  }

  if (!anyPressed) {
    // All-zero report = button release
    ringFireMiddle(true);   // resolve any pending middle press
    lastRingHash = 0;
    return;
  }

  // ── IGNORE gyro/air-mouse streaming data ─────────────────────────────
  if (len >= 3 && d[1] == 0xF4) {
    return;
  }



  // Same for 0x0F 0xEF format air-mouse (some firmware versions)
  if (len >= 3 && d[0] == 0x0F && d[1] == 0xEF) {
    // Old vendor air-mouse format — only match known codes below
    uint16_t tail = (uint16_t(d[2]) << 8) | d[3];
    switch (tail) {
      case 0x0137: ringFireMiddle(false); return;
      case 0x8116: ringAction("next");    return;
      case 0x4115: ringAction("prev");    return;
      case 0x0114: ringAction("replay");  return;
      case 0x0119: ringAction("stop");    return;
      default: return;  // ignore unknown vendor codes
    }
  }

  // ── Deduplicate rapid repeats ─────────────────────────────────────────
  uint32_t h = 0;
  for (size_t i = 0; i < len; i++) h = (h * 131) ^ d[i];
  if (h == lastRingHash && millis() - lastRingHashAt < 350) return;
  lastRingHash = h; lastRingHashAt = millis();

  // ── YOUR S10 ring calibration codes (from Serial Monitor 2026-06-23) ──
  // Middle button observed: [00 2C 41 1F] → d[1]=0x2C
  // Direction buttons: run 'calibrate' then press each arrow to identify
  if (len >= 2 && d[1] == 0x2C) {
    // Middle button (Space / pause/play key) → capture or camera toggle
    ringFireMiddle(false);
    return;
  }

  // ── Check d[1] for any vendor-specific button codes ───────────────────
  // Add entries here once you run 'calibrate' and press each arrow button:
  // e.g.  if (len >= 2 && d[0] == 0x07 && d[1] == 0xXX) { ringAction("next"); return; }

  // ── Standard HID keyboard report (keycodes at bytes 2+) ──────────────
  if (len >= 3) {
    for (size_t i = 2; i < len; i++) {
      switch (d[i]) {
        case 0x28:            ringFireMiddle(false); return;  // Enter  = middle
        case 0x10:            ringFireMiddle(false); return;  // m key  = middle
        case 0x2C:            ringFireMiddle(false); return;  // Space  = middle (if at d[2])
        case 0x4F:            ringAction("next");    return;  // →
        case 0x50:            ringAction("prev");    return;  // ←
        case 0x51:            ringAction("stop");    return;  // ↓
        case 0x52:            ringAction("replay");  return;  // ↑
      }
    }
  }

  // ── 2-byte consumer report ────────────────────────────────────────────
  if (len == 2) {
    uint16_t v = d[0] | (uint16_t(d[1]) << 8);
    switch (v) {
      case 0x00CD: case 0x0001: ringFireMiddle(false); return;  // MediaPlayPause → middle
      case 0x00B5: case 0x0080: ringAction("next");    return;
      case 0x00B6: case 0x0040: ringAction("prev");    return;
      case 0x00E9: case 0x0010: ringAction("replay");  return;
      case 0x00EA: case 0x0020: ringAction("stop");    return;
    }
  }

  // Still unknown — print for calibration
  Serial.println(">>> [RING] unmatched report — press 'calibrate' then each button to identify <<<");
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
      ringConnectBackoff  = 2500;
      ringScanRunning = false;
    }
  }
};

bool connectRingBle() {
  if (!ringDevice) return false;
  if (millis() - lastRingConnectAttempt < ringConnectBackoff) return false;
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
    ringConnectFailures++;
    // Exponential back-off: 2.5 s → 5 s → 10 s → 20 s → 30 s (cap)
    ringConnectBackoff = min((unsigned long)30000, ringConnectBackoff * 2);
    Serial.printf("[ring] next attempt in %.1f s\n", ringConnectBackoff / 1000.0);
    if (ringConnectFailures >= 5) {
      Serial.println("[ring] 5 failures — forgetting device, will rescan");
      delete ringDevice; ringDevice = nullptr;
      ringConnectFailures = 0;
      ringConnectBackoff  = 2500;
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
  if (ringConnected) {
    ringConnectFailures = 0;
    ringConnectBackoff  = 2500;
  }
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
  // Scan: immediately after disconnect (lastBleScan=0 triggers this), then every 8 s
  unsigned long scanInterval = (lastBleScan == 0) ? 0 : 8000;
  if (!ringScanRunning && millis() - lastBleScan > scanInterval) {
    lastBleScan     = millis();
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
//  IDLE PRE-FOCUS
// ============================================================
static unsigned long lastIdleAf = 0;
static bool          capturing  = false;

void idlePreFocus() {
#if IDLE_AF_INTERVAL_MS > 0
  if (capturing || !cameraOn) return;
  if (!isOv5640 || !ov5640AfReady) return;
  if (millis() - lastIdleAf < IDLE_AF_INTERVAL_MS) return;
  lastIdleAf = millis();
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  Serial.println("[idle AF] pre-focusing...");
  ov5640TriggerAf(s, 600);
#endif
}


// ============================================================
//  BURST CAPTURE
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
  client.print("User-Agent: ESP32-S3-CAM-Smart-Audio-Tutor-v3\r\n");
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
  if (!cameraOn) { Serial.println("[burst] Camera is OFF — cannot burst."); return false; }
  capturing = true;
  String burstId = makeUuidV4();
  Serial.printf("[burst] start id=%s\n", burstId.c_str());

  sensor_t* s = esp_camera_sensor_get();
  for (int i = 0; i < 4; i++) {
    camera_fb_t* warm = esp_camera_fb_get();
    if (warm) esp_camera_fb_return(warm);
    delay(80);
  }
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
//  SINGLE CAPTURE PIPELINE  v3.0
// ============================================================
bool captureAndSend() {
  if (!cameraOn) {
    Serial.println("[capture] Camera is OFF — long-press ring middle to turn it ON.");
    return false;
  }
  capturing = true;
  lastIdleAf = millis();

  sensor_t* s = esp_camera_sensor_get();

  // Restore QXGA in case the live preview left us in VGA
  if (s) s->set_framesize(s, FRAMESIZE_QXGA);
  // Flush stale frames from the previous resolution
  for (int i = 0; i < 2; i++) { camera_fb_t* fb = esp_camera_fb_get(); if (fb) esp_camera_fb_return(fb); }

  // Stage A — Warmup + parallel AF
  Serial.println("[capture] Stage A — warmup + parallel AF");
  bool afStarted = false;
  for (int i = 0; i < 4; i++) {
    camera_fb_t* warm = esp_camera_fb_get();
    if (warm) esp_camera_fb_return(warm);
    if (i == 1 && !afStarted && isOv5640) {  // drop ov5640AfReady gate
      s->set_reg(s, 0x3022, 0xff, 0x08);
      delay(20);
      s->set_reg(s, 0x3023, 0xff, 0x01);
      s->set_reg(s, 0x3022, 0xff, 0x03);
      afStarted = true;
      Serial.println("  [AF] triggered during warmup");
    }
    delay(80);
  }

  // Stage B — Lock exposure
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

  // Stage B½ — Wait for AF
  if (afStarted) {
    Serial.println("[capture] Stage B½ — waiting for AF to settle");
    unsigned long afDeadline = millis() + 900;
    while (millis() < afDeadline) {
      int ack = s->get_reg(s, 0x3023, 0xff);
      if (ack == 0) {
        int state = s->get_reg(s, 0x3029, 0xff);
        Serial.printf("  [AF] confirmed (state=0x%02x)\n", state);
        break;
      }
      delay(20);
    }
  } else if (isOv5640 && ov5640AfReady) {
    Serial.println("[capture] Stage B½ — AF fallback (full)");
    ov5640TriggerAf(s, 900);
  }

  // Stage C — Pick-best burst (4 frames)
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

  // Stage D — Restore auto settings
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


// ============================================================
//  HARDWARE BUTTONS
// ============================================================
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

// ============================================================
//  SETUP & LOOP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("\n=== Smart Audio Tutor — ESP32-S3  v3.0 ===");
  Serial.println("  Image orient : HMIRROR=" + String(HMIRROR) + "  VFLIP=" + String(VFLIP));
  Serial.println("  Middle short : CAPTURE photo");
  Serial.println("  Middle long  : CAMERA ON/OFF toggle (hold >" + String(MIDDLE_LONGPRESS_MS) + " ms)");

  pinMode(CAPTURE_BTN, INPUT_PULLUP);
  pinMode(NEXT_BTN,    INPUT_PULLUP);
  pinMode(PREV_BTN,    INPUT_PULLUP);

  if (!initCamera()) { Serial.println("Halting."); while (true) delay(1000); }
  connectWifi();
  if (WiFi.status() == WL_CONNECTED) startLocalDashboard();
  initRingBle();
  Serial.println("Ready. Serial commands:");
  Serial.println("  ping cap burst next prev ring af audit calibrate cam flip");
  Serial.println("TIP: type 'calibrate' to safely identify S10 buttons.");
  Serial.println("TIP: type 'cam' to toggle camera ON/OFF (heat management).");
  Serial.println("TIP: type 'flip' to toggle hmirror on/off at runtime.");
}

void printAudit() {
  Serial.println("====== SYSTEM AUDIT v3.0 ======");
  Serial.printf("  WiFi SSID          : %s\n", WIFI_SSID);
  Serial.printf("  WiFi status        : %s\n",
                WiFi.status() == WL_CONNECTED ? "CONNECTED" : "DOWN");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("  Local IP           : %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("  RSSI               : %d dBm\n", WiFi.RSSI());
  }
  Serial.printf("  Server             : https://%s%s\n", SERVER_HOST, SERVER_PATH);
  Serial.printf("  Camera             : %s\n", cameraOn ? "ON" : "OFF");
  Serial.printf("  HMIRROR / VFLIP    : %d / %d\n", HMIRROR, VFLIP);
  Serial.printf("  Rotate stream CSS  : %s\n", ROTATE_STREAM_CSS ? "YES" : "no");
  Serial.printf("  Sensor PID         : 0x%04x (%s)\n", sensorPid,
                isOv5640 ? "OV5640 AF" :
                (sensorPid == 0x3660 ? "OV3660 fixed" : "unknown"));
  Serial.printf("  OV5640 AF ready    : %s\n", ov5640AfReady ? "YES" : "no");
  Serial.printf("  Idle AF interval   : %d ms\n", IDLE_AF_INTERVAL_MS);
  Serial.printf("  Middle long-press  : >%d ms = camera toggle\n", MIDDLE_LONGPRESS_MS);
  Serial.printf("  Free heap          : %u bytes\n", (unsigned)ESP.getFreeHeap());
  Serial.printf("  Free PSRAM         : %u bytes\n", (unsigned)ESP.getFreePsram());
  Serial.printf("  Uptime             : %lu s\n", millis() / 1000UL);
  printRingStatus();
  Serial.println("================================");
}

static bool runtimeMirror = HMIRROR;   // allow toggling at runtime

void handleSerial() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line.trim();
      if      (line.equalsIgnoreCase("ping"))      { Serial.println("[serial] ping");  checkServer(); }
      else if (line.equalsIgnoreCase("cap"))        { Serial.println("[serial] cap");   Serial.println(captureAndSend() ? "✓ Capture sent" : "✗ Capture FAILED"); }
      else if (line.equalsIgnoreCase("burst"))      { Serial.println("[serial] burst"); runBurst(); }
      else if (line.equalsIgnoreCase("next"))       { postCommand("next"); }
      else if (line.equalsIgnoreCase("prev"))       { postCommand("prev"); }
      else if (line.equalsIgnoreCase("ring"))       { printRingStatus(); }
      else if (line.equalsIgnoreCase("af"))         {
        sensor_t* s = esp_camera_sensor_get();
        Serial.println(ov5640TriggerAf(s, 900) ? "✓ AF locked" : "✗ AF failed");
      }
      else if (line.equalsIgnoreCase("audit"))      { printAudit(); }
      else if (line.equalsIgnoreCase("cam"))        { toggleCamera(); }
      else if (line.equalsIgnoreCase("flip"))       {
        if (!cameraOn) { Serial.println("Camera is OFF — turn it on first (cam)"); }
        else {
          runtimeMirror = !runtimeMirror;
          sensor_t* s = esp_camera_sensor_get();
          if (s) s->set_hmirror(s, runtimeMirror ? 1 : 0);
          Serial.printf("hmirror = %d\n", runtimeMirror ? 1 : 0);
        }
      }
      else if (line.equalsIgnoreCase("calibrate")) {
        calibrateMode = !calibrateMode;
        if (calibrateMode) {
          Serial.println();
          Serial.println("╔════════════════════════════════════════════╗");
          Serial.println("║  CALIBRATE MODE ON — buttons are SAFE now  ║");
          Serial.println("║  Press each ring button one at a time.     ║");
          Serial.println("║  Serial Monitor shows action name.         ║");
          Serial.println("║  Type 'calibrate' again when done.         ║");
          Serial.println("╚════════════════════════════════════════════╝");
          printRingStatus();
        } else {
          Serial.println("╔═════════════════════════════════════╗");
          Serial.println("║  CALIBRATE MODE OFF — buttons LIVE  ║");
          Serial.println("╚═════════════════════════════════════╝");
        }
      }
      else if (line.equalsIgnoreCase("wizard")) {
        wizMode        = true;
        wizStep        = 0;
        wizPressIdx    = 0;
        wizPrevPressed = false;
        wizLastEdgeAt  = 0;
        for (int i = 0; i < 5; i++) { wizHas[i] = false; wizFinal[i] = 0;
          for (int j = 0; j < 256; j++) wizCounts[i][j] = 0; }
        wizLogReset("=== Smart Audio Tutor wizard log ===");
        Serial.println();
        Serial.println("╔══════════════════════════════════════════════╗");
        Serial.println("║  GUIDED RING BUTTON WIZARD v2                ║");
        Serial.println("║  Press each button firmly 3 times.           ║");
        Serial.println("║  ALL raw bytes per press are logged to       ║");
        Serial.println("║    /wizlog.txt   (also at  /wizlog  on HTTP) ║");
        Serial.println("║  Type 'wizshow' to dump, 'wizreset' to clear.║");
        Serial.println("╚══════════════════════════════════════════════╝");
        Serial.printf("\n>>> Press %s button 3 times <<<\n", WIZ_NAMES[0]);
      }
      else if (line.equalsIgnoreCase("wizshow")) { wizDumpFile(); }
      else if (line.equalsIgnoreCase("wizreset")) {
        wizLogReset("=== cleared ===");
        Serial.println("[wiz] /wizlog.txt cleared");
      }
      else if (line.length() > 0) {
        Serial.printf("[serial] unknown: %s  (try: ping cap burst next prev ring af audit calibrate cam flip wizard wizshow wizreset)\n",
                      line.c_str());
      }
      line = "";
    } else if (line.length() < 32) {
      line += c;
    }
  }
}

void loop() {
  // ── Non-blocking WiFi reconnect — NEVER block BLE / serial / wizard ──
  // (Old code blocked here for 20s on every retry, so the ring could not
  //  pair and the wizard could not run while WiFi was down.)
  static unsigned long lastWifiTry = 0;
  static bool wifiBeginIssued = false;
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiTry > 8000) {
      lastWifiTry = millis();
      Serial.printf("[wifi] retrying SSID=%s ...\n", WIFI_SSID);
      WiFi.disconnect(true, true);
      WiFi.mode(WIFI_STA);
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      wifiBeginIssued = true;
    }
  } else if (wifiBeginIssued) {
    wifiBeginIssued = false;
    Serial.printf("[wifi] CONNECTED  IP=%s  RSSI=%d\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    startLocalDashboard();
  }

  if (WiFi.status() == WL_CONNECTED) {
    localServer.handleClient();
    pollTrigger();
  }
  handleSerial();   // always — so 'wizard' / 'audit' / 'cam' work even with no WiFi

  if (pressed(CAPTURE_BTN, &capState,  &capT))  {
    Serial.println("[BTN] CAPTURE pressed");
    Serial.println(captureAndSend() ? "✓ Capture sent" : "✗ Capture FAILED");
  }
  if (pressed(NEXT_BTN, &nextState, &nextT)) { Serial.println("[BTN] NEXT");  postCommand("next"); }
  if (pressed(PREV_BTN, &prevState, &prevT)) { Serial.println("[BTN] PREV");  postCommand("prev"); }

  maintainRingBle();   // always — pair the ring even with WiFi down
  idlePreFocus();
  delay(10);
}
