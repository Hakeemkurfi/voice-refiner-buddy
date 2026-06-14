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

// ====== EDIT THESE ======
const char* WIFI_SSID     = "Hakeem";
const char* WIFI_PASS     = "10000000";
// Your PUBLISHED Lovable host — host only, no https://, no trailing slash.
const char* SERVER_HOST   = "voice-refiner-buddy.lovable.app";
const char* SERVER_PATH   = "/api/public/event";
const char* DEVICE_SECRET = "";              // endpoint is open right now — leave ""
const char* DEVICE_ID     = "esp32-cam-01";
// ========================

// Button pins — chosen so they DO NOT collide with the camera bus.
// Your camera uses: 4,5,6,7,8,9,10,11,12,13,15,16,17,18.
// Safe free GPIOs on this board: 1, 2, 3, 14, 21, 38-42.
#define CAPTURE_BTN 1
#define NEXT_BTN    2
#define PREV_BTN    3

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
  config.xclk_freq_hz = 20000000;
  config.frame_size   = FRAMESIZE_SVGA;        // 800x600 — good for AI vision
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_LATEST;
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;                     // lower number = better quality
  config.fb_count     = 2;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) { Serial.printf("Camera init failed: 0x%x\n", err); return false; }

  // Optional: a touch more saturation + auto white balance
  sensor_t* s = esp_camera_sensor_get();
  if (s) { s->set_brightness(s, 0); s->set_saturation(s, 0); }
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

bool postJpeg(uint8_t* buf, size_t len) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  String url = String("https://") + SERVER_HOST + SERVER_PATH + "?type=capture";
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "image/jpeg");
  if (strlen(DEVICE_SECRET) > 0) http.addHeader("X-Device-Secret", DEVICE_SECRET);
  http.addHeader("X-Device-Id", DEVICE_ID);
  int code = http.POST(buf, len);
  Serial.printf("POST jpeg (%u bytes) -> %d\n", (unsigned)len, code);
  http.end();
  return code >= 200 && code < 300;
}

bool postCommand(const char* type) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  String url = String("https://") + SERVER_HOST + SERVER_PATH;
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_SECRET) > 0) http.addHeader("X-Device-Secret", DEVICE_SECRET);
  http.addHeader("X-Device-Id", DEVICE_ID);
  String body = String("{\"type\":\"") + type + "\",\"device_id\":\"" + DEVICE_ID + "\"}";
  int code = http.POST(body);
  Serial.printf("POST %s -> %d\n", type, code);
  http.end();
  return code >= 200 && code < 300;
}

void captureAndSend() {
  // throw away one stale frame so we get a fresh exposure
  camera_fb_t* fb = esp_camera_fb_get(); if (fb) esp_camera_fb_return(fb);
  fb = esp_camera_fb_get();
  if (!fb) { Serial.println("camera capture failed"); return; }
  postJpeg(fb->buf, fb->len);
  esp_camera_fb_return(fb);
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
  Serial.println("Ready. Press the CAPTURE button.");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) { connectWifi(); delay(500); return; }
  if (pressed(CAPTURE_BTN, &capState,  &capT))  captureAndSend();
  if (pressed(NEXT_BTN,    &nextState, &nextT)) postCommand("next");
  if (pressed(PREV_BTN,    &prevState, &prevT)) postCommand("prev");
  delay(10);
}
