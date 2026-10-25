using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using FileAccess = Godot.FileAccess;

namespace EndlessRide.Core;

public class LeaderboardEntry
{
    public string Name { get; set; } = "Rider";
    public int Score { get; set; }
    public int Distance { get; set; }
    public string Difficulty { get; set; } = "standard";
    public int Apples { get; set; }
    public int Horseshoes { get; set; }
    public long Timestamp { get; set; }
}

/// <summary>
/// Persistent top-10 leaderboard manager for Endless Ride.
/// Saves and loads to user://leaderboard.json with default arcade benchmarks.
/// </summary>
public class LeaderboardManager
{
    private const string SavePath = "user://leaderboard.json";
    private const int MaxEntries = 10;

    private readonly List<LeaderboardEntry> _entries = new();
    private readonly object _lock = new();
    private LeaderboardEntry[] _snapshot = Array.Empty<LeaderboardEntry>();

    public IReadOnlyList<LeaderboardEntry> Entries => _snapshot;

    public LeaderboardManager()
    {
        Load();
    }

    public void Load()
    {
        lock (_lock)
        {
            _entries.Clear();

            if (FileAccess.FileExists(SavePath))
            {
                try
                {
                    using var file = FileAccess.Open(SavePath, FileAccess.ModeFlags.Read);
                    if (file != null)
                    {
                        string json = file.GetAsText();
                        var list = JsonSerializer.Deserialize<List<LeaderboardEntry>>(json);
                        if (list != null && list.Count > 0)
                        {
                            _entries.AddRange(list);
                            SortAndTrim();
                            GD.Print($"[LeaderboardManager] Loaded {_entries.Count} entries from {SavePath}.");
                            return;
                        }
                    }
                }
                catch (Exception ex)
                {
                    GD.PrintErr($"[LeaderboardManager] Failed to read {SavePath}: {ex.Message}");
                }
            }

            // Initialize with default arcade benchmarks if file does not exist or failed
            _entries.AddRange(GetDefaultLeaderboard());
            SortAndTrim();
            Save();
            GD.Print($"[LeaderboardManager] Initialized with {_entries.Count} default benchmark entries.");
        }
    }

    public void Save()
    {
        try
        {
            var snap = _snapshot;
            using var file = FileAccess.Open(SavePath, FileAccess.ModeFlags.Write);
            if (file != null)
            {
                var options = new JsonSerializerOptions { WriteIndented = true };
                string json = JsonSerializer.Serialize(snap, options);
                file.StoreString(json);
            }
        }
        catch (Exception ex)
        {
            GD.PrintErr($"[LeaderboardManager] Failed to save {SavePath}: {ex.Message}");
        }
    }

    /// <summary>
    /// Records a new completed run. Returns true if it made the top 10 leaderboard,
    /// and indicates if it broke the all-time high score.
    /// </summary>
    public bool RecordScore(
        string playerName,
        int score,
        int distance,
        string difficulty,
        int apples,
        int horseshoes,
        out bool isNewRecord,
        out int rankIndex)
    {
        lock (_lock)
        {
            int prevHigh = GetHighScore();
            isNewRecord = score > prevHigh && score > 0;

            var newEntry = new LeaderboardEntry
            {
                Name = string.IsNullOrWhiteSpace(playerName) ? "Rider" : playerName.Trim(),
                Score = score,
                Distance = distance,
                Difficulty = string.IsNullOrWhiteSpace(difficulty) ? "standard" : difficulty.ToLowerInvariant(),
                Apples = apples,
                Horseshoes = horseshoes,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            };

            _entries.Add(newEntry);
            SortAndTrim();
            Save();

            rankIndex = Array.IndexOf(_snapshot, newEntry);
            bool madeBoard = rankIndex >= 0 && rankIndex < MaxEntries;

            GD.Print($"[LeaderboardManager] New score recorded: {newEntry.Name} - {newEntry.Score} pts ({newEntry.Distance}m, {newEntry.Difficulty}). Rank: {(madeBoard ? $"#{rankIndex + 1}" : "Unranked")}, NewRecord: {isNewRecord}");
            return madeBoard;
        }
    }

    public int GetHighScore()
    {
        var snap = _snapshot;
        return snap.Length > 0 ? snap[0].Score : 0;
    }

    private void SortAndTrim()
    {
        _entries.Sort((a, b) =>
        {
            int cmp = b.Score.CompareTo(a.Score);
            return cmp != 0 ? cmp : b.Timestamp.CompareTo(a.Timestamp);
        });
        if (_entries.Count > MaxEntries)
        {
            _entries.RemoveRange(MaxEntries, _entries.Count - MaxEntries);
        }
        _snapshot = _entries.ToArray();
    }

    private static List<LeaderboardEntry> GetDefaultLeaderboard()
    {
        return new List<LeaderboardEntry>
        {
            new() { Name = "Champion", Score = 2500, Distance = 1200, Difficulty = "pro" },
            new() { Name = "TrailBlazer", Score = 1800, Distance = 950, Difficulty = "standard" },
            new() { Name = "Rider 1", Score = 1200, Distance = 700, Difficulty = "standard" },
            new() { Name = "SwiftHoof", Score = 850, Distance = 550, Difficulty = "relaxed" },
            new() { Name = "Meadow", Score = 500, Distance = 350, Difficulty = "relaxed" }
        };
    }
}
