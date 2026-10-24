---
name: m5stack-atoms3
description: >-
  Comprehensive guide and production implementation patterns for the M5Stack AtomS3 (SKU C126) wireless motion controller, Bosch BMI270 6-axis IMU tilt steering, 128x128 color LCD UI, captive portal Wi-Fi configuration, runtime target IP web dashboard, and low-latency binary UDP streaming. Use when building or tuning physical hardware controllers.
---

# M5Stack AtomS3 (C126) Wireless Motion Controller Skill

This skill documents the hardware specifications, IMU mathematical tilt modeling, low-pass filtering, 128x128 color LCD user interface, captive portal Wi-Fi onboarding, and low-latency binary UDP datagram protocol for using the **M5Stack AtomS3 (SKU: C126)** as a wireless motion controller for Endless Ride.

---

## 1. Hardware Specifications & Capabilities

| Component | Specification | Function in Endless Ride |
| :--- | :--- | :--- |
| **Model & SKU** | M5Stack AtomS3 (**C126**) | Miniature wireless game controller ($24 \times 24 \times 13\text{ mm}$, $13\text{g}$) |
| **SoC** | ESP32-S3-PICO-1-N8R8 (Dual-Core Xtensa LX7 @ 240 MHz, 8MB Flash, 8MB PSRAM) | 50 Hz IMU processing, captive portal AP, runtime web config, and UDP streaming |
| **6-Axis IMU** | **Bosch BMI270** (Accuracy: 0.05% accel, 0.05°/s gyro, I2C: `0x68`) | Real-time lateral tilt angle measurement |
| **Magnetometer** | Bosch BMM150 (3-axis geomagnetic sensor) | Optional compass heading |
| **Display** | 0.85" Color IPS LCD ($128 \times 128$ resolution, GC9107 driver) | Real-time steering meter, local IP, target host IP, and setup mode status |
| **Button** | Front Tactile Screen Push-Button (`M5.BtnA`) | Run-time: instant restart flag; Boot-time: factory reset |
| **Wireless** | 2.4 GHz Wi-Fi (802.11 b/g/n) | Low-latency ($<2\text{ ms}$) binary UDP datagram transmission to port `8080` |

---

## 2. IMU Mathematical Modeling & Tilt Steering

The AtomS3 measures gravitational acceleration vector $\vec{a} = (a_x, a_y, a_z)$ in $g$-units ($1g \approx 9.81\text{ m/s}^2$) via `M5.Imu.getAccel(&ax, &ay, &az)`.

### 1. Roll Angle Calculation:
When tilting the AtomS3 left or right:
$$\theta_{\text{roll}} = \text{atan2}\left(a_x, \sqrt{a_y^2 + a_z^2}\right) \cdot \frac{180^\circ}{\pi}$$

### 2. Linear Steering Mapping:
With a maximum comfort tilt range $\theta_{\max} = 28^\circ$:
$$u_{\text{raw}} = \text{clamp}\left(\frac{\theta_{\text{roll}}}{\theta_{\max}}, -1.0, 1.0\right)$$

### 3. Center Deadzone:
To prevent involuntary wrist tremors or resting hand jitter from drifting the horse:
$$u_{\text{deadzone}} = \begin{cases} 0.0 & \text{if } |u_{\text{raw}}| < 0.05 \\ u_{\text{raw}} & \text{otherwise} \end{cases}$$

### 4. Exponential Smoothing Filter:
At $50\text{ Hz}$ sampling interval ($T_s = 20\text{ ms}$), apply an exponential moving average (EMA) filter ($\alpha = 0.35$):
$$u_{\text{filtered}}(t) = u_{\text{filtered}}(t - 1) + \alpha \cdot \left(u_{\text{deadzone}}(t) - u_{\text{filtered}}(t - 1)\right)$$

---

## 3. Low-Latency Binary UDP Protocol & Packet Schema

