using System.Collections.Generic;

namespace EndlessRide.Core;

/// <summary>
/// Centralized Game Configuration & Tuning Constants.
/// Ported from src/config.ts to maintain 1:1 mathematical parity.
/// </summary>
public static class Config
{
    public const float BaseSpeed = 9.0f;
    public const float MaxSpeed = 24.0f;
    public const float SteerMaxSpeed = 12.0f;
    public const float MaxLateralOffset = 3.5f;

    public const float ChunkLength = 50.0f;
    public const int ChunkSegments = 40;
    public const float PathHalfWidth = 3.8f;
    public const int ChunksAhead = 4;
    public const int ChunksBehind = 1;

    /// <summary>
    /// Fixed speed used for closed-form track geometry banking
    /// </summary>
    public const float GeometricBankSpeed = 12.0f;

    /// <summary>
    /// Lateral offsets in metres for the three runner lanes
    /// </summary>
    public static class LaneOffsets
    {
        public const float Left = -2.3f;
        public const float Center = 0.0f;
        public const float Right = 2.3f;
    }

    public const float UvDistancePeriod = 1200.0f;

    /// <summary>
    /// Collectible Scoring & Dynamic Multiplier Tuning
    /// </summary>
    public const int AppleBonusScore = 25;
    public const int HorseshoeBonusScore = 75;
    public const float AppleMultiplierStep = 0.2f;
    public const float HorseshoeMultiplierStep = 0.5f;
    public const float MaxScoreMultiplier = 5.0f;
    public const float MultiplierHoldDuration = 7.0f; // seconds before multiplier starts decaying
    public const float MultiplierDecayRate = 0.35f;   // decay per second after hold expires

    public const float CountdownSeconds = 3.0f;
    public const float BoardHoldToStartSeconds = 1.6f;

    public enum DifficultyPreset
    {
        Relaxed,
        Standard,
        Pro
    }

    public record DifficultyConfig(string Label, float BaseSpeed, float MaxSpeed, float AccelRate);

    public static readonly IReadOnlyDictionary<DifficultyPreset, DifficultyConfig> DifficultyPresets =
        new Dictionary<DifficultyPreset, DifficultyConfig>
        {
            [DifficultyPreset.Relaxed] = new("Relaxed", 7.0f, 18.0f, 0.35f),    // 25 km/h -> 65 km/h
            [DifficultyPreset.Standard] = new("Standard", 9.0f, 24.0f, 0.45f),  // 32 km/h -> 86 km/h
            [DifficultyPreset.Pro] = new("Pro Rodeo", 14.0f, 29.0f, 0.60f)     // 50 km/h -> 105 km/h
        };
}
