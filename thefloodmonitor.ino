#include <WiFi.h>
#include <HTTPClient.h>

#define PIN_WATER_TTL  25
#define PIN_TRIG       13
#define PIN_ECHO       14
#define PIN_LED_GREEN   4
#define PIN_LED_RED    17
#define PIN_BUZZER     19

#define CHECK_INTERVAL  3000
#define INSTALL_HEIGHT  50.0f

const char* WIFI_SSID     = "zzhnb666";
const char* WIFI_PASS     = "zzh666666";
const char* SUPABASE_URL  = "https://cbmleqcqohvaqelsbwuc.supabase.co/rest/v1/readings";
const char* SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNibWxlcWNxb2h2YXFlbHNid3VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNzgwMzYsImV4cCI6MjA5NDc1NDAzNn0.sYdbPsT1w3gocZlW6_pqazdKCbsun2cNStWe9Uiz8cg";

bool  waterDetected    = false;
bool  ultrasonicActive = false;
float lastDistance     = -1.0f;
float lastWaterLevel   = -1.0f;
int   alarmCount       = 0;
unsigned long lastCheckTime = 0;

float measureDistance() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  long us = pulseIn(PIN_ECHO, HIGH, 25000);
  if (us == 0) {
    Serial.println("  [Ultrasonic] No echo");
    return -1.0f;
  }
  return us * 0.0343f / 2.0f;
}

void beep(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(PIN_LED_RED, HIGH);
    digitalWrite(PIN_BUZZER, HIGH);
    delay(300);
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_BUZZER, LOW);
    if (i < times - 1) delay(200);
  }
}

void blinkRed() {
  static unsigned long t = 0;
  static bool s = false;
  if (millis() - t > 400) {
    t = millis(); s = !s;
    digitalWrite(PIN_LED_RED, s);
  }
}

void blinkGreen() {
  static unsigned long t = 0;
  static bool s = false;
  if (millis() - t > 400) {
    t = millis(); s = !s;
    digitalWrite(PIN_LED_GREEN, s);
  }
}

void postToSupabase(float waterLevel, float distance, bool alarm) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(SUPABASE_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  String body = "{\"water_level\":" + String(waterLevel, 1) +
                ",\"distance\":"    + String(distance, 1) +
                ",\"alarm\":"       + (alarm ? "true" : "false") + "}";

  int code = http.POST(body);
  Serial.printf("[Upload] HTTP %d\n", code);
  http.end();
}

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
    Serial.printf("\n[WiFi] Connected, IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Failed, running offline");
  }
}

void goToSleep() {
  Serial.println("[Sleep] No water detected, entering deep sleep...");
  Serial.flush();
  lastWaterLevel = -1.0f;
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_RED,   LOW);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_WATER_TTL, HIGH);
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(PIN_WATER_TTL, INPUT);
  pinMode(PIN_LED_GREEN,  OUTPUT);
  pinMode(PIN_LED_RED,    OUTPUT);
  pinMode(PIN_BUZZER,     OUTPUT);
  pinMode(PIN_TRIG,       OUTPUT);
  pinMode(PIN_ECHO,       INPUT);

  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_RED,   LOW);
  digitalWrite(PIN_BUZZER,    LOW);
  digitalWrite(PIN_TRIG,      LOW);

  connectWiFi();

  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  if (cause == ESP_SLEEP_WAKEUP_EXT0) {
    Serial.println("\n====== Woke up by water sensor! ======");
    waterDetected    = true;
    ultrasonicActive = true;
    lastCheckTime    = millis() - CHECK_INTERVAL;
    beep(2);
  } else {
    Serial.println("\n====== Flood Alert System Starting ======");
    Serial.println("[Self-test] Green LED on");
    beep(1);
    Serial.println("[Self-test] Done");

    bool currentWet = (digitalRead(PIN_WATER_TTL) == HIGH);
    if (!currentWet) {
      goToSleep();
    }
    lastCheckTime = millis() - CHECK_INTERVAL;
  }

  Serial.println("=========================================\n");
}

void loop() {
  unsigned long now = millis();

  if (now - lastCheckTime >= CHECK_INTERVAL) {
    lastCheckTime = now;

    bool currentWet = (digitalRead(PIN_WATER_TTL) == HIGH);

    Serial.println("---------- Cycle Check ----------");
    Serial.printf("[Water] %s\n", currentWet ? "Water detected!" : "Dry");

    if (currentWet && !waterDetected) {
      waterDetected    = true;
      ultrasonicActive = true;
      lastDistance     = -1.0f;
      lastWaterLevel   = -1.0f;
      Serial.println("[Alert] Water first detected, starting ultrasonic");
      postToSupabase(0, 0, false);
      beep(2);
    }

    if (!currentWet && waterDetected) {
      digitalWrite(PIN_LED_RED, LOW);
      Serial.println("[OK] Water gone, returning to sleep");
      goToSleep();
    }

    if (!currentWet && !waterDetected) {
      goToSleep();
    }

    if (ultrasonicActive) {
      float dist = measureDistance();
      if (dist > 0) {
        float wl = max(0.0f, INSTALL_HEIGHT - dist);
        Serial.printf("[Ultrasonic] Distance=%.1f cm  Water level=%.1f cm\n", dist, wl);

        bool alarm = false;
        if (currentWet) {
          if (lastWaterLevel < 0.0f) {
            lastWaterLevel = wl;
            alarm = true;
            alarmCount++;
            Serial.printf("[ALARM] Water detected! Level=%.1f cm (count: %d)\n", wl, alarmCount);
            beep(2);
          } else if (wl - lastWaterLevel > 0.0f) {
            alarm = true;
            alarmCount++;
            Serial.printf("[ALARM] Water rising! %.1f cm (count: %d)\n", wl, alarmCount);
            beep(3);
            lastWaterLevel = wl;
          } else {
            lastWaterLevel = wl;
          }
        }

        postToSupabase(wl, dist, alarm);
        lastDistance = dist;
      }
    }

    Serial.println();
  }

  if (waterDetected) {
    blinkRed();
    blinkGreen();
  }
}