To maximize responsiveness and eliminate TCP / WebSocket handshake overhead and head-of-line blocking, the AtomS3 transmits packed **8-byte binary UDP datagrams** directly to `piIP:8080` at $50\text{ Hz}$.

### Packet Structure (`ControllerPacket`)
```cpp
#pragma pack(push, 1)
struct ControllerPacket {
  uint16_t magic;    // 2 bytes: Identifier 0x4552 ('E', 'R' for Endless Ride)
  uint8_t  seq;      // 1 byte:  Rolling sequence counter (0-255)
  uint8_t  restart;  // 1 byte:  Button action flag (0 or 1)
  float    steer;    // 4 bytes: IEEE 754 float (-1.0 to 1.0, little-endian)
};
#pragma pack(pop)
```

### Binary Layout Breakdown

| Offset | Field | Type | Size | Description |
| :--- | :--- | :--- | :--- | :--- |
| `0x00` | `magic` | `uint16_t` | 2 bytes | Magic identifier `0x4552` (`'E'`, `'R'` in ASCII, little-endian: `0x52, 0x45`) |
| `0x02` | `seq` | `uint8_t` | 1 byte | Rolling packet sequence counter ($0 \to 255 \to 0$) |
| `0x03` | `restart` | `uint8_t` | 1 byte | Action trigger: `1` if screen button was clicked, `0` otherwise |
| `0x04` | `steer` | `float` | 4 bytes | Standard IEEE 754 32-bit float in $[-1.0, 1.0]$ |
| **Total** | | | **8 bytes** | Exactly 8 bytes per datagram payload |

### Why UDP Datagrams Over WebSocket:
1. **Zero Connection State**: The controller can be power-cycled or roam without socket reconnect stalls.
2. **Sub-millisecond Jitter**: Packets are sent as single MTU frames with no TCP ACK delays or Nagle algorithm buffering.
3. **Graceful Loss Recovery**: Any dropped sample is instantly replaced 20ms later by fresh sensor telemetry.

---

## 4. Captive Portal, NVS Persistence & Dynamic Web Dashboard

The controller firmware includes a captive portal for initial provisioning, flash-backed configuration, and a runtime web server for on-the-fly target IP updates.

### 1. First Boot & Setup Mode (Captive Portal)
* When no credentials exist in flash or connection fails within 8 seconds, the AtomS3 starts in **Setup Mode**.
* Creates Wi-Fi Access Point: **SSID**: `AtomS3-Setup` (Open network).
* SoftAP Gateway IP: `192.168.4.1`.
* Embedded DNS Server (Port 53) intercepts all web requests and redirects to the setup page (`PORTAL_HTML`).
* Web Form Inputs:
  1. `SSID` (Wi-Fi network name)
  2. `Password` (Wi-Fi network password)
  3. `Pi IP` (IP of target Raspberry Pi / host PC running the bridge, e.g. `192.168.1.50`)
* Submitting the form writes values to ESP32 non-volatile storage (`Preferences` under namespace `"wifi-config"`) and reboots the device into STA mode.

### 2. Runtime Web Dashboard (Target IP Reconfiguration)
* While connected in STA mode, the AtomS3 keeps an HTTP server running on port `80`.
* Navigate to `http://<atom_ip>/` or `http://<atom_ip>/set_target` from any phone or PC on the network.
* Displays current streaming destination IP and provides an instant form to update `pi_ip`.
* Submitting POST `/save_target` immediately updates the active UDP target in RAM and saves to NVS flash without needing a reboot.

### 3. Factory Reset (Hardware Wipe)
* Hold the front screen button (`M5.BtnA`) down while powering on or pressing reset.
* The screen displays `"CLEARING SETTINGS"` in red, purges the `"wifi-config"` NVS namespace, and restarts into Setup Mode.

---

## 5. AtomS3 128x128 Color LCD User Interface

The screen is rendered via double-buffered `M5Canvas` at ~10 FPS ($100\text{ ms}$ interval):

