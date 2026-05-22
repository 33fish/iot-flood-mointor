#include <WiFi.h>
#include <HTTPClient.h>

// ─── Pin definitions ────────────────────────────────────────
#define PIN_WATER_TTL   25
#define PIN_TRIG        13
#define PIN_ECHO        14
#define PIN_LED_GREEN    4
#define PIN_LED_RED     17
#define PIN_BUZZER      19

// ─── Timing ─────────────────────────────────────────────────
#define CHECK_INTERVAL      3000
#define SENSOR_ECHO_TIMEOUT 25000

// ─── WiFi / Supabase ────────────────────────────────────────
const char* WIFI_SSID    = "zzhnb666";
const char* WIFI_PASS    = "zzh666666";
const char* SUPABASE_URL = "https://cbmleqcqohvaqelsbwuc.supabase.co";
const char* SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNibWxlcWNxb2h2YXFlbHNid3VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNzgwMzYsImV4cCI6MjA5NDc1NDAzNn0.sYdbPsT1w3gocZlW6_pqazdKCbsun2cNStWe9Uiz8cg";

// ─── Runtime state ──────────────────────────────────────────
float    installHeight         = 25.0f;
float    levelWarn             = 1.0f;
float    levelCritical         = 2.0f;
int      sensorErrorThreshold  = 3;

bool     waterDetected         = false;
bool     ultrasonicActive      = false;
float    lastWaterLevel        = -1.0f;
int      consecutiveEchoFails  = 0;
bool     sensorErrorState      = false;
unsigned long lastCheckTime    = 0;

// ─── Helpers ────────────────────────────────────────────────

void beep(int times, int onMs = 300, int offMs = 200) {
  for (int i = 0; i < times; i++) {
    digitalWrite(PIN_LED_RED, HIGH);
    digitalWrite(PIN_BUZZER,  HIGH);
    delay(onMs);
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_BUZZER,  LOW);
    if (i < times - 1) delay(offMs);
  }
}

void beepLong() {
  digitalWrite(PIN_LED_RED, HIGH);
  digitalWrite(PIN_BUZZER,  HIGH);
  delay(1200);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_BUZZER,  LOW);
}

void blinkLed(int pin, unsigned long& lastT, bool& state, unsigned long interval = 400) {
  unsigned long now = millis();
  if (now - lastT > interval) {
    lastT = now;
    state = !state;
    digitalWrite(pin, state);
  }
}

// ─── WiFi ───────────────────────────────────────────────────

void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected — IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Failed — running offline");
  }
}

// ─── Supabase helpers ───────────────────────────────────────

String supabaseGet(const char* path) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  http.begin(String(SUPABASE_URL) + path);
  http.addHeader("apikey",        SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  int code = http.GET();
  String body = (code == 200) ? http.getString() : "";
  http.end();
  return body;
}

bool supabasePost(const char* path, const String& json) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(SUPABASE_URL) + path);
  http.addHeader("Content-Type",  "application/json");
  http.addHeader("apikey",        SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  int code = http.POST(json);
  http.end();
  return code == 201;
}

bool supabasePatch(const char* path, const String& json) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String(SUPABASE_URL) + path);
  http.addHeader("Content-Type",  "application/json");
  http.addHeader("apikey",        SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  int code = http.PATCH(json);
  http.end();
  return (code == 200 || code == 204);
}

// ─── Config ─────────────────────────────────────────────────

float jsonFloat(const String& json, const char* key, float fallback) {
  String search = String("\"") + key + "\":";
  int idx = json.indexOf(search);
  if (idx < 0) return fallback;
  idx += search.length();
  while (idx < (int)json.length() && (json[idx] == ' ' || json[idx] == '"')) idx++;
  return json.substring(idx).toFloat();
}

int jsonInt(const String& json, const char* key, int fallback) {
  float v = jsonFloat(json, key, (float)fallback);
  return (int)v;
}

