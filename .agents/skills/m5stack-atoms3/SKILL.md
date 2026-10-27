---
name: m5stack-atoms3
description: >-
  Comprehensive guide and production implementation patterns for the M5Stack AtomS3 (SKU C126) wireless motion controller, Bosch BMI270 raw 6-axis IMU streaming, host-side complementary sensor fusion, 128x128 color LCD UI, captive portal Wi-Fi configuration, runtime target IP web dashboard, and low-latency 32-byte binary UDP datagram protocol. Use when building or tuning physical hardware controllers.
---

# M5Stack AtomS3 (C126) Wireless Motion Controller Skill

This skill documents the hardware specifications, raw 6-axis IMU streaming architecture, host-side complementary sensor fusion, 128x128 color LCD user interface, captive portal Wi-Fi onboarding, low-latency 32-byte binary UDP datagram protocol, and the future capability roadmap for the **M5Stack AtomS3 (SKU: C126)** physical motion controller in Endless Ride.

---

## 1. Hardware Specifications & Capabilities

| Component | Specification | Function in Endless Ride |
| :--- | :--- | :--- |
| **Model & SKU** | M5Stack AtomS3 (**C126**) | Miniature wireless game controller ($24 \times 24 \times 13\text{ mm}$, $13\text{g}$) |
| **SoC** | ESP32-S3-PICO-1-N8R8 (Dual-Core Xtensa LX7 @ 240 MHz, 8MB Flash, 8MB PSRAM) | 100 Hz raw IMU sampling, captive portal AP, runtime web config, and binary UDP streaming |
| **6-Axis IMU** | **Bosch BMI270** (Accuracy: 0.05% accel, 0.05°/s gyro, I2C: `0x68`) | Streams raw 3-axis linear acceleration ($a_x, a_y, a_z$) in $g$ and 3-axis angular rates ($g_x, g_y, g_z$) in $^\circ/\text{s}$ |
| **Magnetometer** | Bosch BMM150 (3-axis geomagnetic sensor) | Optional compass heading |
| **Display** | 0.85" Color IPS LCD ($128 \times 128$ resolution, GC9107 driver) | Real-time steering deflection meter, 100 Hz packet counter, local IP, target host IP, and setup mode status |
| **Button** | Front Tactile Screen Push-Button (`M5.BtnA`) | Run-time: instant restart flag; Long-press: tare calibration; Boot-time: factory reset |
| **Wireless** | 2.4 GHz Wi-Fi (802.11 b/g/n) | Ultra-low latency ($<2\text{ ms}$) 32-byte binary UDP datagram transmission to port `8080` (or `8081`) at 100 Hz |

---

## 2. Raw IMU Streaming & Host-Side Sensor Fusion

### 2.1 The Raw IMU Streaming Paradigm

Earlier prototypes calculated steering roll angles directly on the microcontroller using an 8-byte pre-computed packet format. The modern architecture transitions to **high-frequency raw 6-axis IMU streaming** at 100 Hz (10 ms period):

1. **Microcontroller Efficiency**: The ESP32-S3 firmware avoids expensive trigonometric and floating-point filtering overhead in its main loop, dedicating CPU cycles strictly to reliable Wi-Fi UDP packet delivery and display maintenance.
2. **Sub-Millisecond Temporal Fidelity**: Each packet includes an onboard monotonic microsecond timestamp (`timestamp_us` via `micros()`), enabling host-side integration with exact hardware $\Delta t$, completely immune to Wi-Fi jitter or operating system scheduling delays.
3. **Decoupled Physics & Live Tuning**: Filter coefficients, deadzones, comfort limits, and sensitivity curves can be tuned in real time inside the game engine HUD or companion web remote without needing to reflash the microcontroller.
4. **Zero-Firmware-Update Roadmap**: Having full 6-axis telemetry ($a_x, a_y, a_z, g_x, g_y, g_z$) streaming to the host allows adding advanced gestures (whip jumps, pitch-based braking, speed tucks) purely through host software updates.

---

### 2.2 Host-Side Mathematical Modeling & Filter Pipeline