### 1. Active Gameplay Streaming Mode:
```
┌────────────────────────┐
│ ENDLESS RIDE (UDP)     │  <- Cyan Title
│                        │
│ ┌─────────┬──────────┐ │
│ │    [■■■■│        ] │ │  <- Dynamic Steering Deflection Meter (Cyan)
│ └─────────┴──────────┘ │     (White center zero line, dark grey border)
│ STEER: -0.42           │  <- Live numeric steer value
│                        │
│ My IP:  192.168.1.88   │  <- Local AtomS3 Wi-Fi IP
│ Target: 192.168.1.50   │  <- Active UDP target host IP
└────────────────────────┘
```

### 2. Captive Portal / Setup Screen:
```
┌────────────────────────┐
│ SETUP MODE             │  <- Yellow Title
│                        │
│ Join Wi-Fi:            │
│ AtomS3-Setup           │  <- Cyan SSID
│                        │
│ Go to browser:         │
│ 192.168.4.1            │  <- White Gateway IP
└────────────────────────┘
```

### 3. Factory Reset Screen:
```
┌────────────────────────┐
│                        │
│                        │
│   CLEARING SETTINGS    │  <- Red text on black
│                        │
│                        │
└────────────────────────┘
```

---

## 6. Arduino Firmware Setup & Flashing

Firmware source: [`scripts/m5stack_atoms3_reins/m5stack_atoms3_reins.ino`](file:///home/rengglian/repos/EndlessRide/scripts/m5stack_atoms3_reins/m5stack_atoms3_reins.ino)

### Required Libraries (Install via Arduino Library Manager):
* **`M5Unified`** (by M5Stack) — Manages the ESP32-S3, BMI270 IMU, GC9107 LCD, and screen button.
* *Note*: All networking headers (`WiFi.h`, `WiFiUdp.h`, `WebServer.h`, `DNSServer.h`, `Preferences.h`) are built into the standard `esp32` board core package. No external WebSocket or JSON libraries are required.

### Arduino IDE Board Settings:
* **Board**: `M5Stack-AtomS3` (or `ESP32S3 Dev Module`)
* **USB CDC On Boot**: `Enabled` (required for serial flashing & monitoring)
* **Flash Size**: `8MB (64Mb)`
* **Partition Scheme**: `Default 4MB with spiffs (1.2MB APP / 1.5MB SPIFFS)` or `8MB with SPIFFS`
* **Upload Speed**: `921600`

---

## 7. Host Bridge & Game Integration Architecture

Because standard browser JavaScript environments cannot open raw UDP sockets directly, `scripts/sensor_bridge.py` on the target host (Raspberry Pi or PC) acts as the bridge:

```
┌──────────────────┐    8-byte UDP (Port 8080)     ┌───────────────────────┐   WebSocket JSON (ws://)  ┌──────────────────┐
│  M5Stack AtomS3  │ ───────────────────────────> │ scripts/sensor_bridge │ ────────────────────────> │ Browser Three.js │
│ (BMI270 50Hz IMU)│   [0x4552, seq, rst, steer]   │   (Python UDP -> WS)  │    {"steer": -0.42}       │   (Endless Ride) │
└──────────────────┘                               └───────────────────────┘                           └──────────────────┘
```

1. **Host Bridge (`scripts/sensor_bridge.py`)**:
   * Listens on UDP port `8080`.
   * Unpacks the 8-byte `ControllerPacket` (`struct.unpack('<HBBf', data)`).
   * Forwards steer updates (`{"type": "sensor", "steer": steer}`) and restart clicks (`{"type": "button", "action": "restart"}`) over WebSocket to connected browsers.
2. **Browser Client (`src/input/InputManager.ts`)**:
   * Connects to `ws://<host>:8080` (or `?sensor=<host>`).
   * Seamlessly routes `steer` to horse lateral locomotion and button action directly to game restart.
