using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Godot;
using EndlessRide.Core;

namespace EndlessRide.Networking;

/// <summary>
/// Embedded HTTP & WebSocket server for Endless Ride on port 8080.
/// Directly serves public/remote.html to local smartphones and coordinates
/// bidirectional telemetry and control commands.
/// Ported from scripts/sensor_bridge.py.
/// </summary>
public partial class CompanionWebServer : Node
{
    [Export] public int HttpPort { get; set; } = 8080;

    public event Action? OnStartOrRestartCommand;
    public event Action? OnForceRestartCommand;
    public event Action? OnPauseCommand;
    public event Action? OnResumeCommand;
    public event Action? OnTareCommand;
    public event Action? OnResetCalibrationCommand;
    public event Action? OnToggleInvertCommand;
    public event Action<string>? OnDifficultyChanged;
    public event Action<string>? OnPlayerNameChanged;
    public event Action<uint>? OnSeedChanged;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    private HttpListener? _httpListener;
    private CancellationTokenSource? _cts;
    private readonly ConcurrentDictionary<WebSocket, SemaphoreSlim> _clientLocks = new();

    private string _cachedRemoteHtml = string.Empty;
    private string _lastGameState = "START";
    private string _lastDifficulty = "standard";
    private string _lastPlayerName = "Rider 1";
    public uint LastSeed { get; set; } = 1337;
    public string LastDeviceIp { get; set; } = string.Empty;
    private IReadOnlyList<LeaderboardEntry>? _cachedLeaderboard;

    /// <summary>
    /// Gets the companion app URL on the local LAN network (e.g. http://192.168.1.100:8080/remote).
    /// </summary>
    public string GetCompanionUrl()
    {
        string ip = GetLocalNetworkIp();
        return $"http://{ip}:{HttpPort}/remote";
    }

    /// <summary>
    /// Default companion URL helper when WebServer node is not directly accessible.
    /// </summary>
    public static string GetDefaultCompanionUrl(int port = 8080)
    {
        string ip = GetLocalNetworkIp();
        return $"http://{ip}:{port}/remote";
    }

    /// <summary>
    /// Discovers the active LAN IPv4 address (e.g., Wi-Fi or Ethernet on home network),
    /// falling back to Godot IP addresses or localhost.
    /// </summary>
    public static string GetLocalNetworkIp()
    {
        // 1. Try .NET NetworkInterface to find an active Wi-Fi or Ethernet IPv4 address
        try
        {
            var interfaces = System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces();
            foreach (var ni in interfaces)
            {
                if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up)
                    continue;
                if (ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback)
                    continue;

                var props = ni.GetIPProperties();
                foreach (var addr in props.UnicastAddresses)
                {
                    if (addr.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    {
                        string ip = addr.Address.ToString();
                        if (!ip.StartsWith("127.") && !ip.StartsWith("169.254."))
                        {
                            return ip;
                        }
                    }
                }
            }
        }
        catch { }

        // 2. Fallback to Godot's IP.GetLocalAddresses()
        try
        {
            var addrs = Godot.IP.GetLocalAddresses();
            foreach (var a in addrs)
            {
                if (!a.Contains(':') && !a.StartsWith("127.") && !a.StartsWith("169.254."))
                {
                    return a;
                }
            }
        }
        catch { }

        return "localhost";
    }

    public override void _Ready()
    {
        LoadStaticHtml();
        StartServer();
    }

