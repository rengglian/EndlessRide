using System;
using System.Collections.Generic;
using Godot;
using EndlessRide.Core;

namespace EndlessRide.Track;

public enum LaneType
{
    Left,
    Center,
    Right
}

public enum ObstacleType
{
    Rock,
    Log,
    Hurdle,
    Fence
}

public enum CollectibleType
{
    Apple,
    Horseshoe
}

public record struct ObstacleAnchor(float Distance, LaneType Lane, ObstacleType Type);

public record struct CollectibleAnchor(float Distance, LaneType Lane, CollectibleType Type);

public record struct BankedFrame(
    Vector3 Point,
    Vector3 Tangent,
    Vector3 Lateral,
    Vector3 Up,
    float BankAngle
);

public class TrackChunkGeometryData
{
    public int ChunkIndex { get; set; }
    public float StartDist { get; set; }
    public float ChunkLength { get; set; }
    public float[] Positions { get; set; } = Array.Empty<float>();
    public float[] Normals { get; set; } = Array.Empty<float>();
    public float[] Uvs { get; set; } = Array.Empty<float>();
    public int[] Indices { get; set; } = Array.Empty<int>();
    public List<ObstacleAnchor> ObstacleAnchors { get; set; } = new();
    public List<CollectibleAnchor> CollectibleAnchors { get; set; } = new();
    public int GenerationId { get; set; }
}

/// <summary>
/// Pure, thread-safe track spline mathematics, terrain profiles, and procedural chunk geometry generation.
/// Ported from src/track/trackMath.ts to guarantee exact 1:1 mathematical parity.
/// </summary>
public static class TrackMath
{
    /// <summary>
    /// 72m wide cross-section offsets from centerline in metres.
    /// [-36m (left meadow), -3.8m (curb edge), 0.0m (path center), +3.8m (curb edge), +36m (right meadow)]
    /// </summary>
    public static readonly float[] CrossSectionOffsets =
    {
        -36.0f, -18.0f, -6.5f, -4.0f, -3.8f, 0.0f, 3.8f, 4.0f, 6.5f, 18.0f, 36.0f
    };

    /// <summary>
    /// Height offsets corresponding to CrossSectionOffsets in metres.
    /// </summary>
    public static readonly float[] CrossSectionHeights =
    {
        -0.8f, 0.6f, 0.25f, 0.12f, 0.0f, 0.0f, 0.0f, 0.12f, 0.25f, 0.6f, -0.8f
    };

    /// <summary>
    /// Sample the central spline 3D position at forward parameter s.
    /// </summary>
    public static Vector3 SampleSplinePoint(float s)
    {
        float validS = float.IsNaN(s) ? 0.0f : s;
        float x = 14.0f * MathF.Sin(0.012f * validS) + 6.0f * MathF.Sin(0.028f * validS + 1.2f);
        float y = 3.5f * MathF.Sin(0.018f * validS);
        float z = validS;
        return new Vector3(x, y, z);
    }

    /// <summary>
    /// First derivative dP/ds of the spline.
    /// </summary>
    public static (float dx, float dy, float dz) SampleSplineDerivative(float s)
    {
        float validS = float.IsNaN(s) ? 0.0f : s;
        float dx = 14.0f * 0.012f * MathF.Cos(0.012f * validS) + 6.0f * 0.028f * MathF.Cos(0.028f * validS + 1.2f);
        float dy = 3.5f * 0.018f * MathF.Cos(0.018f * validS);
        float dz = 1.0f;
        return (dx, dy, dz);
    }

    /// <summary>
    /// Arc-length scaling factor |dP/ds| = sqrt(dx^2 + dy^2 + dz^2).
    /// True ground speed ds/dt = speed / SampleArcLengthFactor(s).
    /// </summary>
    public static float SampleArcLengthFactor(float s)
    {
        var (dx, dy, _) = SampleSplineDerivative(s);
        return MathF.Sqrt(dx * dx + dy * dy + 1.0f);
    }

    /// <summary>
    /// Sample the forward unit tangent vector at parameter s.
    /// </summary>
    public static Vector3 SampleSplineTangent(float s)
    {
        var (dx, dy, dz) = SampleSplineDerivative(s);
        float len = MathF.Sqrt(dx * dx + dy * dy + dz * dz);
        if (len <= 0.00001f) len = 1.0f;
        return new Vector3(dx / len, dy / len, dz / len);
    }

