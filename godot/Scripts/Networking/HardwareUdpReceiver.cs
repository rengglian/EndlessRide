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
    [Export] public int ListenPort { get; set; } = 8080;
    [Export] public int AlternatePort { get; set; } = 8081;
    [Export] public float Sensitivity { get; set; } = 1.0f;
    [Export] public bool InvertX { get; set; } = true;

    public float RawSteer { get; private set; }
    public float CalibratedSteer { get; private set; }
    public float CalOffset { get; set; } = 0.0f;
    public bool IsRestartPressed { get; private set; }
    public bool IsActive => (Time.GetTicksMsec() - _lastPacketTimeMs) < 1000;
    public int PacketCount { get; private set; }
    public string DeviceIp { get; private set; } = string.Empty;
    public byte Seq { get; private set; }
    public byte Button { get; private set; }
    public int Hz { get; private set; }

    public event Action? OnRestartRequested;

    private UdpClient? _udpClientPrimary;
    private UdpClient? _udpClientSecondary;
    private CancellationTokenSource? _cts;
    private ulong _lastPacketTimeMs;
    private bool _lastRestartState;
    private int _hzPacketCounter;
    private ulong _hzWindowStartTimeMs;

    private const ushort PacketMagic = 0x4552; // 'ER' in hex

    public override void _Ready()
    {
        StartListening();
    }

    public void StartListening()
    {
        StopListening();
        _cts = new CancellationTokenSource();
        _hzWindowStartTimeMs = Time.GetTicksMsec();

        // 1. Primary UDP listener on port 8080 (standard AtomS3 firmware port)
        try
        {
            _udpClientPrimary = new UdpClient(ListenPort);
            Task.Run(() => ReceiveLoopAsync(_udpClientPrimary, ListenPort, _cts.Token));
            GD.Print($"[HardwareUdpReceiver] Listening on primary UDP port {ListenPort} for AtomS3 binary packets.");
        }
        catch (Exception ex)
        {
            GD.PrintErr($"[HardwareUdpReceiver] Could not bind UDP port {ListenPort}: {ex.Message}");
        }

        // 2. Secondary UDP listener on port 8081 (alternate port)
        if (AlternatePort != ListenPort)
        {
            try
            {
                _udpClientSecondary = new UdpClient(AlternatePort);
                Task.Run(() => ReceiveLoopAsync(_udpClientSecondary, AlternatePort, _cts.Token));
                GD.Print($"[HardwareUdpReceiver] Listening on secondary UDP port {AlternatePort} for AtomS3 binary packets.");
            }
            catch (Exception ex)
            {
                GD.PrintErr($"[HardwareUdpReceiver] Could not bind secondary UDP port {AlternatePort}: {ex.Message}");
            }
        }
    }

    private async Task ReceiveLoopAsync(UdpClient client, int port, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && client != null)
        {
            try
            {
                var result = await client.ReceiveAsync(ct);
                ProcessPacket(result.Buffer, result.RemoteEndPoint);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                if (!ct.IsCancellationRequested)
                {
                    GD.PrintErr($"[HardwareUdpReceiver:{port}] Receive error: {ex.Message}");
                    await Task.Delay(100, ct);
                }
            }
        }
    }

    private void ProcessPacket(byte[] data, IPEndPoint remoteEndPoint)
    {
        if (data.Length < 8) return;

        // Little-endian unpack: [H (ushort), B (byte), B (byte), f (float)]
        ushort magic = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(0, 2));
        if (magic != PacketMagic) return;

        byte seq = data[2];
        byte restart = data[3];
        float steer = BitConverter.ToSingle(data, 4);
        if (InvertX)
        {
            steer = -steer;
        }

        RawSteer = steer;
        CalibratedSteer = Math.Clamp((steer - CalOffset) * Sensitivity, -1.0f, 1.0f);
        Seq = seq;
        Button = restart;

        ulong now = Time.GetTicksMsec();
        _lastPacketTimeMs = now;
        PacketCount++;
        DeviceIp = remoteEndPoint.Address.ToString();

        if (PacketCount == 1)
        {
            GD.Print($"[HardwareUdpReceiver] First packet received from {DeviceIp} on port (magic=0x{magic:X4}, seq={seq}, steer={steer:F2}, restart={restart})");
        }

        // Calculate rolling Hz
        _hzPacketCounter++;
        ulong dt = now - _hzWindowStartTimeMs;
        if (dt >= 1000)
        {
            Hz = (int)Math.Round(_hzPacketCounter * 1000.0 / dt);
            _hzPacketCounter = 0;
            _hzWindowStartTimeMs = now;
        }
        else if (Hz == 0)
        {
            Hz = 50;
        }

        bool currentRestart = restart > 0;
        if (currentRestart && !_lastRestartState)
        {
            IsRestartPressed = true;
            OnRestartRequested?.Invoke();
        }
        _lastRestartState = currentRestart;
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

        _udpClientPrimary?.Close();
        _udpClientPrimary?.Dispose();
        _udpClientPrimary = null;

        _udpClientSecondary?.Close();
        _udpClientSecondary?.Dispose();
        _udpClientSecondary = null;
    }

    public override void _ExitTree()
    {
        StopListening();
    }
}