void loadConfig() {
  Serial.println("[Config] Loading from Supabase...");
  String body = supabaseGet("/rest/v1/config?id=eq.1&select=*");
  if (body.length() < 5) {
    Serial.println("[Config] Failed or empty — using defaults");
    return;
  }
  levelWarn            = jsonFloat(body, "level_warn",             levelWarn);
  levelCritical        = jsonFloat(body, "level_critical",         levelCritical);
  installHeight        = jsonFloat(body, "install_height",         installHeight);
  sensorErrorThreshold = jsonInt  (body, "sensor_error_threshold", sensorErrorThreshold);

  Serial.printf("[Config] warn=%.1f cm  critical=%.1f cm  height=%.1f cm  errorThresh=%d\n",
                levelWarn, levelCritical, installHeight, sensorErrorThreshold);
}

void writeInstallHeight(float height) {
  String json = "{\"install_height\":" + String(height, 1) + "}";
  bool ok = supabasePatch("/rest/v1/config?id=eq.1", json);
  Serial.printf("[Config] install_height=%.1f cm written — %s\n", height, ok ? "OK" : "FAIL");
}

// ─── Ultrasonic ─────────────────────────────────────────────

float measureDistance() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  long us = pulseIn(PIN_ECHO, HIGH, SENSOR_ECHO_TIMEOUT);
  if (us == 0) return -1.0f;
  return us * 0.0343f / 2.0f;
}

float measureDistanceStable() {
  float s[3];
  int valid = 0;
  for (int i = 0; i < 3; i++) {
    float d = measureDistance();
    if (d > 0) s[valid++] = d;
    delay(60);
  }
  if (valid == 0) return -1.0f;
  if (valid == 1) return s[0];
  if (s[0] > s[1]) { float t = s[0]; s[0] = s[1]; s[1] = t; }
  if (valid == 2)  return (s[0] + s[1]) / 2.0f;
  if (s[1] > s[2]) { float t = s[1]; s[1] = s[2]; s[2] = t; }
  if (s[0] > s[1]) { float t = s[0]; s[0] = s[1]; s[1] = t; }
  return s[1];
}

// ─── Readings upload ────────────────────────────────────────

void postReading(float waterLevel, float distance, const char* state, bool rising, bool ultrasonicError) {
  String json = "{\"water_level\":"      + String(waterLevel, 1)  +
                ",\"distance\":"         + String(distance, 1)    +
                ",\"alarm\":"            + (strcmp(state,"safe") != 0 ? "true" : "false") +
                ",\"state\":\""          + state                  + "\"" +
                ",\"rising\":"           + (rising ? "true" : "false") +
                ",\"ultrasonic_error\":" + (ultrasonicError ? "true" : "false") +
                "}";
  bool ok = supabasePost("/rest/v1/readings", json);
  Serial.printf("[Upload] state=%s rising=%d error=%d — %s\n",
                state, rising, ultrasonicError, ok ? "OK" : "FAIL");
}

// ─── Sensor error handling ──────────────────────────────────

void handleSensorError() {
  sensorErrorState = true;
  Serial.println("[ERROR] Ultrasonic sensor lost");

  // Green off — power indicator extinguished on fault
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED,   HIGH);
  beepLong();

  float reportLevel = (lastWaterLevel >= 0.0f) ? lastWaterLevel : 0.0f;
  Serial.printf("[ERROR] Last known water level: %.1f cm\n", reportLevel);
  postReading(reportLevel, 0.0f, "sensor_error", false, true);

  Serial.println("[ERROR] System halted. Power cycle required.");
  while (true) {
    delay(5000);
    beepLong();
  }
}

// ─── Sleep ──────────────────────────────────────────────────

void goToSleep() {
  Serial.println("[Sleep] Dry — entering deep sleep, wake on water sensor HIGH");
  Serial.flush();
  lastWaterLevel = -1.0f;
  digitalWrite(PIN_LED_GREEN, HIGH);   // green steady = power on / standby
  digitalWrite(PIN_LED_RED,   LOW);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_WATER_TTL, HIGH);
  esp_deep_sleep_start();
}

// ─── Boot self-test ─────────────────────────────────────────

void selfTest() {
  Serial.println("[Self-test] Starting...");

  digitalWrite(PIN_LED_RED, HIGH);
  delay(300);
  digitalWrite(PIN_LED_RED, LOW);

  Serial.println("[Self-test] Measuring install height (3 samples, median)...");
  float dist = measureDistanceStable();

  if (dist > 0) {
    installHeight = dist;
    Serial.printf("[Self-test] Install height: %.1f cm\n", installHeight);
    writeInstallHeight(installHeight);
    beep(1);
  } else {
    Serial.printf("[Self-test] No echo — using config height: %.1f cm\n", installHeight);
    beep(2, 150, 100);
  }

  Serial.println("[Self-test] Done");
}