    /// <summary>
    /// Compute the track's intrinsic geometric bank roll angle in radians at parameter s.
    /// Speed-independent property of the fixed track geometry.
    /// </summary>
    public static float ComputeGeometricBankAngle(float s)
    {
        float validS = float.IsNaN(s) ? 0.0f : s;
        float d2x = -14.0f * 0.012f * 0.012f * MathF.Sin(0.012f * validS) - 6.0f * 0.028f * 0.028f * MathF.Sin(0.028f * validS + 1.2f);
        float curvature = MathF.Abs(d2x);
        float sign = d2x > 0.0f ? -1.0f : 1.0f;
        const float g = 9.81f;
        float rawBank = (Config.GeometricBankSpeed * Config.GeometricBankSpeed * curvature) / g;
        return Math.Clamp(sign * rawBank * 2.0f, -0.22f, 0.22f);
    }

    /// <summary>
    /// Compute speed-dependent visual lean angle in radians for visual camera/rig.
    /// </summary>
    public static float ComputeVisualBankAngle(float s, float speed)
    {
        float validS = float.IsNaN(s) ? 0.0f : s;
        float validSpeed = float.IsNaN(speed) ? Config.GeometricBankSpeed : speed;
        float d2x = -14.0f * 0.012f * 0.012f * MathF.Sin(0.012f * validS) - 6.0f * 0.028f * 0.028f * MathF.Sin(0.028f * validS + 1.2f);
        float curvature = MathF.Abs(d2x);
        float sign = d2x > 0.0f ? -1.0f : 1.0f;
        const float g = 9.81f;
        float rawBank = (validSpeed * validSpeed * curvature) / g;
        return Math.Clamp(sign * rawBank * 2.0f, -0.22f, 0.22f);
    }

    /// <summary>
    /// Computes the complete banked coordinate frame (point, tangent, lateral, up, bankAngle) at parameter s.
    /// </summary>
    public static BankedFrame ComputeBankedFrame(float s, float speed = Config.GeometricBankSpeed)
    {
        Vector3 point = SampleSplinePoint(s);
        Vector3 tangent = SampleSplineTangent(s);

        // Unbanked rightward horizontal lateral normal: Tangent x UP = (-tangent.z, 0, tangent.x)
        float hNx = -tangent.Z;
        float hNz = tangent.X;
        float hLen = MathF.Sqrt(hNx * hNx + hNz * hNz);
        if (hLen <= 0.00001f) hLen = 1.0f;
        float normX = hNx / hLen;
        float normZ = hNz / hLen;

        // Base upward normal: Lateral x Tangent -> upY = normZ * tangent.x - normX * tangent.z (+1)
        float upX = -tangent.Y * normZ;
        float upY = normZ * tangent.X - normX * tangent.Z;
        float upZ = tangent.Y * normX;

        float bankAngle = MathF.Abs(speed - Config.GeometricBankSpeed) < 0.001f
            ? ComputeGeometricBankAngle(s)
            : ComputeVisualBankAngle(s, speed);

        float cosB = MathF.Cos(bankAngle);
        float sinB = MathF.Sin(bankAngle);

        // Bank lateral and up vectors around tangent (positive bank lowers right edge +u)
        Vector3 lateral = new(
            normX * cosB + upX * sinB,
            upY * sinB,
            normZ * cosB + upZ * sinB
        );

        Vector3 up = new(
            -normX * sinB + upX * cosB,
            upY * cosB,
            -normZ * sinB + upZ * cosB
        );

        return new BankedFrame(point, tangent, lateral, up, bankAngle);
    }

    /// <summary>
    /// Computes terrain surface elevation h(u) at lateral offset u in metres.
    /// </summary>
    public static float GetGroundHeightAtOffset(float u)
    {
        float absU = MathF.Abs(u);
        if (absU <= 3.8f)
        {
            return 0.0f;
        }
        if (absU <= 4.0f)
        {
            return 0.12f * ((absU - 3.8f) / 0.2f);
        }
        if (absU <= 6.5f)
        {
            return 0.12f + 0.13f * ((absU - 4.0f) / 2.5f);
        }
        if (absU <= 18.0f)
        {
            return 0.25f + 0.35f * ((absU - 6.5f) / 11.5f);
        }
        if (absU <= 36.0f)
        {
            return 0.60f - 1.40f * ((absU - 18.0f) / 18.0f);
        }
        return -0.8f;
    }

