using System;
using System.Collections.Generic;
using Godot;
using EndlessRide.Core;
using EndlessRide.Track;

namespace EndlessRide.Obstacles;

/// <summary>
/// Spawns, orients, and recycles pooled obstacles along procedural track chunks.
/// Performs continuous swept longitudinal interval AABB collision detection in (s, u) space.
/// Ported from src/obstacles/ObstacleManager.ts.
/// </summary>
public partial class ObstacleManager : Node3D
{
    private SplineTrack _track = null!;
    private ObstaclePool _pool = null!;
    private readonly List<ObstacleEntity> _activeObstacles = new();

    public void Initialize(SplineTrack track)
    {
        _track = track;
        _pool = new ObstaclePool(this, 16);
    }

    public void SpawnChunkObstacles(List<ObstacleAnchor> anchors, int chunkIndex)
    {
        RecycleChunkObstacles(chunkIndex);

        foreach (var anchor in anchors)
        {
            var obstacle = _pool.Acquire(anchor.Type);
            obstacle.Distance = anchor.Distance;
            obstacle.Lane = anchor.Lane;
            obstacle.ChunkIndex = chunkIndex;

            float uOffset = anchor.Lane switch
            {
                LaneType.Left => Config.LaneOffsets.Left,
                LaneType.Center => Config.LaneOffsets.Center,
                LaneType.Right => Config.LaneOffsets.Right,
                _ => 0.0f
            };
            obstacle.LateralOffset = uOffset;

            // Orient along track surface and banking with right-handed basis
            obstacle.Node.GlobalTransform = _track.GetTransformAt(obstacle.Distance, uOffset);

            _activeObstacles.Add(obstacle);
        }
    }

    public void RecycleChunkObstacles(int chunkIndex)
    {
        for (int i = _activeObstacles.Count - 1; i >= 0; i--)
        {
            var obs = _activeObstacles[i];
            if (obs.ChunkIndex == chunkIndex)
            {
                _pool.Release(obs);
                int lastIdx = _activeObstacles.Count - 1;
                _activeObstacles[i] = _activeObstacles[lastIdx];
                _activeObstacles.RemoveAt(lastIdx);
            }
        }
    }

    /// <summary>
    /// Swept longitudinal interval AABB collision check in (s, u) space.
    /// Prevents tunneling through obstacles at high gallop velocities.
    /// </summary>
    public bool CheckPlayerCollision(
        float prevPlayerDist,
        float currPlayerDist,
        float playerLateral,
        float halfWidth = 0.42f,
        float halfLength = 0.85f)
    {
        float minPlayerS = MathF.Min(prevPlayerDist, currPlayerDist) - halfLength;
        float maxPlayerS = MathF.Max(prevPlayerDist, currPlayerDist) + halfLength;

        for (int i = 0; i < _activeObstacles.Count; i++)
        {
            var obs = _activeObstacles[i];
            float obsMinS = obs.Distance - obs.HalfLength;
            float obsMaxS = obs.Distance + obs.HalfLength;

            // Longitudinal interval overlap
            if (maxPlayerS < obsMinS || minPlayerS > obsMaxS)
            {
                continue;
            }

            // Lateral extent overlap
            float dLat = MathF.Abs(playerLateral - obs.LateralOffset);
            if (dLat < (obs.HalfWidth + halfWidth))
            {
                return true;
            }
        }

        return false;
    }

    public void Reset()
    {
        foreach (var obs in _activeObstacles)
        {
            _pool.Release(obs);
        }
        _activeObstacles.Clear();
    }
}
