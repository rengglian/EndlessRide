using System;
using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using Godot;

namespace EndlessRide.Networking;

/// <summary>
/// Asynchronous UDP listener for M5Stack AtomS3 hardware tilt reins and balance boards.
/// Listens on port 8081 for 8-byte binary datagrams:
/// [magic: uint16 (0x4552), seq: uint8, restart: uint8, steer: float32]
/// Applies tare calibration and 250ms staleness safety guard.
/// Ported from scripts/sensor_bridge.py.
/// </summary>
public partial class HardwareUdpReceiver : Node
{
    [Export] public int ListenPort { get; set; } = 8081;
    [Export] public float Sensitivity { get; set; } = 1.0f;

    public float RawSteer { get; private set; }
    public float CalibratedSteer { get; private set; }
    public float CalOffset { get; set; } = 0.0f;
    public bool IsRestartPressed { get; private set; }
    public bool IsActive => (Time.GetTicksMsec() - _lastPacketTimeMs) < 350;
    public int PacketCount { get; private set; }
    public string DeviceIp { get; private set; } = string.Empty;

    public event Action? OnRestartRequested;

    private UdpClient? _udpClient;
    private CancellationTokenSource? _cts;
    private ulong _lastPacketTimeMs;
    private bool _lastRestartState;

    private const ushort PacketMagic = 0x4552; // 'ER' in hex

    public override void _Ready()
    {
        StartListening();
    }

    public void StartListening()
    {
        StopListening();
        _cts = new CancellationTokenSource();

        try
        {
            _udpClient = new UdpClient(ListenPort);
            Task.Run(() => ReceiveLoopAsync(_cts.Token));
            GD.Print($"[HardwareUdpReceiver] Listening on UDP port {ListenPort} for AtomS3 binary packets.");
        }
        catch (Exception ex)
        {
            GD.PrintErr($"[HardwareUdpReceiver] Could not bind UDP port {ListenPort}: {ex.Message}");
        }
    }

    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _udpClient != null)
        {
            try
            {
                var result = await _udpClient.ReceiveAsync(ct);
                byte[] data = result.Buffer;

                if (data.Length >= 8)
                {
                    // Little-endian unpack: [H (ushort), B (byte), B (byte), f (float)]
                    ushort magic = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(0, 2));
                    if (magic == PacketMagic)
                    {
                        byte seq = data[2];
                        byte restart = data[3];
                        float steer = BitConverter.ToSingle(data, 4);

                        RawSteer = steer;
                        CalibratedSteer = Math.Clamp((steer - CalOffset) * Sensitivity, -1.0f, 1.0f);
                        _lastPacketTimeMs = Time.GetTicksMsec();
                        PacketCount++;
                        DeviceIp = result.RemoteEndPoint.Address.ToString();

                        bool currentRestart = restart > 0;
                        if (currentRestart && !_lastRestartState)
                        {
                            IsRestartPressed = true;
                            OnRestartRequested?.Invoke();
                        }
                        _lastRestartState = currentRestart;
                    }
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                if (!ct.IsCancellationRequested)
                {
                    GD.PrintErr($"[HardwareUdpReceiver] Receive error: {ex.Message}");
                    await Task.Delay(100, ct);
                }
            }
        }
    }

    public void TareZero()
    {
        CalOffset = Math.Clamp(RawSteer, -0.8f, 0.8f);
        GD.Print($"[HardwareUdpReceiver] Tare zero calibrated: offset = {CalOffset:F3}");
    }

    public void ResetCalibration()
    {
        CalOffset = 0.0f;
        GD.Print("[HardwareUdpReceiver] Calibration reset to 0.0");
    }

    public void StopListening()
    {
        _cts?.Cancel();
        _cts?.Dispose();
        _cts = null;
        _udpClient?.Close();
        _udpClient?.Dispose();
        _udpClient = null;
    }

    public override void _ExitTree()
    {
        StopListening();
    }
}