    /// <summary>
    /// Computes cross-section slope dh/du at lateral offset u in metres.
    /// Used to tilt vertex surface normals for accurate lighting.
    /// </summary>
    public static float GetGroundSlopeAtOffset(float u)
    {
        float absU = MathF.Abs(u);
        float sign = u < 0.0f ? -1.0f : (u > 0.0f ? 1.0f : 0.0f);

        if (absU < 3.8f)
        {
            return 0.0f;
        }
        if (MathF.Abs(absU - 3.8f) < 0.0001f)
        {
            return sign * 0.3f; // Average of flat path (0.0) and curb step (0.6)
        }
        if (absU < 4.0f)
        {
            return sign * 0.6f; // 0.12 / 0.2 = 0.6 (31 degree slope)
        }
        if (MathF.Abs(absU - 4.0f) < 0.0001f)
        {
            return sign * 0.326f; // Average of curb step (0.6) and inner meadow (0.052)
        }
        if (absU < 6.5f)
        {
            return sign * (0.13f / 2.5f); // 0.052
        }
        if (MathF.Abs(absU - 6.5f) < 0.0001f)
        {
            return sign * 0.0412f; // Average of inner meadow (0.052) and hill slope (0.030435)
        }
        if (absU < 18.0f)
        {
            return sign * (0.35f / 11.5f); // ~0.030435
        }
        if (MathF.Abs(absU - 18.0f) < 0.0001f)
        {
            return sign * -0.02367f; // Average of hill rise (0.030435) and outer ditch drop (-0.077778)
        }
        if (absU < 36.0f)
        {
            return sign * (-1.40f / 18.0f); // -0.077778
        }
        if (MathF.Abs(absU - 36.0f) < 0.0001f)
        {
            return sign * -0.03889f; // Average of outer ditch drop (-0.077778) and boundary flat (0.0)
        }
        return 0.0f;
    }

    /// <summary>
    /// 32-bit seeded pseudo-random number generator (Mulberry32).
    /// Returns float values in [0, 1).
    /// </summary>
    public static Func<float> CreateMulberry32(uint seed)
    {
        uint a = seed;
        return () =>
        {
            a += 0x6d2b79f5;
            uint t = a ^ (a >> 15);
            t = Math.Clamp(t, 0, uint.MaxValue);
            t = (uint)((ulong)t * (1 | a));
            t ^= t + (uint)((ulong)(t ^ (t >> 7)) * (61 | t));
            return (float)((t ^ (t >> 14)) / 4294967296.0);
        };
    }

    /// <summary>
    /// Seeded obstacle generation with distance-based difficulty progression.
    /// </summary>
    public static List<ObstacleAnchor> GenerateObstacleAnchors(
        float startDist,
        float chunkLength,
        int chunkIndex,
        uint runSeed = 1337)
    {
        var anchors = new List<ObstacleAnchor>();
        LaneType[] lanes = { LaneType.Left, LaneType.Center, LaneType.Right };
        ObstacleType[] types = { ObstacleType.Rock, ObstacleType.Log, ObstacleType.Hurdle, ObstacleType.Fence };

        uint seed = runSeed ^ (uint)(chunkIndex * 2654435761L);
        var rng = CreateMulberry32(seed);

        float progress = Math.Clamp(startDist / 2500.0f, 0.0f, 1.0f);
        float baseSpacing = 26.0f - 9.0f * progress;
        float doubleProb = 0.35f + 0.33f * progress;

        float startOffset = MathF.Max(20.0f, 40.0f - startDist);
        float d = startOffset;

        while (d < chunkLength - 8.0f)
        {
            float worldDist = startDist + d;
            bool isDouble = rng() < doubleProb;

            if (!isDouble)
            {
                int laneIdx = (int)MathF.Floor(rng() * 3.0f);
                int typeIdx = (int)MathF.Floor(rng() * types.Length);
                anchors.Add(new ObstacleAnchor(worldDist, lanes[laneIdx], types[typeIdx]));
            }
            else
            {
                int openLaneIndex = (int)MathF.Floor(rng() * 3.0f);
                for (int l = 0; l < 3; l++)
                {
                    if (l != openLaneIndex)
                    {
                        int typeIdx = (int)MathF.Floor(rng() * types.Length);
                        anchors.Add(new ObstacleAnchor(worldDist, lanes[l], types[typeIdx]));
                    }
                }
            }

            d += baseSpacing + rng() * 6.0f;
        }

        return anchors;
    }

