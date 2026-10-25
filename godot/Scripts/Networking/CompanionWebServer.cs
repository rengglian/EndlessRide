using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Godot;

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
    public event Action? OnPauseCommand;
    public event Action? OnResumeCommand;
    public event Action? OnTareCommand;
    public event Action<string>? OnDifficultyChanged;
    public event Action<string>? OnPlayerNameChanged;

    private HttpListener? _httpListener;
    private CancellationTokenSource? _cts;
    private readonly ConcurrentDictionary<WebSocket, byte> _clients = new();

    private string _cachedRemoteHtml = string.Empty;

    public override void _Ready()
    {
        LoadStaticHtml();
        StartServer();
    }

    private void LoadStaticHtml()
    {
        // Try reading public/remote.html from disk
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
        _clients.TryAdd(ws, 0);
        GD.Print("[CompanionWebServer] Smartphone remote connected via WebSocket.");

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
                    HandleClientJson(json);
                }
            }
        }
        catch (Exception)
        {
            // Client disconnected
        }
        finally
        {
            _clients.TryRemove(ws, out _);
            ws.Dispose();
            GD.Print("[CompanionWebServer] Smartphone remote disconnected.");
        }
    }

    private void HandleClientJson(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeProp)) return;

            string msgType = typeProp.GetString() ?? string.Empty;

            switch (msgType)
            {
                case "command":
                    if (root.TryGetProperty("action", out var actionProp))
                    {
                        string action = actionProp.GetString() ?? string.Empty;
                        if (action is "start_or_restart" or "restart" or "force_restart")
                            OnStartOrRestartCommand?.Invoke();
                        else if (action == "pause")
                            OnPauseCommand?.Invoke();
                        else if (action == "resume")
                            OnResumeCommand?.Invoke();
                    }
                    break;

                case "calibrate":
                    OnTareCommand?.Invoke();
                    break;

                case "set_config":
                    if (root.TryGetProperty("difficulty", out var diffProp))
                    {
                        OnDifficultyChanged?.Invoke(diffProp.GetString() ?? "standard");
                    }
                    break;

                case "select_player":
                    if (root.TryGetProperty("playerName", out var nameProp))
                    {
                        OnPlayerNameChanged?.Invoke(nameProp.GetString() ?? "Rider");
                    }
                    break;
            }
        }
        catch (Exception ex)
        {
            GD.PrintErr($"[CompanionWebServer] JSON parse error: {ex.Message}");
        }
    }

    public void BroadcastTelemetry(string gameState, float distance, float speed, float score, float multiplier, float steer)
    {
        if (_clients.IsEmpty) return;

        var payload = new
        {
            type = "sensor",
            source = "godot",
            steer = MathF.Round(steer, 3),
            rawSteer = MathF.Round(steer, 3),
            rollDeg = MathF.Round(steer * 28.0f, 1),
            state = gameState,
            liveStats = new
            {
                score = (int)score,
                distance = (int)distance,
                multiplier = MathF.Round(multiplier, 1),
                speed = MathF.Round(speed, 1)
            }
        };

        string json = JsonSerializer.Serialize(payload);
        byte[] bytes = Encoding.UTF8.GetBytes(json);
        var segment = new ArraySegment<byte>(bytes);

        foreach (var client in _clients.Keys)
        {
            if (client.State == WebSocketState.Open)
            {
                _ = client.SendAsync(segment, WebSocketMessageType.Text, true, CancellationToken.None);
            }
        }
    }

    public void StopServer()
    {
        _cts?.Cancel();
        _cts?.Dispose();
        _cts = null;

        foreach (var client in _clients.Keys)
        {
            try { client.Dispose(); } catch { }
        }
        _clients.Clear();

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
