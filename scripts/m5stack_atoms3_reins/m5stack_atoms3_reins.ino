#include <M5Unified.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>

Preferences prefs;
DNSServer dnsServer;
WebServer server(80);
WiFiUDP udp;
M5Canvas canvas(&M5.Display);

const byte DNS_PORT = 53;
const IPAddress apIP(192, 168, 4, 1);
const uint16_t udpPort = 8080;

IPAddress piIP;
bool configMode = false;

// Binary packet structure (32 bytes total)
#pragma pack(push, 1)
struct ControllerPacket {
  uint16_t magic;        // 2 bytes: Identifier 0x4553 ('E', 'S' for Endless Ride Sensor, little-endian 0x53, 0x45)
  uint8_t  seq;          // 1 byte:  Rolling sequence counter (0-255)
  uint8_t  button;       // 1 byte:  Button action flag (1 if restart pressed, 0 otherwise)
  uint32_t timestamp_us; // 4 bytes: Microsecond timestamp from micros()
  float    ax;           // 4 bytes: Accelerometer X in g (IEEE 754 float)
  float    ay;           // 4 bytes: Accelerometer Y in g (IEEE 754 float)
  float    az;           // 4 bytes: Accelerometer Z in g (IEEE 754 float)
  float    gx;           // 4 bytes: Gyroscope X in deg/s (IEEE 754 float)
  float    gy;           // 4 bytes: Gyroscope Y in deg/s (IEEE 754 float)
  float    gz;           // 4 bytes: Gyroscope Z in deg/s (IEEE 754 float)
};
#pragma pack(pop)
static_assert(sizeof(ControllerPacket) == 32, "ControllerPacket must be exactly 32 bytes");

const uint16_t PACKET_MAGIC = 0x4553; // 'ES' in hex
uint8_t packetSeq = 0;

float rollOffsetDeg = 0.0f;
float pitchOffsetDeg = 0.0f;
float fusedRollDeg = 0.0f;
float fusedPitchDeg = 0.0f;
float filteredSteer = 0.0f;
float filteredPitch = 0.0f;
unsigned long lastSampleTime = 0;
unsigned long lastWifiCheckTime = 0;
unsigned long btnPressStartTime = 0;
bool isCalibrating = false;
uint8_t restartPacketsRemaining = 0;

// HTML Portal with Pi IP input
const char PORTAL_HTML[] = R"rawliteral(
<!DOCTYPE html><html>
<head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AtomS3 Setup</title>
<style>
body{font-family:sans-serif;text-align:center;padding:16px;background:#121212;color:#fff;}
input{width:88%;max-width:320px;padding:12px;margin:8px 0;border-radius:4px;border:none;box-sizing:border-box;font-size:16px;}
button{width:88%;max-width:320px;padding:14px;margin-top:12px;background:#00bcd4;color:#000;font-weight:bold;font-size:16px;border:none;border-radius:4px;}
</style></head>
<body>
<h2>Controller Setup</h2>
<form action="/save" method="POST">
<input type="text" name="ssid" placeholder="Wi-Fi SSID" required><br>
<input type="password" name="pass" placeholder="Wi-Fi Password"><br>
<input type="text" name="pi_ip" placeholder="Pi IP (e.g. 192.168.1.50)" required><br>
<button type="submit">Save & Reboot</button>
</form></body></html>
)rawliteral";

void handleSave() {
  String newSSID = server.arg("ssid");
  String newPass = server.arg("pass");
  String newPiIP = server.arg("pi_ip");

  prefs.begin("wifi-config", false);
  prefs.putString("ssid", newSSID);
  prefs.putString("pass", newPass);
  prefs.putString("pi_ip", newPiIP);
  prefs.end();

  server.send(200, "text/html", "<h3>Saved! AtomS3 is connecting...</h3>");
  delay(1500);
  ESP.restart();
}

void startCaptivePortal() {
  configMode = true;

  canvas.fillSprite(TFT_BLACK);
  canvas.setTextColor(TFT_YELLOW);
  canvas.drawString("SETUP MODE", 6, 8);
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString("Join Wi-Fi:", 6, 32);
  canvas.setTextColor(TFT_CYAN);
  canvas.drawString("AtomS3-Setup", 6, 48);
  canvas.setTextColor(TFT_LIGHTGREY);
  canvas.drawString("Go to browser:", 6, 76);
  canvas.drawString("192.168.4.1", 6, 92);
  canvas.pushSprite(0, 0);

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));
  WiFi.softAP("AtomS3-Setup");

  dnsServer.start(DNS_PORT, "*", apIP);

  server.on("/", HTTP_GET, []() {
    server.send(200, "text/html", PORTAL_HTML);
  });
  server.on("/save", HTTP_POST, handleSave);
  server.onNotFound([]() {
    server.send(200, "text/html", PORTAL_HTML);
  });

  server.begin();
}