    /// <summary>
    /// Seeded collectible generation (Apples & Horseshoes) with risk/reward wave distribution.
    /// </summary>
    public static List<CollectibleAnchor> GenerateCollectibleAnchors(
        float startDist,
        float chunkLength,
        int chunkIndex,
        List<ObstacleAnchor> obstacleAnchors,
        uint runSeed = 1337)
    {
        var collectibles = new List<CollectibleAnchor>();
        LaneType[] lanes = { LaneType.Left, LaneType.Center, LaneType.Right };

        uint seed = runSeed ^ (uint)(chunkIndex * 3266489917L);
        var rng = CreateMulberry32(seed);

        float startOffset = MathF.Max(15.0f, 30.0f - startDist);

        bool IsObstacleNear(float dist, LaneType lane, float threshold = 4.5f)
        {
            foreach (var obs in obstacleAnchors)
            {
                if (obs.Lane == lane && MathF.Abs(obs.Distance - dist) < threshold)
                    return true;
            }
            return false;
        }

        bool IsCollectibleNear(float dist, LaneType lane, float threshold = 1.5f)
        {
            foreach (var col in collectibles)
            {
                if (col.Lane == lane && MathF.Abs(col.Distance - dist) < threshold)
                    return true;
            }
            return false;
        }

        // a. Risk/Reward Obstacle-Wave Collectibles
        var waveDistances = new List<float>();
        foreach (var obs in obstacleAnchors)
        {
            bool alreadyExists = false;
            foreach (var wd in waveDistances)
            {
                if (MathF.Abs(wd - obs.Distance) < 2.0f)
                {
                    alreadyExists = true;
                    break;
                }
            }
            if (!alreadyExists)
            {
                waveDistances.Add(obs.Distance);
            }
        }

        foreach (float waveDist in waveDistances)
        {
            if (waveDist < startDist + startOffset || waveDist > startDist + chunkLength - 4.0f)
                continue;

            if (rng() < 0.65f)
            {
                var openLanes = new List<LaneType>();
                foreach (var l in lanes)
                {
                    if (!IsObstacleNear(waveDist, l, 5.0f))
                        openLanes.Add(l);
                }

                if (openLanes.Count > 0)
                {
                    var chosenLane = openLanes[(int)MathF.Floor(rng() * openLanes.Count)];
                    bool isDoubleWave = openLanes.Count == 1;
                    CollectibleType type = (isDoubleWave && rng() < 0.30f) ? CollectibleType.Horseshoe : CollectibleType.Apple;

                    if (!IsObstacleNear(waveDist, chosenLane, 4.5f) && !IsCollectibleNear(waveDist, chosenLane, 1.5f))
                    {
                        collectibles.Add(new CollectibleAnchor(waveDist, chosenLane, type));
                    }
                }
            }
        }

        // b. Mid-Segment Collectible Streaks
        float d = startOffset + 3.0f;
        while (d < chunkLength - 6.0f)
        {
            float s = startDist + d;
            bool nearAnyWave = false;
            foreach (var obs in obstacleAnchors)
            {
                if (MathF.Abs(obs.Distance - s) < 5.5f)
                {
                    nearAnyWave = true;
                    break;
                }
            }

            if (!nearAnyWave)
            {
                float roll = rng();
                if (roll < 0.50f)
                {
                    var lane = lanes[(int)MathF.Floor(rng() * 3.0f)];
                    int count = rng() < 0.5f ? 2 : 3;
                    for (int k = 0; k < count; k++)
                    {
                        float colDist = s + k * 3.5f;
                        if (colDist < startDist + chunkLength - 3.0f &&
                            !IsObstacleNear(colDist, lane, 4.5f) &&
                            !IsCollectibleNear(colDist, lane, 1.5f))
                        {
                            collectibles.Add(new CollectibleAnchor(colDist, lane, CollectibleType.Apple));
                        }
                    }
                    d += count * 3.5f + 4.0f;
                    continue;
                }
                else if (roll < 0.70f)
                {
                    var lane = lanes[(int)MathF.Floor(rng() * 3.0f)];
                    if (!IsObstacleNear(s, lane, 4.5f) && !IsCollectibleNear(s, lane, 1.5f))
                    {
                        collectibles.Add(new CollectibleAnchor(s, lane, CollectibleType.Horseshoe));
                    }
                    d += 8.0f;
                    continue;
                }
            }

            d += 6.0f + rng() * 4.0f;
        }

        collectibles.Sort((a, b) => a.Distance.CompareTo(b.Distance));
        return collectibles;
    }