    private void LoadStaticHtml()
    {
        // 1. Try reading from embedded assembly resource (cross-platform, zero I/O dependency)
        try
        {
            var asm = Assembly.GetExecutingAssembly();
            using var stream = asm.GetManifestResourceStream("EndlessRide.remote.html");
            if (stream != null)
            {
                using var reader = new StreamReader(stream);
                _cachedRemoteHtml = reader.ReadToEnd();
                GD.Print("[CompanionWebServer] Loaded remote.html from embedded assembly resource.");
            }
        }
        catch (Exception ex)
        {
            GD.PrintErr($"[CompanionWebServer] Embedded resource read error: {ex.Message}");
        }

        // 2. Try reading from Godot virtual filesystem (inside APK / PCK package)
        if (string.IsNullOrEmpty(_cachedRemoteHtml) && Godot.FileAccess.FileExists("res://remote.html"))
        {
            try
            {
                using var fa = Godot.FileAccess.Open("res://remote.html", Godot.FileAccess.ModeFlags.Read);
                if (fa != null)
                {
                    _cachedRemoteHtml = fa.GetAsText();
                    GD.Print("[CompanionWebServer] Loaded remote.html from res://remote.html.");
                }
            }
            catch (Exception ex)
            {
                GD.PrintErr($"[CompanionWebServer] res://remote.html read error: {ex.Message}");
            }
        }

        // 3. Fallback: Try reading public/remote.html from local disk (desktop dev)
        if (string.IsNullOrEmpty(_cachedRemoteHtml))
        {
            string remotePath = ProjectSettings.GlobalizePath("res://../public/remote.html");
            if (File.Exists(remotePath))
            {
                try
                {
                    _cachedRemoteHtml = File.ReadAllText(remotePath);
                    GD.Print("[CompanionWebServer] Loaded remote.html from disk.");
                }
                catch (Exception ex)
                {
                    GD.PrintErr($"[CompanionWebServer] Could not read remote.html: {ex.Message}");
                }
            }
        }

        if (string.IsNullOrEmpty(_cachedRemoteHtml))
        {
            _cachedRemoteHtml = "<!DOCTYPE html><html><head><title>Endless Ride Remote</title></head><body><h1>Endless Ride Remote</h1><p>Connected to Godot Server.</p></body></html>";
        }
    }

    public void StartServer()
    {
        StopServer();
        _cts = new CancellationTokenSource();

        try
        {
            _httpListener = new HttpListener();
            _httpListener.Prefixes.Add($"http://*:{HttpPort}/");
            _httpListener.Start();
            Task.Run(() => ListenLoopAsync(_cts.Token));
            GD.Print($"[CompanionWebServer] HTTP & WebSocket server running on http://*:{HttpPort}/");
        }
        catch (Exception ex)
        {
            // Fallback to localhost if wildcard fails without root permissions
            try
            {
                _httpListener = new HttpListener();
                _httpListener.Prefixes.Add($"http://localhost:{HttpPort}/");
                _httpListener.Start();
                Task.Run(() => ListenLoopAsync(_cts.Token));
                GD.Print($"[CompanionWebServer] Running on http://localhost:{HttpPort}/ (fallback)");
            }
            catch (Exception innerEx)
            {
                GD.PrintErr($"[CompanionWebServer] Could not start server on port {HttpPort}: {innerEx.Message} ({ex.Message})");
            }
        }
    }

