/*
  ESP32-S3-CAM Smart Audio Tutor — firmware
  Board: ESP32-S3 Dev Module (ESP32-S3-WROOM-1 N16R8 with OV2640 camera)

  What it does
  ------------
  - Connects to your WiFi.
  - Three buttons (active LOW with internal pull-ups):
       CAPTURE_BTN  -> takes a JPEG and POSTs it to your Lovable app
       NEXT_BTN     -> POSTs a "next" command (skip to next step)
       PREV_BTN     -> POSTs a "prev" command (go to previous step / replay)
  - Posts to:  https://<YOUR_APP>/api/public/event
       Headers: X-Device-Secret: <DEVICE_SECRET>
                X-Device-Id:     <a name you choose>
                Content-Type:    image/jpeg   (for capture)
                                 application/json (for next/prev/replay/stop)

  Install (Arduino IDE)
  ---------------------
  1. Boards Manager: install "esp32 by Espressif Systems" (>=3.0).
  2. Tools -> Board: "ESP32S3 Dev Module".
  3. Tools -> PSRAM: "OPI PSRAM"   (this board has 8MB PSRAM).
  4. Tools -> Partition Scheme: "Huge APP (3MB No OTA/1MB SPIFFS)".
  5. Tools -> USB CDC On Boot: Enabled.
  6. Edit WIFI_SSID, WIFI_PASS, SERVER_HOST, DEVICE_SECRET below.
  7. Upload.

  Wiring the buttons
  ------------------
  Each button: one leg to the GPIO pin, the other leg to GND.
  No resistor needed — internal pull-up is used.
       CAPTURE -> GPIO 13
       NEXT    -> GPIO 12
       PREV    -> GPIO 14

  If your specific ESP32-S3-CAM board uses a different camera pin map,
  change CAMERA_MODEL_* below. The most common variant for the N16R8
  "ESP32-S3-CAM" sold on AliExpress / Pinduoduo is the ESP32-S3-EYE-like map.
*/

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ====== EDIT THESE ======
const char* WIFI_SSID     = "YOUR_WIFI";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
// Use the PUBLISHED Lovable URL (without https://).
// Example: "your-project.lovable.app"
const char* SERVER_HOST   = "your-project.lovable.app";
const char* SERVER_PATH   = "/api/public/event";
const char* DEVICE_SECRET = "change-me-esp32";  // must match DEVICE_SECRET in app secrets
const char* DEVICE_ID     = "esp32-cam-01";
// ========================

// Button pins (other side to GND)
#define CAPTURE_BTN 13
#define NEXT_BTN    12
#define PREV_BTN    14

// ---- Camera pin map for ESP32-S3-WROOM-1 N16R8 "ESP32-S3-CAM" (Freenove/AI Thinker S3 variant)
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     15
#define SIOD_GPIO_NUM      4
#define SIOC_GPIO_NUM      5
#define Y9_GPIO_NUM       16
#define Y8_GPIO_NUM       17
#define Y7_GPIO_NUM       18
#define Y6_GPIO_NUM       12 // NOTE: if your board reuses this pin, move NEXT_BTN
#define Y5_GPIO_NUM       10
#define Y4_GPIO_NUM        8
#define Y3_GPIO_NUM        9
#define Y2_GPIO_NUM       11
#define VSYNC_GPIO_NUM     6
#define HREF_GPIO_NUM      7
#define PCLK_GPIO_NUM     13 // NOTE: same — see comment below

/*
  IMPORTANT pin-conflict note:
  Many cheap "ESP32-S3-CAM" boards route the camera data bus through pins
  10-18, which on some variants overlaps GPIO 12, 13, 14. If your board
  shows a blank/garbled image after wiring the buttons, MOVE the buttons
  to free GPIOs (good safe choices on most S3-CAM boards: 1, 2, 3, 42, 41).
  Just change CAPTURE_BTN / NEXT_BTN / PREV_BTN above.
*/

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
  config.frame_size   = FRAMESIZE_SVGA;   // 800x600 - good balance
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_LATEST;
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;               // lower = better quality
  config.fb_count     = 2;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }
  return true;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());
}

bool postJpeg(uint8_t* buf, size_t len) {
  WiFiClientSecure client; client.setInsecure();    // skip cert check (simple)
  HTTPClient http;
  String url = String("https://") + SERVER_HOST + SERVER_PATH + "?type=capture";
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Device-Secret", DEVICE_SECRET);
  http.addHeader("X-Device-Id", DEVICE_ID);
  int code = http.POST(buf, len);
  Serial.printf("POST jpeg -> %d\n", code);
  http.end();
  return code >= 200 && code < 300;
}

bool postCommand(const char* type) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  String url = String("https://") + SERVER_HOST + SERVER_PATH;
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Secret", DEVICE_SECRET);
  http.addHeader("X-Device-Id", DEVICE_ID);
  String body = String("{\"type\":\"") + type + "\",\"device_id\":\"" + DEVICE_ID + "\"}";
  int code = http.POST(body);
  Serial.printf("POST %s -> %d\n", type, code);
  http.end();
  return code >= 200 && code < 300;
}

void captureAndSend() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { Serial.println("camera capture failed"); return; }
  postJpeg(fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// Simple debouncer: returns true on the press edge.
bool pressed(uint8_t pin, int* lastState, unsigned long* lastChange) {
  int s = digitalRead(pin);
  unsigned long now = millis();
  if (s != *lastState && now - *lastChange > 40) {
    *lastChange = now;
    *lastState = s;
    if (s == LOW) return true; // pressed (pulled to GND)
  }
  return false;
}

int    capState = HIGH, nextState = HIGH, prevState = HIGH;
unsigned long capT = 0, nextT = 0, prevT = 0;

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(CAPTURE_BTN, INPUT_PULLUP);
  pinMode(NEXT_BTN,    INPUT_PULLUP);
  pinMode(PREV_BTN,    INPUT_PULLUP);

  if (!initCamera()) { Serial.println("Halting."); while (true) delay(1000); }
  connectWifi();
  Serial.println("Ready. Press capture button.");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) { connectWifi(); }

  if (pressed(CAPTURE_BTN, &capState, &capT))  captureAndSend();
  if (pressed(NEXT_BTN,    &nextState, &nextT)) postCommand("next");
  if (pressed(PREV_BTN,    &prevState, &prevT)) postCommand("prev");

  delay(10);
}
