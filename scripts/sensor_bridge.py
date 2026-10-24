#!/usr/bin/env python3
"""
Raspberry Pi Game & Sensor Hub for Endless Ride
Serves as the central coordination hub connecting:
1. Physical Tilt Hardware (M5Stack AtomS3 UDP @ 50 Hz & Raspberry Pi I2C MPU-6050)
2. TV/Browser Client (Three.js WebGL game running on TV / NVIDIA Shield / PC)
3. Smartphone Companion Remote (public/remote.html served via HTTP on :8080/remote)
4. Persistent Room State, Difficulty Presets, Balance Board Tare, and Top-10 Leaderboard (scripts/leaderboard.json)

Wiring on Raspberry Pi GPIO (Optional wired MPU-6050):
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
import os
import argparse
import struct
import time
import http
import urllib.parse
import mimetypes

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

# Steering & Calibration State
last_raw_steer = 0.0
filtered_steer = 0.0
last_atoms3_time = 0.0
last_restart_state = 0

# AtomS3 UDP Protocol Constants
PACKET_MAGIC = 0x4552 # 'ER' in hex
PACKET_FORMAT = "<HBBf" # uint16 magic (2B), uint8 seq (1B), uint8 restart (1B), float steer (4B) = 8 bytes
PACKET_SIZE = struct.calcsize(PACKET_FORMAT)

# Persistent State File
STATE_FILE = os.environ.get(
    "LEADERBOARD_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "leaderboard.json")
)

# Static file paths for HTTP serving
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(REPO_ROOT, "dist")
PUBLIC_DIR = os.path.join(REPO_ROOT, "public")

MIME_MAP = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".gltf": "application/json; charset=utf-8",
    ".glb": "application/octet-stream",
    ".bin": "application/octet-stream",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
}

def get_content_type(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    if ext in MIME_MAP:
        return MIME_MAP[ext]
    guessed, _ = mimetypes.guess_type(file_path)
    return guessed or "application/octet-stream"

def find_static_file(clean_path):
    """
    Locates static file in dist/ first, falling back to public/ or repo root.
    Enforces path traversal protection.
    """
    rel_path = clean_path.lstrip("/")

    # Search candidates in priority order:
    # 1. dist/ (production build)
    # 2. public/ (source assets and remote.html)
    # 3. repo root (index.html if unbundled)
    search_dirs = [DIST_DIR, PUBLIC_DIR]
    if rel_path == "index.html":
        search_dirs.append(REPO_ROOT)

    for base_dir in search_dirs:
        if not os.path.isdir(base_dir):
            continue
        candidate = os.path.join(base_dir, rel_path)
        real_base = os.path.realpath(base_dir)
        real_candidate = os.path.realpath(candidate)

        # Ensure target is within base_dir and is a regular file
        if (real_candidate == real_base or real_candidate.startswith(real_base + os.sep)) and os.path.isfile(real_candidate):
            return real_candidate

    return None

DEFAULT_STATE = {
    "playerName": "Rider 1",
    "players": ["Rider 1", "Alex", "Sam", "Kids"],
    "difficulty": "standard",
    "sensitivity": 1.0,
    "calOffset": 0.0,
    "gameState": "START",
    "liveStats": {
        "score": 0,
        "distance": 0,
        "multiplier": 1.0
    },
    "leaderboard": []
}

state = dict(DEFAULT_STATE)

def load_state():
    global state
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    for k, v in DEFAULT_STATE.items():
                        state[k] = data.get(k, v)
            print(f"[OK] Loaded room state from {STATE_FILE} ({len(state.get('leaderboard', []))} leaderboard entries)")
            return
        except Exception as e:
            print(f"[WARN] Failed to read {STATE_FILE} ({e}); using defaults.")
    save_state()

def save_state():
    try:
        os.makedirs(os.path.dirname(os.path.abspath(STATE_FILE)), exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"[WARN] Failed to save state to {STATE_FILE}: {e}")

def get_room_state_dict():
    return {
        "type": "room_state",
        "playerName": state.get("playerName", "Rider 1"),
        "players": state.get("players", ["Rider 1"]),
        "difficulty": state.get("difficulty", "standard"),
        "sensitivity": float(state.get("sensitivity", 1.0)),
        "calOffset": float(state.get("calOffset", 0.0)),
        "gameState": state.get("gameState", "START"),
        "liveStats": state.get("liveStats", {"score": 0, "distance": 0, "multiplier": 1.0}),
        "leaderboard": state.get("leaderboard", [])
    }

def get_room_state_json():
    return json.dumps(get_room_state_dict())

def broadcast_room_state():
    if connected_clients:
        msg = get_room_state_json()
        websockets.broadcast(connected_clients, msg)

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
        data = bus.read_i2c_block_data(MPU6050_ADDR, ACCEL_XOUT_H, 6)
        ax = (data[0] << 8) | data[1]
        ay = (data[2] << 8) | data[3]
        az = (data[4] << 8) | data[5]

        if ax > 32767: ax -= 65536
        if ay > 32767: ay -= 65536
        if az > 32767: az -= 65536

        return ax / 16384.0, ay / 16384.0, az / 16384.0
    except Exception:
        return 0.0, 0.0, 1.0

def compute_steer(ax, ay, az):
    global filtered_steer
    roll_rad = math.atan2(ax, math.sqrt(ay * ay + az * az))
    roll_deg = math.degrees(roll_rad)
    max_tilt_deg = 28.0
    raw = max(-1.0, min(1.0, roll_deg / max_tilt_deg))
    if abs(raw) < 0.06:
        raw = 0.0
    filtered_steer += (raw - filtered_steer) * 0.35
    return filtered_steer

def apply_calibration(raw_val):
    cal = state.get("calOffset", 0.0)
    sens = state.get("sensitivity", 1.0)
    return max(-1.0, min(1.0, (raw_val - cal) * sens))

class AtomS3UDPProtocol(asyncio.DatagramProtocol):
    def connection_made(self, transport):
        self.transport = transport
        print("[OK] AtomS3 UDP receiver active for 8-byte ControllerPacket datagrams")

    def datagram_received(self, data, addr):
        global last_atoms3_time, last_restart_state, last_raw_steer
        if len(data) == PACKET_SIZE:
            magic, seq, restart, steer = struct.unpack(PACKET_FORMAT, data)
            if magic == PACKET_MAGIC:
                last_atoms3_time = time.monotonic()
                last_raw_steer = steer
                calibrated = apply_calibration(steer)

                if connected_clients:
                    msg = json.dumps({
                        "type": "sensor",
                        "steer": round(calibrated, 3),
                        "rawSteer": round(last_raw_steer, 3),
                        "calOffset": round(state.get("calOffset", 0.0), 3),
                        "seq": seq
                    })
                    websockets.broadcast(connected_clients, msg)

                    # Edge-detect restart flag across repeated UDP packets
                    if restart and not last_restart_state:
                        btn_msg = json.dumps({
                            "type": "button",
                            "action": "start_or_restart"
                        })
                        websockets.broadcast(connected_clients, btn_msg)

                last_restart_state = restart

async def sensor_loop():
    global filtered_steer, last_raw_steer
    sim_t = 0.0

    while True:
        # If AtomS3 wireless controller is actively streaming, yield to it
        if time.monotonic() - last_atoms3_time < 1.0:
            await asyncio.sleep(0.02)
            continue

        if simulated_mode:
            sim_t += 0.05
            ax = math.sin(sim_t * 1.5) * 0.6
            ay, az = 0.0, 0.8
            raw_s = compute_steer(ax, ay, az)
        elif bus is not None:
            ax, ay, az = read_mpu6050_raw()
            raw_s = compute_steer(ax, ay, az)
        else:
            await asyncio.sleep(0.05)
            continue

        last_raw_steer = raw_s
        calibrated = apply_calibration(raw_s)

        if connected_clients:
            msg = json.dumps({
                "type": "sensor",
                "steer": round(calibrated, 3),
                "rawSteer": round(last_raw_steer, 3),
                "calOffset": round(state.get("calOffset", 0.0), 3),
                "accel": {
                    "x": round(ax, 3),
                    "y": round(ay, 3),
                    "z": round(az, 3)
                }
            })
            websockets.broadcast(connected_clients, msg)

        await asyncio.sleep(0.02) # 50 Hz sensor sampling

async def handle_client(websocket):
    global last_raw_steer
    remote_addr = getattr(websocket, "remote_address", "client")
    print(f"[OK] Client connected: {remote_addr}")
    connected_clients.add(websocket)

    # Send initial room state immediately upon connection
    try:
        await websocket.send(get_room_state_json())
    except Exception as e:
        print(f"[WARN] Failed to send initial room state: {e}")

    try:
        async for raw_message in websocket:
            try:
                msg = json.loads(raw_message)
                mtype = msg.get("type")

                if mtype == "get_state":
                    await websocket.send(get_room_state_json())

                elif mtype == "select_player":
                    name = str(msg.get("playerName", "")).strip()[:18]
                    if name:
                        state["playerName"] = name
                        if name not in state["players"]:
                            state["players"].append(name)
                        save_state()
                        broadcast_room_state()

                elif mtype == "set_config":
                    diff = msg.get("difficulty")
                    if diff in ("relaxed", "standard", "pro"):
                        state["difficulty"] = diff

                    sens = msg.get("sensitivity")
                    if isinstance(sens, (int, float)):
                        state["sensitivity"] = round(max(0.5, min(1.8, float(sens))), 2)

                    save_state()
                    broadcast_room_state()

                elif mtype == "calibrate":
                    # Zero / Tare balance board at current raw tilt angle
                    state["calOffset"] = round(max(-0.8, min(0.8, last_raw_steer)), 3)
                    save_state()
                    broadcast_room_state()
                    print(f"[CALIBRATE] Balance board zero set to offset {state['calOffset']:.3f}")

                elif mtype == "reset_calibration":
                    state["calOffset"] = 0.0
                    save_state()
                    broadcast_room_state()
                    print("[CALIBRATE] Balance board calibration reset to 0.0")

                elif mtype == "command":
                    action = msg.get("action")
                    if action in ("start_or_restart", "pause", "resume", "restart", "force_restart"):
                        cmd_msg = json.dumps({"type": "button", "action": action})
                        websockets.broadcast(connected_clients, cmd_msg)
                        print(f"[CMD] Broadcasted action: {action}")

                elif mtype == "game_state":
                    gstate = msg.get("state")
                    if gstate:
                        state["gameState"] = gstate
                    stats = msg.get("liveStats")
                    if isinstance(stats, dict):
                        state["liveStats"] = {
                            "score": int(stats.get("score", 0)),
                            "distance": int(stats.get("distance", 0)),
                            "multiplier": float(stats.get("multiplier", 1.0))
                        }
                    else:
                        state["liveStats"] = {
                            "score": int(msg.get("score", state["liveStats"].get("score", 0))),
                            "distance": int(msg.get("distance", state["liveStats"].get("distance", 0))),
                            "multiplier": float(msg.get("multiplier", state["liveStats"].get("multiplier", 1.0)))
                        }
                    broadcast_room_state()

                elif mtype == "submit_score":
                    pname = str(msg.get("playerName", state["playerName"])).strip()[:18] or "Rider"
                    score = int(msg.get("score", 0))
                    distance = int(msg.get("distance", 0))
                    diff = str(msg.get("difficulty", state["difficulty"]))

                    # Keep top 10 highest scores sorted descending
                    state["leaderboard"].append({
                        "name": pname,
                        "score": score,
                        "distance": distance,
                        "difficulty": diff
                    })
                    state["leaderboard"].sort(key=lambda x: x["score"], reverse=True)
                    state["leaderboard"] = state["leaderboard"][:10]
                    save_state()
                    broadcast_room_state()
                    print(f"[LEADERBOARD] Recorded score for {pname}: {score} pts ({distance} m)")

            except Exception as ex:
                print(f"[WARN] Error handling client message: {ex}")
    finally:
        connected_clients.discard(websocket)
        print(f"Client disconnected: {remote_addr}")

def process_http_request(*args, **kwargs):
    """
    HTTP request processor for websockets.serve on port 8080.
    1. Distinguishes WebSocket upgrade requests (Upgrade: websocket) and returns None
       so websockets can complete the WebSocket handshake.
    2. For regular HTTP requests:
       - Maps / -> /index.html (3D WebGL Game)
       - Maps /remote -> /remote.html (Smartphone Companion Remote)
       - Serves static assets from dist/ (or public/) with correct MIME types.
       - Returns 404 Not Found if file does not exist.
    Supports both legacy (path, request_headers) and modern (connection, request) websockets signatures.
    """
    try:
        path = None
        request_headers = None
        connection = None
        request = None

        if len(args) >= 2:
            arg0, arg1 = args[0], args[1]
            if isinstance(arg0, str):
                # Legacy websockets <= 12: (path, request_headers)
                path = arg0
                request_headers = arg1
            elif hasattr(arg1, "path"):
                # Modern websockets >= 13: (connection, request)
                connection = arg0
                request = arg1
                path = getattr(request, "path", None)
                request_headers = getattr(request, "headers", None)
            elif hasattr(arg0, "path"):
                request = arg0
                path = getattr(request, "path", None)
                request_headers = getattr(request, "headers", None)
        elif len(args) == 1:
            arg0 = args[0]
            if isinstance(arg0, str):
                path = arg0
            elif hasattr(arg0, "path"):
                request = arg0
                path = getattr(request, "path", None)
                request_headers = getattr(request, "headers", None)

        if not path and "path" in kwargs:
            path = kwargs["path"]
        if not request_headers and "request_headers" in kwargs:
            request_headers = kwargs["request_headers"]
        elif not request_headers and "headers" in kwargs:
            request_headers = kwargs["headers"]

        # Check for WebSocket Upgrade header: if present, hand off to WebSocket handshake
        upgrade = ""
        if hasattr(request_headers, "get"):
            upgrade = request_headers.get("Upgrade") or request_headers.get("upgrade") or ""
        elif isinstance(request_headers, (list, tuple)):
            for k, v in request_headers:
                if str(k).lower() == "upgrade":
                    upgrade = v
                    break

        if str(upgrade).lower() == "websocket":
            return None

        # Handle regular HTTP GET/HEAD requests
        if path is not None:
            clean_path = urllib.parse.unquote(path.split("?")[0])
            if clean_path in ("", "/"):
                clean_path = "/index.html"
            elif clean_path in ("/remote", "/remote/"):
                clean_path = "/remote.html"

            target_file = find_static_file(clean_path)

            if target_file and os.path.isfile(target_file):
                content_type = get_content_type(target_file)
                with open(target_file, "rb") as f:
                    body = f.read()

                headers = [
                    ("Content-Type", content_type),
                    ("Content-Length", str(len(body))),
                    ("Connection", "close"),
                    ("Access-Control-Allow-Origin", "*")
                ]

                if connection and hasattr(connection, "respond"):
                    try:
                        return connection.respond(http.HTTPStatus.OK, body, headers=headers)
                    except TypeError:
                        return connection.respond(http.HTTPStatus.OK, body)
                return (http.HTTPStatus.OK, headers, body)
            else:
                body = b"404 Not Found\n"
                headers = [
                    ("Content-Type", "text/plain; charset=utf-8"),
                    ("Content-Length", str(len(body))),
                    ("Connection", "close")
                ]
                if connection and hasattr(connection, "respond"):
                    try:
                        return connection.respond(http.HTTPStatus.NOT_FOUND, body, headers=headers)
                    except TypeError:
                        return connection.respond(http.HTTPStatus.NOT_FOUND, body)
                return (http.HTTPStatus.NOT_FOUND, headers, body)

    except Exception as e:
        print(f"[HTTP] Error in process_http_request: {e}")

    # Fallback return None
    return None

async def main():
    parser = argparse.ArgumentParser(description="Raspberry Pi Game & Sensor Hub for Endless Ride")
    parser.add_argument("--simulate", action="store_true", help="Run in simulation mode without physical I2C sensor")
    parser.add_argument("--port", type=int, default=8080, help="WebSocket and UDP port (default: 8080)")
    args = parser.parse_args()

    global simulated_mode
    simulated_mode = args.simulate

    # Load persistent room state and leaderboard
    load_state()

    if not simulated_mode:
        has_sensor = init_mpu6050()
        if not has_sensor:
            print("[INFO] No physical I2C sensor detected and --simulate not set. Listening for AtomS3 UDP packets.")

    # Start UDP datagram receiver for AtomS3 on the specified port
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: AtomS3UDPProtocol(),
        local_addr=("0.0.0.0", args.port)
    )

    print(f"[INFO] Starting Endless Ride Game Hub & WebSocket on 0.0.0.0:{args.port}")
    print(f"[INFO] Endless Ride Web Game accessible at: http://<pi-ip>:{args.port}/")
    print(f"[INFO] Smartphone Remote App accessible at: http://<pi-ip>:{args.port}/remote")
    print("Press Ctrl+C to stop.")

    # Wrap process_request safely for websockets.serve
    try:
        server = await websockets.serve(
            handle_client,
            "0.0.0.0",
            args.port,
            process_request=process_http_request
        )
    except TypeError:
        # Fallback if process_request is not supported in an older websockets version
        server = await websockets.serve(
            handle_client,
            "0.0.0.0",
            args.port
        )

    try:
        await asyncio.gather(server.wait_closed(), sensor_loop())
    finally:
        transport.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nExiting sensor bridge.")