void drawUI(float steer, float pitch) {
  canvas.fillSprite(TFT_BLACK);
  canvas.setTextSize(1);
  canvas.setTextColor(TFT_CYAN);
  canvas.drawString("ENDLESS RIDE", 6, 6);

  // 2D Gimbal / Crosshair Box (56x56 px, centered at X=64, Y=48)
  const int boxX = 36, boxY = 20, boxSize = 56;
  const int cx = 64, cy = 48;
  const int range = 24;

  canvas.drawRect(boxX, boxY, boxSize, boxSize, TFT_DARKGREY);
  canvas.drawFastHLine(boxX + 3, cy, boxSize - 6, TFT_DARKGREY);
  canvas.drawFastVLine(cx, boxY + 3, boxSize - 6, TFT_DARKGREY);
  canvas.drawCircle(cx, cy, 3, TFT_DARKGREY);

  // Position indicator dot (X = steering roll, Y = rein pitch: pull back/upwards = dot up)
  int dotX = cx + (int)(steer * range);
  int dotY = cy - (int)(pitch * range);
  dotX = constrain(dotX, boxX + 4, boxX + boxSize - 5);
  dotY = constrain(dotY, boxY + 4, boxY + boxSize - 5);

  canvas.fillCircle(dotX, dotY, 4, TFT_CYAN);
  canvas.drawCircle(dotX, dotY, 4, TFT_WHITE);

  // Numeric deflection readouts
  canvas.setTextColor(TFT_WHITE);
  canvas.setCursor(6, 82);
  canvas.printf("S:%+.2f   P:%+.2f", steer, pitch);

  // Connection info footer
  canvas.setTextColor(TFT_LIGHTGREY);
  canvas.setCursor(4, 98);
  canvas.printf("IP: %s", WiFi.localIP().toString().c_str());
  canvas.setCursor(4, 112);
  canvas.printf("Target: %s", piIP.toString().c_str());

  canvas.pushSprite(0, 0);
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);

  canvas.createSprite(128, 128);

  // Factory reset trigger: Hold screen button down during power-on
  M5.update();
  if (M5.BtnA.isPressed()) {
    canvas.fillSprite(TFT_BLACK);
    canvas.setTextColor(TFT_RED);
    canvas.drawString("CLEARING SETTINGS", 6, 56);
    canvas.pushSprite(0, 0);

    prefs.begin("wifi-config", false);
    prefs.clear();
    prefs.end();
    delay(1500);
  }

  // Read saved settings
  prefs.begin("wifi-config", true);
  String savedSSID = prefs.getString("ssid", "");
  String savedPass = prefs.getString("pass", "");
  String savedPiIP = prefs.getString("pi_ip", "");
  rollOffsetDeg    = prefs.getFloat("roll_offset", 0.0f);
  pitchOffsetDeg   = prefs.getFloat("pitch_offset", 0.0f);
  prefs.end();

  // Validate credentials and IP address
  if (savedSSID.length() == 0 || !piIP.fromString(savedPiIP)) {
    startCaptivePortal();
    return;
  }

  canvas.fillSprite(TFT_BLACK);
  canvas.setTextColor(TFT_YELLOW);
  canvas.drawString("CONNECTING...", 8, 40);
  canvas.setTextColor(TFT_WHITE);
  canvas.drawString(savedSSID.c_str(), 8, 60);
  canvas.pushSprite(0, 0);

  WiFi.mode(WIFI_STA);
  WiFi.begin(savedSSID.c_str(), savedPass.c_str());

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 8000) {
    delay(200);
  }

  // If connection fails, launch captive portal
  if (WiFi.status() != WL_CONNECTED) {
    startCaptivePortal();
    return;
  }

  auto sendTargetForm = []() {
    String html = "<!DOCTYPE html><html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                  "<style>body{background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding:24px;}"
                  "input{padding:12px;width:80%;max-width:260px;border-radius:4px;border:none;font-size:16px;text-align:center;}"
                  "button{padding:12px 24px;margin-top:16px;background:#00bcd4;color:#000;font-weight:bold;font-size:16px;border:none;border-radius:4px;}"
                  "</style></head><body>"
                  "<h2>Change Target IP</h2>"
                  "<p style=\"color:#888;\">Current: " + piIP.toString() + "</p>"
                  "<form action=\"/save_target\" method=\"POST\">"
                  "<input type=\"text\" name=\"pi_ip\" value=\"" + piIP.toString() + "\" required><br>"
                  "<button type=\"submit\">Update Target</button>"
                  "</form></body></html>";
    server.send(200, "text/html", html);
  };
  server.on("/", HTTP_GET, sendTargetForm);
  server.on("/set_target", HTTP_GET, sendTargetForm);
  
  server.on("/save_target", HTTP_POST, []() {
    String newIPStr = server.arg("pi_ip");
    IPAddress newIP;
    if (newIP.fromString(newIPStr)) {
      piIP = newIP; // Updates the active destination immediately
      
      // Persist to NVS flash so it survives reboots
      prefs.begin("wifi-config", false);
      prefs.putString("pi_ip", newIPStr);
      prefs.end();

      String resp = "<!DOCTYPE html><html><body style=\"background:#121212;color:#4caf50;font-family:sans-serif;text-align:center;padding:40px;\">"
                    "<h2>Updated!</h2>"
                    "<p style=\"color:#fff;\">Streaming UDP to <b>" + newIPStr + "</b></p>"
                    "<a href=\"/\" style=\"color:#00bcd4;\">&larr; Back</a>"
                    "</body></html>";
      server.send(200, "text/html", resp);
    } else {
      server.send(400, "text/html", "<h3 style=\"color:red;\">Invalid IP format. Example: 192.168.1.50</h3>");
    }
  });

  server.begin();
  udp.begin(udpPort);
}

