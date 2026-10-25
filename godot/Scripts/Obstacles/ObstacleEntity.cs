using Godot;
using EndlessRide.Track;

namespace EndlessRide.Obstacles;

public class ObstacleEntity
{
    public int Id { get; set; }
    public ObstacleType Type { get; set; }
    public Node3D Node { get; set; } = null!;
    public float Distance { get; set; }
    public LaneType Lane { get; set; }
    public float LateralOffset { get; set; }
    public bool Active { get; set; }
    public int ChunkIndex { get; set; }
    public float HalfWidth { get; set; } = 0.85f;
    public float HalfLength { get; set; } = 0.75f;
}