The host receiver (Godot C# [`HardwareUdpReceiver.cs`](file:///home/rengglian/EndlessRide/godot/Scripts/Networking/HardwareUdpReceiver.cs) or Python [`sensor_bridge.py`](file:///home/rengglian/EndlessRide/scripts/sensor_bridge.py)) processes raw packets through the following pipeline:

#### 1. Accelerometer Roll Angle
Gravitational acceleration vector $\vec{a} = (a_x, a_y, a_z)$ in $g$-units ($1g \approx 9.81\text{ m/s}^2$) yields the tilt angle:
$$\theta_{\text{accel}} = \text{atan2}\left(a_x, \sqrt{a_y^2 + a_z^2}\right) \cdot \frac{180^\circ}{\pi}$$

#### 2. Monotonic Delta Time ($\Delta t$)
Using the packet's hardware microsecond timestamp:
$$\Delta t = \frac{t_k - t_{k-1}}{1\,000\,000} \quad (\text{seconds})$$
*Safety clamp*: If packet loss occurs or on initial connection, $\Delta t$ is clamped to $[0.005, 0.050]\text{ s}$ (nominal $0.010\text{ s}$ at 100 Hz).

#### 3. Gyroscope Roll Integration
Angular rate $g_y$ (in $^\circ/\text{s}$) along the roll axis is integrated over time:
$$\theta_{\text{gyro}} = \theta_{\text{fused}}(t - 1) + g_y \cdot \Delta t$$

#### 4. Complementary Sensor Fusion Filter
To reject linear acceleration spikes (e.g., rider arm shaking or galloping vibration) while eliminating long-term gyroscope integration drift:
$$\theta_{\text{fused}} = 0.96 \cdot \theta_{\text{gyro}} + 0.04 \cdot \theta_{\text{accel}}$$

#### 5. Dynamic Tare Calibration (Zero Offset)
When the rider mounts or presses the Tare / Zero button on the companion remote or controller:
$$\theta_{\text{cal}} = \theta_{\text{fused}} - \text{CalOffset}$$

#### 6. Linear Steering Mapping
With a maximum ergonomic comfort tilt limit $\theta_{\max} = 28^\circ$:
$$u_{\text{raw}} = \text{clamp}\left(\frac{\theta_{\text{cal}}}{\theta_{\max}}, -1.0, 1.0\right)$$

#### 7. Center Deadzone
Suppresses resting hand tremor and natural wrist wobble:
$$u_{\text{deadzone}} = \begin{cases} 0.0 & \text{if } |u_{\text{raw}}| < 0.05 \\ u_{\text{raw}} & \text{otherwise} \end{cases}$$

#### 8. Exponential Smoothing Filter (EMA)
Applied to produce buttery-smooth horse steering:
$$u_{\text{steer}}(t) = u_{\text{steer}}(t - 1) + 0.35 \cdot \left(u_{\text{deadzone}}(t) - u_{\text{steer}}(t - 1)\right)$$

---

## 3. Low-Latency Binary UDP Protocol & 32-Byte Packet Schema

To maximize responsiveness, eliminate TCP handshake / TLS / head-of-line blocking overhead, and minimize network packet size, the AtomS3 transmits packed **32-byte raw binary UDP datagrams** to host port `8080` (or `8081`) at **100 Hz**.

### 3.1 Packet Structure (`RawImuPacket`)

```cpp
#pragma pack(push, 1)
struct RawImuPacket {
  uint16_t magic;         // 0x00 (2B): Magic identifier 0x4553 ('E', 'S' for Endless Ride Sensor)
  uint8_t  seq;           // 0x02 (1B): Rolling packet sequence counter (0..255)
  uint8_t  button;        // 0x03 (1B): Button state flag (1 = restart pressed, 0 = idle)
  uint32_t timestamp_us;  // 0x04 (4B): Hardware clock timestamp from ESP32 micros()
  float    ax;            // 0x08 (4B): Linear acceleration X in g (IEEE 754 little-endian)
  float    ay;            // 0x0C (4B): Linear acceleration Y in g (IEEE 754 little-endian)
  float    az;            // 0x10 (4B): Linear acceleration Z in g (IEEE 754 little-endian)
  float    gx;            // 0x14 (4B): Angular velocity X in deg/s (IEEE 754 little-endian)
  float    gy;            // 0x18 (4B): Angular velocity Y in deg/s (IEEE 754 little-endian)
  float    gz;            // 0x1C (4B): Angular velocity Z in deg/s (IEEE 754 little-endian)
};
#pragma pack(pop)
```

### 3.2 Binary Layout Breakdown

| Offset | Field | Type | Size | Endianness | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `0x00` | `magic` | `uint16_t` | 2 bytes | Little-Endian | Magic identifier `0x4553` (`'E'`, `'S'` in ASCII; bytes: `0x53, 0x45`) |
| `0x02` | `seq` | `uint8_t` | 1 byte | Byte | Rolling sequence counter ($0 \to 255 \to 0$) for packet loss / latency tracking |
| `0x03` | `button` | `uint8_t` | 1 byte | Byte | Front screen button trigger: `1` if pressed (restart requested), `0` otherwise |
| `0x04` | `timestamp_us` | `uint32_t` | 4 bytes | Little-Endian | ESP32 hardware `micros()` clock for exact $\Delta t$ host integration |
| `0x08` | `ax` | `float32` | 4 bytes | Little-Endian | Linear acceleration X in $g$ (lateral tilt axis) |
| `0x0C` | `ay` | `float32` | 4 bytes | Little-Endian | Linear acceleration Y in $g$ (longitudinal pitch axis) |
| `0x10` | `az` | `float32` | 4 bytes | Little-Endian | Linear acceleration Z in $g$ (vertical normal axis) |
| `0x14` | `gx` | `float32` | 4 bytes | Little-Endian | Gyroscope angular rate X in $^\circ/\text{s}$ (pitch rate) |
| `0x18` | `gy` | `float32` | 4 bytes | Little-Endian | Gyroscope angular rate Y in $^\circ/\text{s}$ (roll rate) |
| `0x1C` | `gz` | `float32` | 4 bytes | Little-Endian | Gyroscope angular rate Z in $^\circ/\text{s}$ (yaw rate) |
| **Total** | | | **32 bytes** | | Compact 32-byte fixed-size payload |

---

## 4. Future Capability Roadmap Enabled by Raw IMU Data

Because full 6-axis inertial data is now transmitted to the host at 100 Hz, subsequent gameplay mechanics can be implemented entirely within host software without requiring any firmware changes:

```
                  ┌──────────────────────────────────────────────┐
                  │ 32-Byte Raw 6-Axis Stream (100 Hz @ :8080)   │
                  │   [magic: 0x4553, seq, btn, us, a_xyz, g_xyz] │
                  └──────────────────────┬───────────────────────┘
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
┌──────────────────┐           ┌──────────────────┐           ┌──────────────────┐
│ Steering Roll    │           │ Pitch Mechanics  │           │ Jerk / Whip / IK │
│ (Lateral Motion) │           │ (Speed & Brake)  │           │ (Jumps & Bursts) │
├──────────────────┤           ├──────────────────┤           ├──────────────────┤
│ • 0.96/0.04 Fuse │           │ • Pull back:     │           │ • Sudden +dAz/dt:│
│ • Deadzone 0.05  │           │   Brake/Slowdown │           │   Hurdle Jump    │
│ • 28° Limit      │           │ • Push forward:  │           │ • Forward snap:  │
│ • EMA Smoothing  │           │   Sprint Tuck    │           │   Spur Speedkick │
└──────────────────┘           └──────────────────┘           └──────────────────┘
```

### 1. Pitch-Based Speed Modulation (Braking & Aerodynamic Tuck)
* **Mechanic**: Using pitch angle $\theta_{\text{pitch}} = \text{atan2}(-a_y, a_z) \cdot \frac{180^\circ}{\pi}$ fused with $g_x$.
* **Pulling Back ($\theta_{\text{pitch}} > +20^\circ$)**: Simulates pulling back on reins to slow down or brake before dense obstacle fields.
* **Leaning Forward ($\theta_{\text{pitch}} < -20^\circ$)**: Puts the horse and rider into an aerodynamic sprint crouch, giving a temporary speed boost.

### 2. Jerk & Whip Motion Detection (Gesture Jumping & Spur Bursts)
* **Mechanic**: High-frequency jerk vector $\vec{j} = \frac{d\vec{a}}{dt}$ or peak vertical impulse $\| \Delta \vec{a} \|$.
* **Upward Flick ($\Delta a_z > +2.5g$)**: Simulates lifting the reins to command the horse to jump over hurdles without needing to reach for a button.
* **Forward Snap Impulse ($\Delta a_y > +2.0g$)**: Simulates kicking spurs or snapping reins for an instant burst of speed or obstacle evasion.

### 3. Rhythm & Gallop Cadence Matching
* **Mechanic**: Fast Fourier Transform (FFT) or zero-crossing detection on $a_y$ and $g_z$ oscillations.
* **Cadence Combo**: Detects when the player physically oscillates their hands in harmony with the horse's gallop stride frequency (3.0 – 4.5 Hz), awarding combo multipliers.

### 4. 3D Spatial Rein Kinematics
* **Mechanic**: Running a 6-axis Madgwick or Mahony filter on the host.
* **Visual Reins**: Produces full orientation quaternions $(q_w, q_x, q_y, q_z)$ to render 3D reins in first-person or cinematic camera views.

---

## 5. Captive Portal, NVS Persistence & Dynamic Web Dashboard

The controller firmware includes a captive portal for initial Wi-Fi provisioning, non-volatile storage persistence, and a runtime web server for live target IP updates.

### 1. First Boot & Setup Mode (Captive Portal)
* When no credentials exist in flash or connection fails within 8 seconds, the AtomS3 starts in **Setup Mode**.
* Creates Wi-Fi Access Point: **SSID**: `AtomS3-Setup` (Open network, 2.4 GHz).
* SoftAP Gateway IP: `192.168.4.1`.
* Embedded DNS Server (Port 53) intercepts all web requests and redirects to the setup page.
* Web Form Inputs:
  1. `SSID` (Wi-Fi network name)
  2. `Password` (Wi-Fi network password)
  3. `Pi IP` / Host IP (IP of target host PC / Raspberry Pi running Godot or Python hub, e.g. `192.168.1.50`)
* Submitting writes values to ESP32 non-volatile storage (`Preferences` under namespace `"wifi-config"`) and reboots the device into Station (STA) mode.

### 2. Runtime Web Dashboard (Target IP Reconfiguration)
* While connected in STA mode, the AtomS3 keeps an HTTP server running on port `80`.
* Navigate to `http://<atom_ip>/` or `http://<atom_ip>/set_target` from any phone or PC on the network.
* Displays current streaming destination IP and provides an instant form to update target host IP.
* Submitting immediately updates the active UDP target in RAM and saves to NVS flash without needing a reboot.

### 3. Factory Reset (Hardware Wipe)
* Hold the front screen button (`M5.BtnA`) down while powering on or pressing reset.
* The screen displays `"CLEARING SETTINGS"` in red, purges the `"wifi-config"` NVS namespace, and restarts into Setup Mode.

---

## 6. AtomS3 128x128 Color LCD User Interface

The screen is rendered via double-buffered `M5Canvas` at ~10 FPS ($100\text{ ms}$ interval, 1 frame per 10 sensor ticks) independently of the 100 Hz sensor transmission loop:

### 1. Active Gameplay Streaming Mode (2D Gimbal / Crosshair Box):
```
┌────────────────────────┐
│ ENDLESS RIDE           │  <- Cyan Title
│                        │
│      ┌──────────┐      │  <- 56x56 px Gimbal Crosshair Box
│      │    │     │      │     (X = Steering Roll, Y = Rein Pitch)
│      │────●─────│      │     Cyan indicator dot with white border
│      │    │     │      │
│      └──────────┘      │
│ S:+0.32    P:-0.15     │  <- Live Steer & Pitch Deflections
│ IP: 192.168.1.88       │  <- Local AtomS3 Wi-Fi IP
│ Target: 192.168.1.50   │  <- Active UDP target host IP (:8080)
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

---

## 7. Arduino Firmware Setup & Flashing

Firmware source: [`scripts/m5stack_atoms3_reins/m5stack_atoms3_reins.ino`](file:///home/rengglian/EndlessRide/scripts/m5stack_atoms3_reins/m5stack_atoms3_reins.ino)

### Required Libraries (Install via Arduino Library Manager):
* **`M5Unified`** (by M5Stack) — Manages the ESP32-S3, BMI270 IMU, GC9107 LCD, and screen button.
* Standard ESP32 Arduino Core headers (`WiFi.h`, `WiFiUdp.h`, `WebServer.h`, `DNSServer.h`, `Preferences.h`).

### Arduino IDE Board Settings:
* **Board**: `M5Stack-AtomS3` (or `ESP32S3 Dev Module`)
* **USB CDC On Boot**: `Enabled` (required for serial flashing & monitoring)
* **Flash Size**: `8MB (64Mb)`
* **Partition Scheme**: `Default 4MB with spiffs (1.2MB APP / 1.5MB SPIFFS)` or `8MB with SPIFFS`
* **Upload Speed**: `921600`

---

## 8. Host Receiver Integration & Unpacking Examples

### 8.1 Godot 4 C# Receiver (`HardwareUdpReceiver.cs`)

```csharp
private void ProcessPacket(byte[] data, IPEndPoint remoteEndPoint)
{
    if (data.Length < 32) return;

    // 1. Verify Magic Identifier (0x4553 = 'E', 'S')
    ushort magic = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(0, 2));
    if (magic != 0x4553) return;

    // 2. Unpack Header & Telemetry
    byte seq = data[2];
    byte button = data[3];
    uint timestampUs = BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(4, 4));
    float ax = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(8, 4));
    float ay = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(12, 4));
    float az = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(16, 4));
    float gx = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(20, 4));
    float gy = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(24, 4));
    float gz = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(28, 4));

    // 3. Compute Delta Time (seconds)
    float dt = (_lastTimestampUs > 0) ? (timestampUs - _lastTimestampUs) * 1e-6f : 0.01f;
    dt = Mathf.Clamp(dt, 0.005f, 0.05f);
    _lastTimestampUs = timestampUs;

    // 4. Complementary Filter (0.96 * Gyro + 0.04 * Accel)
    float accelRoll = Mathf.RadToDeg(Mathf.Atan2(ax, Mathf.Sqrt(ay * ay + az * az)));
    _fusedRoll = 0.96f * (_fusedRoll + gy * dt) + 0.04f * accelRoll;

    // 5. Zero-Tare & Steer Mapping
    float calRoll = _fusedRoll - CalOffset;
    float steer = Mathf.Clamp(calRoll / 28.0f, -1.0f, 1.0f);
    if (Mathf.Abs(steer) < 0.05f) steer = 0.0f;
    CalibratedSteer = Mathf.Lerp(CalibratedSteer, steer, 0.35f);
}
```

### 8.2 Python Host Bridge Receiver (`sensor_bridge.py`)

```python
import struct
import math

PACKET_MAGIC = 0x4553  # 'ES' in hex
PACKET_FORMAT = "<HBB I fff fff"  # 32 bytes packed
PACKET_SIZE = struct.calcsize(PACKET_FORMAT)

def handle_datagram(data):
    if len(data) < PACKET_SIZE:
        return
    
    magic, seq, btn, timestamp_us, ax, ay, az, gx, gy, gz = struct.unpack(PACKET_FORMAT, data[:PACKET_SIZE])
    if magic != PACKET_MAGIC:
        return

    # Calculate delta time
    global last_us, fused_roll
    dt = (timestamp_us - last_us) * 1e-6 if last_us else 0.01
    dt = max(0.005, min(0.050, dt))
    last_us = timestamp_us

    # Complementary filter: 0.96 * Gyro + 0.04 * Accel
    accel_roll = math.degrees(math.atan2(ax, math.sqrt(ay * ay + az * az)))
    fused_roll = 0.96 * (fused_roll + gy * dt) + 0.04 * accel_roll

    # Tare and deadzone
    steer_raw = max(-1.0, min(1.0, (fused_roll - cal_offset) / 28.0))
    steer_dz = 0.0 if abs(steer_raw) < 0.05 else steer_raw
```
