using System.Collections.Generic;
using Godot;
using EndlessRide.Track;

namespace EndlessRide.Obstacles;

/// <summary>
/// Pre-allocated object pool for obstacles (rock, log, hurdle, fence)
/// with shared materials and geometries.
/// Ported from src/obstacles/ObstaclePool.ts.
/// </summary>
public class ObstaclePool
{
    private readonly Node3D _parent;
    private readonly Dictionary<ObstacleType, Stack<ObstacleEntity>> _pools = new();
    private int _nextId;

    private readonly StandardMaterial3D _rockMat;
    private readonly StandardMaterial3D _rockMossMat;
    private readonly StandardMaterial3D _woodMat;
    private readonly StandardMaterial3D _woodEndMat;
    private readonly StandardMaterial3D _hurdleWingMat;
    private readonly StandardMaterial3D _hurdleWhiteMat;
    private readonly StandardMaterial3D _hurdleRedMat;
    private readonly StandardMaterial3D _fenceWhiteRailMat;

    public ObstaclePool(Node3D parent, int initialPoolSize = 16)
    {
        _parent = parent;

        // Dark charcoal granite for high contrast against light cobblestone road
        _rockMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.24f, 0.23f, 0.25f),
            Roughness = 0.95f,
            Metallic = 0.05f
        };

        _rockMossMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.26f, 0.46f, 0.18f),
            Roughness = 0.90f
        };

        _woodMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.25f, 0.16f, 0.09f),
            Roughness = 0.85f,
            Metallic = 0.05f
        };

        _woodEndMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.68f, 0.54f, 0.36f),
            Roughness = 0.80f
        };

        // Bold Royal Blue equestrian jump standards (wings)
        _hurdleWingMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.10f, 0.24f, 0.62f),
            Roughness = 0.45f
        };

        // High-visibility striped warning bar materials
        _hurdleWhiteMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.96f, 0.96f, 0.97f),
            Roughness = 0.40f
        };

        _hurdleRedMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.88f, 0.14f, 0.14f),
            Roughness = 0.40f
        };

        _fenceWhiteRailMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.94f, 0.94f, 0.95f),
            Roughness = 0.55f
        };

        ObstacleType[] types = { ObstacleType.Rock, ObstacleType.Log, ObstacleType.Hurdle, ObstacleType.Fence };
        foreach (var type in types)
        {
            _pools[type] = new Stack<ObstacleEntity>();
            for (int i = 0; i < initialPoolSize; i++)
            {
                var entity = CreateEntity(type);
                entity.Active = false;
                entity.Node.Visible = false;
                _parent.AddChild(entity.Node);
                _pools[type].Push(entity);
            }
        }
    }

    public ObstacleEntity Acquire(ObstacleType type)
    {
        if (_pools[type].Count > 0)
        {
            var entity = _pools[type].Pop();
            entity.Active = true;
            entity.Node.Visible = true;
            return entity;
        }

        var newEntity = CreateEntity(type);
        newEntity.Active = true;
        newEntity.Node.Visible = true;
        _parent.AddChild(newEntity.Node);
        return newEntity;
    }

    public void Release(ObstacleEntity entity)
    {
        entity.Active = false;
        entity.Node.Visible = false;
        _pools[entity.Type].Push(entity);
    }

    private ObstacleEntity CreateEntity(ObstacleType type)
    {
        var node = new Node3D { Name = $"Obstacle_{type}_{_nextId++}" };
        float halfWidth = 0.85f;
        float halfLength = 0.75f;

        switch (type)
        {
            case ObstacleType.Rock:
            {
                // Multi-faceted rugged dark granite boulder cluster
                var mainRockMesh = new SphereMesh { Radius = 0.85f, Height = 1.35f, RadialSegments = 6, Rings = 4, Material = _rockMat };
                var mainRockInst = new MeshInstance3D { Mesh = mainRockMesh, Position = new Vector3(0, 0.65f, 0) };
                mainRockInst.RotationDegrees = new Vector3(15.0f, 25.0f, 0);
                node.AddChild(mainRockInst);

                // Secondary companion boulder
                var subRock1Mesh = new SphereMesh { Radius = 0.52f, Height = 0.85f, RadialSegments = 5, Rings = 3, Material = _rockMat };
                var subRock1Inst = new MeshInstance3D { Mesh = subRock1Mesh, Position = new Vector3(0.55f, 0.40f, 0.15f) };
                subRock1Inst.RotationDegrees = new Vector3(-20.0f, 40.0f, 15.0f);
                node.AddChild(subRock1Inst);

                // Small foot rock
                var subRock2Mesh = new SphereMesh { Radius = 0.38f, Height = 0.60f, RadialSegments = 5, Rings = 3, Material = _rockMat };
                var subRock2Inst = new MeshInstance3D { Mesh = subRock2Mesh, Position = new Vector3(-0.52f, 0.30f, -0.10f) };
                node.AddChild(subRock2Inst);

                // Moss crown on top
                var mossMesh = new SphereMesh { Radius = 0.42f, Height = 0.28f, RadialSegments = 5, Rings = 2, Material = _rockMossMat };
                var mossInst = new MeshInstance3D { Mesh = mossMesh, Position = new Vector3(0.05f, 1.20f, 0.05f) };
                node.AddChild(mossInst);

                halfWidth = 0.95f;
                halfLength = 0.75f;
                break;
            }

            case ObstacleType.Log:
            {
                // Dark walnut trunk
                var mesh = new CylinderMesh { TopRadius = 0.35f, BottomRadius = 0.40f, Height = 2.4f, RadialSegments = 8, Material = _woodMat };
                var inst = new MeshInstance3D { Mesh = mesh, Position = new Vector3(0, 0.35f, 0) };
                inst.RotationDegrees = new Vector3(0, 0, 90.0f);
                node.AddChild(inst);

                // Light heartwood cut ends
                var endMeshL = new CylinderMesh { TopRadius = 0.34f, BottomRadius = 0.34f, Height = 0.04f, RadialSegments = 8, Material = _woodEndMat };
                var endInstL = new MeshInstance3D { Mesh = endMeshL, Position = new Vector3(-1.21f, 0.35f, 0) };
                endInstL.RotationDegrees = new Vector3(0, 0, 90.0f);
                node.AddChild(endInstL);

                var endMeshR = new CylinderMesh { TopRadius = 0.39f, BottomRadius = 0.39f, Height = 0.04f, RadialSegments = 8, Material = _woodEndMat };
                var endInstR = new MeshInstance3D { Mesh = endMeshR, Position = new Vector3(1.21f, 0.35f, 0) };
                endInstR.RotationDegrees = new Vector3(0, 0, 90.0f);
                node.AddChild(endInstR);

                // Branch stub knot
                var branchMesh = new CylinderMesh { TopRadius = 0.09f, BottomRadius = 0.14f, Height = 0.42f, RadialSegments = 6, Material = _woodMat };
                var branchInst = new MeshInstance3D { Mesh = branchMesh, Position = new Vector3(0.32f, 0.65f, 0.12f) };
                branchInst.RotationDegrees = new Vector3(25.0f, 0, -18.0f);
                node.AddChild(branchInst);

                halfWidth = 1.25f;
                halfLength = 0.45f;
                break;
            }

            case ObstacleType.Hurdle:
            {
                // High-visibility Royal Blue equestrian standard wings
                var wingPostMesh = new BoxMesh { Size = new Vector3(0.20f, 1.45f, 0.20f), Material = _hurdleWingMat };
                var wingBaseMesh = new BoxMesh { Size = new Vector3(0.28f, 0.14f, 0.85f), Material = _hurdleWingMat };
                var finialMesh = new SphereMesh { Radius = 0.15f, Height = 0.28f, Material = _hurdleWhiteMat };

                // Left Standard
                var postL = new MeshInstance3D { Mesh = wingPostMesh, Position = new Vector3(-1.20f, 0.72f, 0) };
                var baseL = new MeshInstance3D { Mesh = wingBaseMesh, Position = new Vector3(-1.20f, 0.07f, 0) };
                var finialL = new MeshInstance3D { Mesh = finialMesh, Position = new Vector3(-1.20f, 1.50f, 0) };
                node.AddChild(postL);
                node.AddChild(baseL);
                node.AddChild(finialL);

                // Right Standard
                var postR = new MeshInstance3D { Mesh = wingPostMesh, Position = new Vector3(1.20f, 0.72f, 0) };
                var baseR = new MeshInstance3D { Mesh = wingBaseMesh, Position = new Vector3(1.20f, 0.07f, 0) };
                var finialR = new MeshInstance3D { Mesh = finialMesh, Position = new Vector3(1.20f, 1.50f, 0) };
                node.AddChild(postR);
                node.AddChild(baseR);
                node.AddChild(finialR);

                // Ground silhouette plinth board (anchors the jump visually against the road)
                var plinthMesh = new BoxMesh { Size = new Vector3(2.30f, 0.24f, 0.10f), Material = _hurdleWingMat };
                var plinthInst = new MeshInstance3D { Mesh = plinthMesh, Position = new Vector3(0, 0.18f, 0) };
                node.AddChild(plinthInst);

                // Bold alternating Red / White show-jumping bar (5 segments across 2.30m)
                float segWidth = 0.46f;
                float segY = 1.15f;
                var redSegMesh = new BoxMesh { Size = new Vector3(segWidth - 0.01f, 0.18f, 0.12f), Material = _hurdleRedMat };
                var whiteSegMesh = new BoxMesh { Size = new Vector3(segWidth - 0.01f, 0.18f, 0.12f), Material = _hurdleWhiteMat };

                float[] segOffsets = { -0.92f, -0.46f, 0.0f, 0.46f, 0.92f };
                for (int s = 0; s < segOffsets.Length; s++)
                {
                    var segMesh = (s % 2 == 0) ? redSegMesh : whiteSegMesh;
                    var segInst = new MeshInstance3D { Mesh = segMesh, Position = new Vector3(segOffsets[s], segY, 0) };
                    node.AddChild(segInst);
                }

                halfWidth = 1.25f;
                halfLength = 0.45f;
                break;
            }

            case ObstacleType.Fence:
            {
                // Rustic dark timber fence posts with pyramidal caps
                var postMesh = new BoxMesh { Size = new Vector3(0.22f, 1.35f, 0.22f), Material = _woodMat };
                var capMesh = new PrismMesh { Size = new Vector3(0.26f, 0.18f, 0.26f), Material = _woodMat };

                var postL = new MeshInstance3D { Mesh = postMesh, Position = new Vector3(-1.18f, 0.65f, 0) };
                var capL = new MeshInstance3D { Mesh = capMesh, Position = new Vector3(-1.18f, 1.38f, 0) };
                node.AddChild(postL);
                node.AddChild(capL);

                var postR = new MeshInstance3D { Mesh = postMesh, Position = new Vector3(1.18f, 0.65f, 0) };
                var capR = new MeshInstance3D { Mesh = capMesh, Position = new Vector3(1.18f, 1.38f, 0) };
                node.AddChild(postR);
                node.AddChild(capR);

                // High-visibility contrasting white rails
                var railMesh = new BoxMesh { Size = new Vector3(2.42f, 0.15f, 0.10f), Material = _fenceWhiteRailMat };
                var railTop = new MeshInstance3D { Mesh = railMesh, Position = new Vector3(0, 1.08f, 0) };
                var railBottom = new MeshInstance3D { Mesh = railMesh, Position = new Vector3(0, 0.42f, 0) };
                node.AddChild(railTop);
                node.AddChild(railBottom);

                // Timber X-cross brace
                var braceMesh = new BoxMesh { Size = new Vector3(2.60f, 0.10f, 0.05f), Material = _woodMat };
                var brace1 = new MeshInstance3D { Mesh = braceMesh, Position = new Vector3(0, 0.75f, 0.02f) };
                brace1.RotationDegrees = new Vector3(0, 0, 16.0f);
                var brace2 = new MeshInstance3D { Mesh = braceMesh, Position = new Vector3(0, 0.75f, -0.02f) };
                brace2.RotationDegrees = new Vector3(0, 0, -16.0f);
                node.AddChild(brace1);
                node.AddChild(brace2);

                halfWidth = 1.25f;
                halfLength = 0.40f;
                break;
            }
        }

        return new ObstacleEntity
        {
            Id = _nextId,
            Type = type,
            Node = node,
            HalfWidth = halfWidth,
            HalfLength = halfLength
        };
    }
}
