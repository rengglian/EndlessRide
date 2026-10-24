#!/usr/bin/env python3
"""
Raspberry Pi Accelerometer Bridge for Endless Ride
Reads an I2C accelerometer (MPU-6050, ADXL345, or simulated) on the Raspberry Pi
and streams real-time tilt steering values over a local WebSocket to the browser game.

Wiring on Raspberry Pi GPIO:
  - VCC  -> Pin 1 (3.3V)
  - GND  -> Pin 6 (GND)
  - SDA  -> Pin 3 (GPIO 2 / I2C1 SDA)
  - SCL  -> Pin 5 (GPIO 3 / I2C1 SCL)

Requirements:
  pip3 install websockets smbus2
"""

import asyncio
import json
import math
import sys
import argparse
import struct
import time

try:
    import websockets
except ImportError:
    print("Please install websockets: pip3 install websockets")
    sys.exit(1)

# Sensor I2C addresses
MPU6050_ADDR = 0x68
PWR_MGMT_1   = 0x6B
ACCEL_XOUT_H = 0x3B

connected_clients = set()
simulated_mode = False
bus = None

def init_mpu6050():
    global bus
    try:
        from smbus2 import SMBus
        bus = SMBus(1)
        # Wake up MPU-6050
        bus.write_byte_data(MPU6050_ADDR, PWR_MGMT_1, 0)
        print("[OK] Successfully connected to MPU-6050 on I2C bus 1 (0x68)")
        return True
    except Exception as e:
        print(f"Notice: Could not connect to physical I2C sensor ({e}).")
        return False

def read_mpu6050_raw():
    if bus is None:
        return 0.0, 0.0, 1.0
    try:
        # Read 6 bytes of accel data
        data = bus.read_i2c_block_data(MPU6050_ADDR, ACCEL_XOUT_H, 6)
        ax = (data[0] << 8) | data[1]
        ay = (data[2] << 8) | data[3]
        az = (data[4] << 8) | data[5]
        
        # Convert to 16-bit signed
        if ax > 32767: ax -= 65536
        if ay > 32767: ay -= 65536
        if az > 32767: az -= 65536

        # Convert to g (assuming +/- 2g scale: 16384 LSB/g)
        return ax / 16384.0, ay / 16384.0, az / 16384.0
    except Exception:
        return 0.0, 0.0, 1.0

# Low-pass filter state
filtered_steer = 0.0

def compute_steer(ax, ay, az):
    global filtered_steer
    # Calculate roll tilt angle around Y/Z axis in degrees
    # When tilting left/right, ax experiences gravitational deflection:
    # ax varies between -1.0g and +1.0g
    # Map +/- 35 degrees tilt to +/- 1.0 steer output
    roll_rad = math.atan2(ax, math.sqrt(ay * ay + az * az))
    roll_deg = math.degrees(roll_rad)
    
    # Max tilt angle for full steer (e.g. 28 degrees)
    max_tilt_deg = 28.0
    raw_steer = max(-1.0, min(1.0, roll_deg / max_tilt_deg))
    
    # Deadzone
    if abs(raw_steer) < 0.06:
        raw_steer = 0.0
        
    # Exponential smoothing filter (alpha = 0.35)
    filtered_steer += (raw_steer - filtered_steer) * 0.35
    return filtered_steer

# AtomS3 UDP Protocol Constants
PACKET_MAGIC = 0x4552 # 'ER' in hex
PACKET_FORMAT = "<HBBf" # uint16 magic (2B), uint8 seq (1B), uint8 restart (1B), float steer (4B) = 8 bytes
PACKET_SIZE = struct.calcsize(PACKET_FORMAT)

last_atoms3_time = 0.0

class AtomS3UDPProtocol(asyncio.DatagramProtocol):
    def connection_made(self, transport):
        self.transport = transport
        print("[OK] AtomS3 UDP receiver active for 8-byte ControllerPacket datagrams")

    def datagram_received(self, data, addr):
        global last_atoms3_time
        if len(data) == PACKET_SIZE:
            magic, seq, restart, steer = struct.unpack(PACKET_FORMAT, data)
            if magic == PACKET_MAGIC:
                last_atoms3_time = time.time()
                if connected_clients:
                    msg = json.dumps({
                        "type": "sensor",
                        "steer": round(steer, 3),
                        "seq": seq
                    })
                    for client in list(connected_clients):
                        asyncio.create_task(client.send(msg))
                    if restart:
                        btn_msg = json.dumps({
                            "type": "button",
                            "action": "restart"
                        })
                        for client in list(connected_clients):
                            asyncio.create_task(client.send(btn_msg))

async def sensor_loop():
    global filtered_steer
    sim_t = 0.0

    while True:
        # If AtomS3 wireless controller is actively streaming, yield to it
        if time.time() - last_atoms3_time < 1.0:
            await asyncio.sleep(0.02)
            continue

        if simulated_mode or bus is None:
            # Simulate a smooth steering wave for testing
            sim_t += 0.05
            ax = math.sin(sim_t * 1.5) * 0.6
            ay, az = 0.0, 0.8
        else:
            ax, ay, az = read_mpu6050_raw()

        steer = compute_steer(ax, ay, az)
        
        if connected_clients:
            msg = json.dumps({
                "type": "sensor",
                "steer": round(steer, 3),
                "accel": {
                    "x": round(ax, 3),
                    "y": round(ay, 3),
                    "z": round(az, 3)
                }
            })
            # Broadcast to all connected browser windows
            await asyncio.gather(
                *[client.send(msg) for client in connected_clients],
                return_exceptions=True
            )

        await asyncio.sleep(0.02) # 50 Hz sensor sampling

async def handle_client(websocket):
    print(f"[OK] Browser client connected: {websocket.remote_address}")
    connected_clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)
        print("Client disconnected.")

async def main():
    parser = argparse.ArgumentParser(description="Raspberry Pi Accelerometer Bridge & AtomS3 UDP Gateway")
    parser.add_argument("--simulate", action="store_true", help="Run in simulation mode without physical I2C sensor")
    parser.add_argument("--port", type=int, default=8080, help="WebSocket and UDP port (default: 8080)")
    args = parser.parse_args()

    global simulated_mode
    simulated_mode = args.simulate

    if not simulated_mode:
        has_sensor = init_mpu6050()
        if not has_sensor:
            print("Falling back to simulated sensor mode. Use --simulate to suppress warning.")
            simulated_mode = True

    # Start UDP datagram receiver for AtomS3 on the specified port
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: AtomS3UDPProtocol(),
        local_addr=("0.0.0.0", args.port)
    )

    print(f"[INFO] Starting WebSocket & UDP Sensor Bridge on 0.0.0.0:{args.port} (50 Hz)")
    print("Press Ctrl+C to stop.")

    server = await websockets.serve(handle_client, "0.0.0.0", args.port)
    try:
        await asyncio.gather(server.wait_closed(), sensor_loop())
    finally:
        transport.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nExiting sensor bridge.")
