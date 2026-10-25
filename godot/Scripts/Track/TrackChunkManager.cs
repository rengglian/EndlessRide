using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Godot;
using EndlessRide.Core;
using EndlessRide.Obstacles;
using EndlessRide.Collectibles;

namespace EndlessRide.Track;

/// <summary>
/// Manages procedural chunk streaming, background worker thread generation,
/// chunk pooling, and obstacle/collectible coordination.
/// Ported from src/track/TrackChunkManager.ts.
/// </summary>
public partial class TrackChunkManager : Node3D
{
    [Export] public int ChunksAhead { get; set; } = Config.ChunksAhead;
    [Export] public int ChunksBehind { get; set; } = Config.ChunksBehind;
    [Export] public float ChunkLength { get; set; } = Config.ChunkLength;

    public SplineTrack Track { get; private set; } = new();
    public ObstacleManager? ObstacleMgr { get; set; }
    public CollectibleManager? CollectibleMgr { get; set; }

    private readonly Dictionary<int, TrackChunk> _activeChunks = new();
    private readonly Stack<TrackChunk> _chunkPool = new();
    private readonly HashSet<int> _pendingRequests = new();
    private readonly ConcurrentQueue<TrackChunkGeometryData> _readyDataQueue = new();

    private int _generationId = 0;
    private uint _runSeed = 1337;

    public override void _Ready()
    {
        InitTrack();
    }

    public void InitTrack()
    {
        _generationId++;
        _pendingRequests.Clear();

        // Clear active chunks to pool
        foreach (var chunk in _activeChunks.Values)
        {
            chunk.Visible = false;
            _chunkPool.Push(chunk);
        }
        _activeChunks.Clear();

        while (_readyDataQueue.TryDequeue(out _)) { }

        // Spawn chunks starting from behind player (-ChunksBehind) up to ChunksAhead
        for (int i = -ChunksBehind; i <= ChunksAhead; i++)
        {
            RequestChunk(i);
        }
    }

    public override void _Process(double delta)
    {
        // Process any chunks completed on background threads
        while (_readyDataQueue.TryDequeue(out var data))
        {
            if (data.GenerationId != _generationId)
                continue;

            _pendingRequests.Remove(data.ChunkIndex);

            TrackChunk chunk;
            if (_chunkPool.Count > 0)
            {
                chunk = _chunkPool.Pop();
            }
            else
            {
                chunk = new TrackChunk();
                AddChild(chunk);
            }

            chunk.ApplyGeometry(data, Track);
            chunk.Visible = true;
            _activeChunks[data.ChunkIndex] = chunk;

            // Spawn obstacles and collectibles for this chunk
            ObstacleMgr?.SpawnChunkObstacles(data.ObstacleAnchors, data.ChunkIndex);
            CollectibleMgr?.SpawnChunkCollectibles(data.CollectibleAnchors, data.ChunkIndex);

            GD.Print($"[TrackChunkManager] Chunk {data.ChunkIndex} created at {data.StartDist:F1}m ({data.Positions.Length / 3} vertices).");
        }
    }

    public void UpdatePlayerDistance(float playerDistance)
    {
        float validDist = MathF.Max(0.0f, playerDistance);
        int currentChunkIdx = (int)MathF.Floor(validDist / ChunkLength);

        int minNeeded = currentChunkIdx - ChunksBehind;
        int maxNeeded = currentChunkIdx + ChunksAhead;

        // Request needed chunks ahead
        for (int i = minNeeded; i <= maxNeeded; i++)
        {
            if (!_activeChunks.ContainsKey(i) && !_pendingRequests.Contains(i))
            {
                RequestChunk(i);
            }
        }

        // Recycle chunks that fell behind
        var toRecycle = new List<int>();
        foreach (int idx in _activeChunks.Keys)
        {
            if (idx < minNeeded || idx > maxNeeded + 1)
            {
                toRecycle.Add(idx);
            }
        }

        foreach (int idx in toRecycle)
        {
            var chunk = _activeChunks[idx];
            _activeChunks.Remove(idx);
            chunk.Visible = false;
            _chunkPool.Push(chunk);

            ObstacleMgr?.RecycleChunkObstacles(idx);
            CollectibleMgr?.RecycleChunkCollectibles(idx);
        }
    }

    private void RequestChunk(int chunkIndex)
    {
        _pendingRequests.Add(chunkIndex);
        float startDist = chunkIndex * ChunkLength;
        int currentGen = _generationId;
        uint seed = _runSeed;
        float length = ChunkLength;

        // Offload pure analytical geometry math to worker thread
        WorkerThreadPool.AddTask(Callable.From(() =>
        {
            var data = TrackMath.GenerateChunkData(
                chunkIndex,
                startDist,
                length,
                Config.ChunkSegments,
                seed,
                currentGen
            );

            _readyDataQueue.Enqueue(data);
        }));
    }

    public bool TryGetChunk(int chunkIndex, out TrackChunk? chunk)
    {
        return _activeChunks.TryGetValue(chunkIndex, out chunk);
    }
}