void loop() {
  if (configMode) {
    dnsServer.processNextRequest();
    server.handleClient();
    return;
  }

  server.handleClient();
  M5.update();

  unsigned long now = millis();

  // Reconnect Wi-Fi if connection drops
  if (now - lastWifiCheckTime >= 5000) {
    lastWifiCheckTime = now;
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
    }
  }

  // Button handling: short press = restart (x4 packets), long press (>1.2s) = calibrate neutral
  if (M5.BtnA.wasPressed()) {
    btnPressStartTime = now;
    isCalibrating = false;
  }
  if (M5.BtnA.isPressed()) {
    if (!isCalibrating && (now - btnPressStartTime >= 1200)) {
      isCalibrating = true;
      rollOffsetDeg = fusedRollDeg;
      pitchOffsetDeg = fusedPitchDeg;
      prefs.begin("wifi-config", false);
      prefs.putFloat("roll_offset", rollOffsetDeg);
      prefs.putFloat("pitch_offset", pitchOffsetDeg);
      prefs.end();

      canvas.fillSprite(TFT_BLACK);
      canvas.setTextColor(TFT_GREEN);
      canvas.drawString("ZERO CALIBRATED", 10, 56);
      canvas.pushSprite(0, 0);
      delay(600);
    }
  }
  if (M5.BtnA.wasReleased()) {
    if (!isCalibrating) {
      restartPacketsRemaining = 8; // ~80ms at 100 Hz
    }
    isCalibrating = false;
  }

  if (now - lastSampleTime >= 10) { // 100 Hz sampling and streaming loop (10ms)
    float dt = (now - lastSampleTime) * 0.001f;
    lastSampleTime = now;

    float ax = 0, ay = 0, az = 0;
    float gx = 0, gy = 0, gz = 0;
    M5.Imu.getAccel(&ax, &ay, &az);
    M5.Imu.getGyro(&gx, &gy, &gz);

    uint8_t restartFlag = 0;
    if (restartPacketsRemaining > 0) {
      restartFlag = 1;
      restartPacketsRemaining--;
    }

    // 32-byte binary UDP packet with raw 6-axis IMU data
    ControllerPacket pkt;
    pkt.magic        = PACKET_MAGIC;
    pkt.seq          = packetSeq++;
    pkt.button       = restartFlag;
    pkt.timestamp_us = micros();
    pkt.ax           = ax;
    pkt.ay           = ay;
    pkt.az           = az;
    pkt.gx           = gx;
    pkt.gy           = gy;
    pkt.gz           = gz;

    udp.beginPacket(piIP, udpPort);
    udp.write((const uint8_t*)&pkt, sizeof(pkt));
    udp.endPacket();

    // Local roll (steering) estimation solely for on-device 128x128 LCD UI gimbal
    float accelRollRad = atan2(ax, sqrt(ay * ay + az * az));
    float accelRollDeg = accelRollRad * 180.0f / PI;
    float gyroRollRate = gy; // Y-axis gyro in deg/s
    fusedRollDeg = 0.98f * (fusedRollDeg + gyroRollRate * dt) + 0.02f * accelRollDeg;
    float calibratedRoll = fusedRollDeg - rollOffsetDeg;
    float rawSteer = constrain(calibratedRoll / 28.0f, -1.0f, 1.0f);
    if (fabsf(rawSteer) < 0.05f) rawSteer = 0.0f;
    filteredSteer += (rawSteer - filteredSteer) * 0.35f;

    // Local pitch (reins pull/slack) estimation solely for on-device 128x128 LCD UI gimbal
    float accelPitchRad = atan2(ay, sqrt(ax * ax + az * az));
    float accelPitchDeg = accelPitchRad * 180.0f / PI;
    float gyroPitchRate = gx; // X-axis gyro in deg/s
    fusedPitchDeg = 0.98f * (fusedPitchDeg + gyroPitchRate * dt) + 0.02f * accelPitchDeg;
    float calibratedPitch = fusedPitchDeg - pitchOffsetDeg;
    float rawPitch = constrain(calibratedPitch / 28.0f, -1.0f, 1.0f);
    if (fabsf(rawPitch) < 0.05f) rawPitch = 0.0f;
    filteredPitch += (rawPitch - filteredPitch) * 0.35f;

    static int screenCounter = 0;
    if (++screenCounter >= 10) { // ~10 FPS UI updates (every 100ms)
      screenCounter = 0;
      drawUI(filteredSteer, filteredPitch);
    }
  }
}