    private async Task ListenLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _httpListener != null && _httpListener.IsListening)
        {
            try
            {
                var context = await _httpListener.GetContextAsync();
                if (context.Request.IsWebSocketRequest)
                {
                    _ = ProcessWebSocketUpgradeAsync(context, ct);
                }
                else
                {
                    ProcessHttpRequest(context);
                }
            }
            catch (HttpListenerException)
            {
                break;
            }
            catch (Exception ex)
            {
                if (!ct.IsCancellationRequested)
                {
                    GD.PrintErr($"[CompanionWebServer] Request error: {ex.Message}");
                }
            }
        }
    }

    private void ProcessHttpRequest(HttpListenerContext context)
    {
        var response = context.Response;
        string path = context.Request.Url?.AbsolutePath.ToLowerInvariant() ?? "/";

        if (path == "/" || path == "/remote" || path == "/remote.html")
        {
            byte[] bytes = Encoding.UTF8.GetBytes(_cachedRemoteHtml);
            response.ContentType = "text/html; charset=utf-8";
            response.ContentLength64 = bytes.Length;
            response.OutputStream.Write(bytes, 0, bytes.Length);
            response.OutputStream.Close();
        }
        else
        {
            response.StatusCode = 404;
            response.OutputStream.Close();
        }
    }

    private async Task ProcessWebSocketUpgradeAsync(HttpListenerContext context, CancellationToken ct)
    {
        WebSocketContext wsContext;
        try
        {
            wsContext = await context.AcceptWebSocketAsync(subProtocol: null);
        }
        catch (Exception ex)
        {
            context.Response.StatusCode = 500;
            context.Response.Close();
            GD.PrintErr($"[CompanionWebServer] WebSocket upgrade failed: {ex.Message}");
            return;
        }

        WebSocket ws = wsContext.WebSocket;
        _clientLocks.TryAdd(ws, new SemaphoreSlim(1, 1));
        GD.Print("[CompanionWebServer] Smartphone remote connected via WebSocket.");

        // Send current room state on initial connection
        SendRoomStateToClient(ws);

        byte[] buffer = new byte[4096];

        try
        {
            while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", ct);
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    string json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    HandleClientJson(json, ws);
                }
            }
        }
        catch (Exception)
        {
            // Client disconnected
        }
        finally
        {
            if (_clientLocks.TryRemove(ws, out var sem))
            {
                sem.Dispose();
            }
            ws.Dispose();
            GD.Print("[CompanionWebServer] Smartphone remote disconnected.");
        }
    }

    private void HandleClientJson(string json, WebSocket ws)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeProp)) return;

            string msgType = typeProp.GetString() ?? string.Empty;

            switch (msgType)
            {
                case "get_state":
                    SendRoomStateToClient(ws);
                    break;

                case "command":
                    if (root.TryGetProperty("action", out var actionProp))
                    {
                        string action = actionProp.GetString() ?? string.Empty;
                        if (action is "start_or_restart" or "restart")
                            OnStartOrRestartCommand?.Invoke();
                        else if (action == "force_restart")
                            OnForceRestartCommand?.Invoke();
                        else if (action == "pause")
                            OnPauseCommand?.Invoke();
                        else if (action == "resume")
                            OnResumeCommand?.Invoke();
                    }
                    break;

                case "calibrate":
                    OnTareCommand?.Invoke();
                    break;

                case "reset_calibration":
                    OnResetCalibrationCommand?.Invoke();
                    break;

                case "toggle_invert":
                    OnToggleInvertCommand?.Invoke();
                    break;

                case "set_config":
                    if (root.TryGetProperty("difficulty", out var diffProp))
                    {
                        string diff = diffProp.GetString() ?? "standard";
                        _lastDifficulty = diff.ToLowerInvariant();
                        OnDifficultyChanged?.Invoke(_lastDifficulty);
                    }
                    break;

                case "set_seed":
                    if (root.TryGetProperty("seed", out var seedProp))
                    {
                        uint seedVal = 1337;
                        if (seedProp.ValueKind == JsonValueKind.Number && seedProp.TryGetUInt32(out uint sNum))
                            seedVal = sNum;
                        else if (seedProp.ValueKind == JsonValueKind.String && uint.TryParse(seedProp.GetString(), out uint sStr))
                            seedVal = sStr;

                        LastSeed = seedVal;
                        OnSeedChanged?.Invoke(LastSeed);
                    }
                    break;

                case "select_player":
                    if (root.TryGetProperty("playerName", out var nameProp))
                    {
                        string rawName = nameProp.GetString() ?? "Rider 1";
                        string cleanName = string.Join("", rawName.Where(c => !char.IsControl(c))).Trim();
                        if (cleanName.Length > 20) cleanName = cleanName[..20];
                        if (string.IsNullOrWhiteSpace(cleanName)) cleanName = "Rider 1";
                        _lastPlayerName = cleanName;
                        OnPlayerNameChanged?.Invoke(_lastPlayerName);
                    }
                    break;
            }
        }
        catch (Exception ex)
        {
            GD.PrintErr($"[CompanionWebServer] JSON parse error: {ex.Message}");
        }
    }

    private async Task SafeSendAsync(WebSocket ws, byte[] bytes)
    {
        if (ws.State != WebSocketState.Open) return;
        if (!_clientLocks.TryGetValue(ws, out var sem)) return;

        bool entered = false;
        try
        {
            entered = await sem.WaitAsync(100);
            if (!entered) return;

            if (ws.State == WebSocketState.Open)
            {
                await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
            }
        }
        catch (Exception ex)
        {
            GD.PrintErr($"[CompanionWebServer] WebSocket send error: {ex.Message}");
        }
        finally
        {
            if (entered)
            {
                sem.Release();
            }
        }
    }

    public void BroadcastRoomState(string gameState, string difficulty, string playerName, IReadOnlyList<LeaderboardEntry>? leaderboard = null, uint? seed = null)
    {
        _lastGameState = gameState;
        _lastDifficulty = difficulty;
        _lastPlayerName = playerName;
        if (seed.HasValue) LastSeed = seed.Value;
        if (leaderboard != null)
        {
            _cachedLeaderboard = leaderboard;
        }

        if (_clientLocks.IsEmpty) return;

        var payload = new
        {
            type = "room_state",
            gameState = _lastGameState,
            difficulty = _lastDifficulty,
            playerName = _lastPlayerName,
            seed = LastSeed,
            players = new[] { _lastPlayerName, "Rider 1", "Rider 2", "Pro" },
            leaderboard = _cachedLeaderboard ?? (object)Array.Empty<LeaderboardEntry>(),
            atoms3Ip = LastDeviceIp
        };

        string json = JsonSerializer.Serialize(payload, JsonOpts);
        byte[] bytes = Encoding.UTF8.GetBytes(json);

        foreach (var client in _clientLocks.Keys)
        {
            _ = SafeSendAsync(client, bytes);
        }
    }

    public void BroadcastLeaderboard(IReadOnlyList<LeaderboardEntry> leaderboard)
    {
        _cachedLeaderboard = leaderboard;
        if (_clientLocks.IsEmpty) return;

        var payload = new
        {
            type = "leaderboard",
            leaderboard
        };

        string json = JsonSerializer.Serialize(payload, JsonOpts);
        byte[] bytes = Encoding.UTF8.GetBytes(json);

        foreach (var client in _clientLocks.Keys)
        {
            _ = SafeSendAsync(client, bytes);
        }
    }

    private void SendRoomStateToClient(WebSocket ws)
    {
        if (ws.State != WebSocketState.Open) return;

        var payload = new
        {
            type = "room_state",
            gameState = _lastGameState,
            difficulty = _lastDifficulty,
            playerName = _lastPlayerName,
            seed = LastSeed,
            players = new[] { _lastPlayerName, "Rider 1", "Rider 2", "Pro" },
            leaderboard = _cachedLeaderboard ?? (object)Array.Empty<LeaderboardEntry>(),
            atoms3Ip = LastDeviceIp
        };

        string json = JsonSerializer.Serialize(payload, JsonOpts);
        byte[] bytes = Encoding.UTF8.GetBytes(json);
        _ = SafeSendAsync(ws, bytes);
    }

    public void BroadcastTelemetry(
        string gameState,
        float distance,
        float speed,
        float score,
        float multiplier,
        float steer,
        string difficulty = "",
        string source = "godot",
        float rawSteer = 0.0f,
        float calOffset = 0.0f,
        string deviceIp = "",
        int hz = 50,
        int seq = 0,
        int button = 0)
    {
        if (!string.IsNullOrEmpty(deviceIp))
        {
            LastDeviceIp = deviceIp;
        }

        if (_clientLocks.IsEmpty) return;

        var payload = new
        {
            type = "sensor",
            source = source,
            steer = MathF.Round(steer, 3),
            rawSteer = MathF.Round(rawSteer, 3),
            calOffset = MathF.Round(calOffset, 3),
            rollDeg = MathF.Round(rawSteer * 28.0f, 1),
            state = gameState,
            difficulty = string.IsNullOrEmpty(difficulty) ? _lastDifficulty : difficulty,
            deviceIp = string.IsNullOrEmpty(deviceIp) ? LastDeviceIp : deviceIp,
            hz = hz,
            seq = seq,
            button = button,
            liveStats = new
            {
                score = (int)score,
                distance = (int)distance,
                multiplier = MathF.Round(multiplier, 1),
                speed = MathF.Round(speed, 1)
            }
        };

        string json = JsonSerializer.Serialize(payload, JsonOpts);
        byte[] bytes = Encoding.UTF8.GetBytes(json);

        foreach (var client in _clientLocks.Keys)
        {
            _ = SafeSendAsync(client, bytes);
        }
    }

    public void StopServer()
    {
        _cts?.Cancel();
        _cts?.Dispose();
        _cts = null;

        foreach (var client in _clientLocks.Keys)
        {
            if (_clientLocks.TryRemove(client, out var sem))
            {
                sem.Dispose();
            }
            try { client.Dispose(); } catch { }
        }
        _clientLocks.Clear();

        if (_httpListener != null)
        {
            try { _httpListener.Stop(); _httpListener.Close(); } catch { }
            _httpListener = null;
        }
    }

    public override void _ExitTree()
    {
        StopServer();
    }
}
