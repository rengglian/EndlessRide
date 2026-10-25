using System;
using Godot;
using EndlessRide.Core;

namespace EndlessRide.Track;

/// <summary>
/// Continuous 3D parametric track spline sampler and transform evaluator.
/// Ported from src/track/SplineTrack.ts.
/// </summary>
public class SplineTrack
{
    public const float HalfWidth = Config.PathHalfWidth;

    /// <summary>
    /// Sample the central spline position at distance s.
    /// </summary>
    public Vector3 GetPointAtDistance(float s)
    {
        return TrackMath.SampleSplinePoint(s);
    }

    /// <summary>
    /// Sample the forward normalized tangent vector at distance s.
    /// </summary>
    public Vector3 GetTangentAtDistance(float s)
    {
        return TrackMath.SampleSplineTangent(s);
    }

    /// <summary>
    /// Arc-length scaling factor |dP/ds|. True ground advance ds = (speed * dt) / factor.
    /// </summary>
    public float GetArcLengthFactor(float s)
    {
        return TrackMath.SampleArcLengthFactor(s);
    }

    /// <summary>
    /// Sample the unbanked horizontal rightward lateral normal vector at distance s.
    /// </summary>
    public Vector3 GetNormalAtDistance(float s)
    {
        Vector3 tan = TrackMath.SampleSplineTangent(s);
        float hNx = -tan.Z;
        float hNz = tan.X;
        float len = MathF.Sqrt(hNx * hNx + hNz * hNz);
        if (len <= 0.00001f) len = 1.0f;
        return new Vector3(hNx / len, 0.0f, hNz / len);
    }

    /// <summary>
    /// Intrinsic geometric banking angle of the track geometry in radians (speed-independent).
    /// </summary>
    public float GetGeometricBankAngle(float s)
    {
        return TrackMath.ComputeGeometricBankAngle(s);
    }

    /// <summary>
    /// Speed-dependent banking angle in radians for visual lean/HUD.
    /// </summary>
    public float GetVisualBankAngle(float s, float speed)
    {
        return TrackMath.ComputeVisualBankAngle(s, speed);
    }

    /// <summary>
    /// Compute banking roll angle in radians at parameter s.
    /// </summary>
    public float GetBankingAngleAtDistance(float s, float forwardSpeed = Config.GeometricBankSpeed)
    {
        return MathF.Abs(forwardSpeed - Config.GeometricBankSpeed) < 0.001f
            ? TrackMath.ComputeGeometricBankAngle(s)
            : TrackMath.ComputeVisualBankAngle(s, forwardSpeed);
    }

    /// <summary>
    /// Computes the complete banked frame (point, tangent, lateral, up, bankAngle) at distance s.
    /// </summary>
    public BankedFrame GetBankedFrameAt(float s, float forwardSpeed = Config.GeometricBankSpeed)
    {
        return TrackMath.ComputeBankedFrame(s, forwardSpeed);
    }

    /// <summary>
    /// Get terrain ground surface height at lateral offset u.
    /// </summary>
    public float GetGroundHeight(float u)
    {
        return TrackMath.GetGroundHeightAtOffset(u);
    }

    /// <summary>
    /// Get terrain cross-section slope dh/du at lateral offset u.
    /// </summary>
    public float GetGroundSlope(float u)
    {
        return TrackMath.GetGroundSlopeAtOffset(u);
    }

    /// <summary>
    /// Compute complete 3D position given forward distance and lateral offset,
    /// accounting for banked surface elevation.
    /// </summary>
    public Vector3 GetPositionAt(float distance, float lateralOffset)
    {
        var frame = GetBankedFrameAt(distance, Config.GeometricBankSpeed);
        float groundH = TrackMath.GetGroundHeightAtOffset(lateralOffset);
        return frame.Point + frame.Lateral * lateralOffset + frame.Up * groundH;
    }

    /// <summary>
    /// Compute complete 3D transform (position, orientation Basis) at distance and lateral offset.
    /// </summary>
    public Transform3D GetTransformAt(float distance, float lateralOffset)
    {
        var frame = GetBankedFrameAt(distance, Config.GeometricBankSpeed);
        float groundH = TrackMath.GetGroundHeightAtOffset(lateralOffset);
        float slope = TrackMath.GetGroundSlopeAtOffset(lateralOffset);

        Vector3 pos = frame.Point + frame.Lateral * lateralOffset + frame.Up * groundH;

        // Surface normal tilted by ground slope:
        Vector3 surfaceNormal = (frame.Up - frame.Lateral * slope).Normalized();
        Vector3 tangent = frame.Tangent.Normalized();
        Vector3 lateral = surfaceNormal.Cross(tangent).Normalized();

        Basis basis = new(lateral, surfaceNormal, tangent);
        return new Transform3D(basis, pos);
    }
}
