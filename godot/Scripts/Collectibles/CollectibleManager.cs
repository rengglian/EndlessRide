using System;
using System.Collections.Generic;
using Godot;
using EndlessRide.Core;
using EndlessRide.Track;

namespace EndlessRide.Collectibles;

/// <summary>
/// Spawns, animates (bob & spin), and collects Apples and Golden Horseshoes.
/// Swept longitudinal collection detection with dynamic multiplier integration.
/// Ported from src/collectibles/CollectibleManager.ts.
/// </summary>
public partial class CollectibleManager : Node3D
{
    private SplineTrack _track = null!;
    private CollectiblePool _pool = null!;
    private readonly List<CollectibleEntity> _activeCollectibles = new();
    private float _elapsedTime;

    public void Initialize(SplineTrack track)
    {
        _track = track;
        _pool = new CollectiblePool(this, 16);
    }

    public void SpawnChunkCollectibles(List<CollectibleAnchor> anchors, int chunkIndex)
    {
        RecycleChunkCollectibles(chunkIndex);

        foreach (var anchor in anchors)
        {
            var c = _pool.Acquire(anchor.Type);
            c.Distance = anchor.Distance;
            c.Lane = anchor.Lane;
            c.ChunkIndex = chunkIndex;
            c.Phase = (anchor.Distance * 0.37f) % (MathF.PI * 2.0f);

            float uOffset = anchor.Lane switch
            {
                LaneType.Left => Config.LaneOffsets.Left,
                LaneType.Center => Config.LaneOffsets.Center,
                LaneType.Right => Config.LaneOffsets.Right,
                _ => 0.0f
            };
            c.LateralOffset = uOffset;

            // Banked orientation
            var frame = _track.GetBankedFrameAt(c.Distance, Config.GeometricBankSpeed);
            float groundH = TrackMath.GetGroundHeightAtOffset(uOffset);
            Vector3 pos = frame.Point + frame.Lateral * uOffset + frame.Up * groundH;

            Basis groundBasis = new Basis(frame.Lateral, frame.Up, frame.Tangent);
            c.Node.GlobalPosition = pos;
            c.Node.GlobalBasis = groundBasis;

            c.VisualGroup.Position = Vector3.Zero;
            c.VisualGroup.Rotation = new Vector3(0, c.Phase, 0);

            _activeCollectibles.Add(c);
        }
    }

    public void RecycleChunkCollectibles(int chunkIndex)
    {
        for (int i = _activeCollectibles.Count - 1; i >= 0; i--)
        {
            var c = _activeCollectibles[i];
            if (c.ChunkIndex == chunkIndex)
            {
                _pool.Release(c);
                int lastIdx = _activeCollectibles.Count - 1;
                _activeCollectibles[i] = _activeCollectibles[lastIdx];
                _activeCollectibles.RemoveAt(lastIdx);
            }
        }
    }

    public void UpdateAnimation(float dt)
    {
        _elapsedTime += dt;

        for (int i = 0; i < _activeCollectibles.Count; i++)
        {
            var c = _activeCollectibles[i];
            c.VisualGroup.RotateY(dt * 2.6f);
            c.VisualGroup.Position = new Vector3(0, MathF.Sin(_elapsedTime * 3.8f + c.Phase) * 0.12f, 0);
        }
    }

    /// <summary>
    /// Swept longitudinal collection check against horse trajectory.
    /// Collected items are immediately returned to pool.
    /// </summary>
    public int CheckPlayerCollection(
        float prevPlayerDist,
        float currPlayerDist,
        float playerLateral,
        Action<CollectibleType>? onCollect = null)
    {
        float minS = MathF.Min(prevPlayerDist, currPlayerDist) - 0.9f;
        float maxS = MathF.Max(prevPlayerDist, currPlayerDist) + 0.9f;
        int collectedCount = 0;

        for (int i = _activeCollectibles.Count - 1; i >= 0; i--)
        {
            var c = _activeCollectibles[i];

            if (c.Distance < minS || c.Distance > maxS)
                continue;

            if (MathF.Abs(playerLateral - c.LateralOffset) < 1.15f)
            {
                collectedCount++;
                onCollect?.Invoke(c.Type);

                _pool.Release(c);
                int lastIdx = _activeCollectibles.Count - 1;
                _activeCollectibles[i] = _activeCollectibles[lastIdx];
                _activeCollectibles.RemoveAt(lastIdx);
            }
        }

        return collectedCount;
    }

    public void Reset()
    {
        foreach (var c in _activeCollectibles)
        {
            _pool.Release(c);
        }
        _activeCollectibles.Clear();
        _elapsedTime = 0.0f;
    }
}