// ─── Setup ──────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(PIN_WATER_TTL, INPUT);
  pinMode(PIN_LED_GREEN,  OUTPUT);
  pinMode(PIN_LED_RED,    OUTPUT);
  pinMode(PIN_BUZZER,     OUTPUT);
  pinMode(PIN_TRIG,       OUTPUT);
  pinMode(PIN_ECHO,       INPUT);

  // Green on immediately — power indicator
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_RED,   LOW);
  digitalWrite(PIN_BUZZER,    LOW);
  digitalWrite(PIN_TRIG,      LOW);

  connectWiFi();
  loadConfig();

  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();

  if (cause == ESP_SLEEP_WAKEUP_EXT0) {
    Serial.println("\n====== Woke up: water detected! ======");
    digitalWrite(PIN_LED_GREEN, HIGH);   // ensure green stays on after wake
    waterDetected    = true;
    ultrasonicActive = true;
    lastCheckTime    = millis() - CHECK_INTERVAL;
    beep(2);
  } else {
    Serial.println("\n====== Smart Flood Sentinel starting ======");
    selfTest();

    bool currentWet = (digitalRead(PIN_WATER_TTL) == HIGH);
    if (!currentWet) {
      goToSleep();
    }
    waterDetected    = true;
    ultrasonicActive = true;
    lastCheckTime    = millis() - CHECK_INTERVAL;
    beep(2);
  }

  Serial.println("===========================================\n");
}

// ─── Loop ───────────────────────────────────────────────────

void loop() {
  static unsigned long blinkRedT = 0;
  static bool          blinkRedS = false;

  unsigned long now = millis();

  if (now - lastCheckTime >= CHECK_INTERVAL) {
    lastCheckTime = now;

    bool currentWet = (digitalRead(PIN_WATER_TTL) == HIGH);
    Serial.println("---------- Cycle ----------");
    Serial.printf("[Water sensor] %s\n", currentWet ? "WET" : "DRY");

    if (!currentWet) {
      digitalWrite(PIN_LED_RED, LOW);
      Serial.println("[OK] Water gone — sleeping");
      goToSleep();
    }

    if (currentWet && !waterDetected) {
      waterDetected        = true;
      ultrasonicActive     = true;
      lastWaterLevel       = -1.0f;
      consecutiveEchoFails = 0;
      Serial.println("[Alert] Water first detected");
      postReading(0, 0, "warning", false, false);
      beep(2);
    }

    if (ultrasonicActive) {
      float dist = measureDistanceStable();

      if (dist < 0) {
        consecutiveEchoFails++;
        Serial.printf("[Ultrasonic] No echo (%d/%d)\n", consecutiveEchoFails, sensorErrorThreshold);
        if (consecutiveEchoFails >= sensorErrorThreshold) {
          handleSensorError();
        }
      } else {
        consecutiveEchoFails = 0;

        float wl = max(0.0f, installHeight - dist);
        Serial.printf("[Ultrasonic] dist=%.1f cm  level=%.1f cm\n", dist, wl);

        const char* state;
        if      (wl >= levelCritical)           state = "critical";
        else if (wl >= levelWarn || currentWet) state = "warning";
        else                                    state = "safe";

        bool rising = (lastWaterLevel >= 0.0f && (wl - lastWaterLevel) > 0.5f);

        if (strcmp(state, "critical") == 0) {
          beep(3);
        } else if (rising) {
          beep(2);
        } else if (lastWaterLevel < 0.0f) {
          beep(2);
        }

        postReading(wl, dist, state, rising, false);
        lastWaterLevel = wl;
      }
    }

    Serial.println();
  }

  // Red blinks as alert indicator while water present and sensor healthy
  // Green is a steady power indicator — never blinked
  if (waterDetected && !sensorErrorState) {
    blinkLed(PIN_LED_RED, blinkRedT, blinkRedS, 400);
  }
}
