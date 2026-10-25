using Godot;
using EndlessRide.Track;

namespace EndlessRide.Collectibles;

public class CollectibleEntity
{
    public int Id { get; set; }
    public CollectibleType Type { get; set; }
    public Node3D Node { get; set; } = null!;
    public Node3D VisualGroup { get; set; } = null!;
    public float Distance { get; set; }
    public LaneType Lane { get; set; }
    public float LateralOffset { get; set; }
    public bool Active { get; set; }
    public int ChunkIndex { get; set; }
    public float Phase { get; set; }
}