    /// <summary>
    /// Single shared track chunk data generator for procedural mesh construction.
    /// </summary>
    public static TrackChunkGeometryData GenerateChunkData(
        int chunkIndex,
        float startDist,
        float chunkLength = Config.ChunkLength,
        int segments = Config.ChunkSegments,
        uint runSeed = 1337,
        int generationId = 0)
    {
        int crossSectionVerts = CrossSectionOffsets.Length;
        int totalVerts = (segments + 1) * crossSectionVerts;

        float[] positions = new float[totalVerts * 3];
        float[] normals = new float[totalVerts * 3];
        float[] uvs = new float[totalVerts * 2];

        float step = chunkLength / segments;
        int vIdx = 0;

        for (int i = 0; i <= segments; i++)
        {
            float s = startDist + i * step;
            var frame = ComputeBankedFrame(s, Config.GeometricBankSpeed);
            float modS = ((s % Config.UvDistancePeriod) + Config.UvDistancePeriod) % Config.UvDistancePeriod;

            for (int j = 0; j < crossSectionVerts; j++)
            {
                float u = CrossSectionOffsets[j];
                float h = CrossSectionHeights[j];
                float slope = GetGroundSlopeAtOffset(u);

                // Vertex position: point + lateral * u + up * h
                positions[vIdx * 3] = frame.Point.X + frame.Lateral.X * u + frame.Up.X * h;
                positions[vIdx * 3 + 1] = frame.Point.Y + frame.Lateral.Y * u + frame.Up.Y * h;
                positions[vIdx * 3 + 2] = frame.Point.Z + frame.Lateral.Z * u + frame.Up.Z * h;

                // Cross-section slope normal: up - slope * lateral, then normalized
                float nx = frame.Up.X - slope * frame.Lateral.X;
                float ny = frame.Up.Y - slope * frame.Lateral.Y;
                float nz = frame.Up.Z - slope * frame.Lateral.Z;
                float nLen = MathF.Sqrt(nx * nx + ny * ny + nz * nz);
                if (nLen <= 0.00001f) nLen = 1.0f;

                normals[vIdx * 3] = nx / nLen;
                normals[vIdx * 3 + 1] = ny / nLen;
                normals[vIdx * 3 + 2] = nz / nLen;

                // Metre-based UVs
                uvs[vIdx * 2] = u;
                uvs[vIdx * 2 + 1] = modS;

                vIdx++;
            }
        }

        int numQuads = segments * (crossSectionVerts - 1);
        int[] indices = new int[numQuads * 6];
        int idx = 0;

        for (int i = 0; i < segments; i++)
        {
            for (int j = 0; j < crossSectionVerts - 1; j++)
            {
                int row1 = i * crossSectionVerts;
                int row2 = (i + 1) * crossSectionVerts;

                int p0 = row1 + j;
                int p1 = row1 + j + 1;
                int p2 = row2 + j + 1;
                int p3 = row2 + j;

                indices[idx++] = p0;
                indices[idx++] = p1;
                indices[idx++] = p2;

                indices[idx++] = p0;
                indices[idx++] = p2;
                indices[idx++] = p3;
            }
        }

        var obstacleAnchors = GenerateObstacleAnchors(startDist, chunkLength, chunkIndex, runSeed);
        var collectibleAnchors = GenerateCollectibleAnchors(startDist, chunkLength, chunkIndex, obstacleAnchors, runSeed);

        return new TrackChunkGeometryData
        {
            ChunkIndex = chunkIndex,
            StartDist = startDist,
            ChunkLength = chunkLength,
            Positions = positions,
            Normals = normals,
            Uvs = uvs,
            Indices = indices,
            ObstacleAnchors = obstacleAnchors,
            CollectibleAnchors = collectibleAnchors,
            GenerationId = generationId
        };
    }
}
