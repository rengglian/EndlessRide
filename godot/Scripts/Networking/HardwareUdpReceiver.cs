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
/// Listens on port 8080/8081 for 32-byte binary datagrams:
/// [magic: uint16 (0x4553), seq: uint8, button: uint8, timestamp_us: uint32, ax, ay, az, gx, gy, gz: float32 x 6]
/// Applies host-side 6-axis sensor fusion, tare calibration, and staleness safety guard.
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
    public bool IsActive => _lastPacketTimeMs > 0 && (Time.GetTicksMsec() - _lastPacketTimeMs) < 350;
    public int PacketCount { get; private set; }
    public string DeviceIp { get; private set; } = string.Empty;
    public byte Seq { get; private set; }
    public byte Button { get; private set; }
    public int Hz { get; private set; }

    public Vector3 RawAccel { get; private set; }
    public Vector3 RawGyro { get; private set; }
    public uint TimestampUs { get; private set; }
    public float FusedRollDeg => _fusedRollDeg;

    public event Action? OnRestartRequested;

    private UdpClient? _udpClientPrimary;
    private UdpClient? _udpClientSecondary;
    private CancellationTokenSource? _cts;
    private ulong _lastPacketTimeMs;
    private bool _lastRestartState;
    private int _hzPacketCounter;
    private ulong _hzWindowStartTimeMs;

    private float _fusedRollDeg;
    private bool _hasFusedRoll;
    private uint _lastTimestampUs;
    private bool _hasLastTimestamp;
    private float _filteredSteer;

    private const ushort PacketMagic = 0x4553; // 'ES' in hex

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
        if (data.Length < 32) return;

        // Little-endian unpack: [magic: uint16 (0x4553), seq: uint8, button: uint8, timestamp_us: uint32, 6x float32]
        ushort magic = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(0, 2));
        if (magic != PacketMagic) return;

        byte seq = data[2];
        byte button = data[3];

        uint timestampUs = BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(4, 4));
        float ax = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(8, 4));
        float ay = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(12, 4));
        float az = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(16, 4));
        float gx = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(20, 4));
        float gy = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(24, 4));
        float gz = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(28, 4));

        if (!float.IsFinite(ax) || !float.IsFinite(ay) || !float.IsFinite(az) ||
            !float.IsFinite(gx) || !float.IsFinite(gy) || !float.IsFinite(gz))
        {
            return;
        }

        RawAccel = new Vector3(ax, ay, az);
        RawGyro = new Vector3(gx, gy, gz);
        TimestampUs = timestampUs;
        Seq = seq;
        Button = button;

        ulong now = Time.GetTicksMsec();

        // 1. Compute dt
        float dt = 0.02f;
        if (_hasLastTimestamp)
        {
            uint diffUs = timestampUs - _lastTimestampUs;
            if (diffUs > 0 && diffUs < 1_000_000)
            {
                dt = diffUs * 1e-6f;
            }
        }
        _lastTimestampUs = timestampUs;
        _hasLastTimestamp = true;
        dt = Math.Clamp(dt, 0.005f, 0.05f);

        // 2. Accelerometer roll
        float accelRollRad = MathF.Atan2(ax, MathF.Sqrt(ay * ay + az * az));
        float accelRollDeg = accelRollRad * (180.0f / MathF.PI);

        // 3. Complementary filter with gy (Y-axis gyro in deg/s)
        if (!_hasFusedRoll || (now - _lastPacketTimeMs) > 500)
        {
            _fusedRollDeg = accelRollDeg;
            _hasFusedRoll = true;
        }
        else
        {
            _fusedRollDeg = 0.96f * (_fusedRollDeg + gy * dt) + 0.04f * accelRollDeg;
        }

        // 4. Tare offset
        float calibratedRoll = _fusedRollDeg - CalOffset;

        // 5. Map to normalized steer
        float rawSteer = Math.Clamp(calibratedRoll / 28.0f, -1.0f, 1.0f);

        // 6. Center deadzone
        if (MathF.Abs(rawSteer) < 0.05f)
        {
            rawSteer = 0.0f;
        }

        // 7. Exponential smoothing
        _filteredSteer += (rawSteer - _filteredSteer) * 0.35f;

        // 8. InvertX and Sensitivity
        float steer = InvertX ? -_filteredSteer : _filteredSteer;
        RawSteer = steer;
        CalibratedSteer = Math.Clamp(steer * Sensitivity, -1.0f, 1.0f);

        _lastPacketTimeMs = now;
        PacketCount++;
        DeviceIp = remoteEndPoint.Address.ToString();

        if (PacketCount == 1)
        {
            GD.Print($"[HardwareUdpReceiver] First packet received from {DeviceIp} (magic=0x{magic:X4}, seq={seq}, button={button}, ax={ax:F2}, ay={ay:F2}, az={az:F2}, gy={gy:F2})");
        }

        // Calculate rolling Hz
        _hzPacketCounter++;
        ulong dtHz = now - _hzWindowStartTimeMs;
        if (dtHz >= 1000)
        {
            Hz = (int)Math.Round(_hzPacketCounter * 1000.0 / dtHz);
            _hzPacketCounter = 0;
            _hzWindowStartTimeMs = now;
        }
        else if (Hz == 0)
        {
            Hz = 50;
        }

        // Button edge-detection for OnRestartRequested
        bool currentRestart = button > 0;
        if (currentRestart && !_lastRestartState)
        {
            IsRestartPressed = true;
            OnRestartRequested?.Invoke();
        }
        else if (!currentRestart)
        {
            IsRestartPressed = false;
        }
        _lastRestartState = currentRestart;
    }

    public void TareZero()
    {
        CalOffset = _fusedRollDeg;
        _filteredSteer = 0.0f;
        GD.Print($"[HardwareUdpReceiver] Tare zero calibrated: offset = {CalOffset:F2}°");
    }

    public void ResetCalibration()
    {
        CalOffset = 0.0f;
        GD.Print("[HardwareUdpReceiver] Calibration reset to 0.0°");
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
