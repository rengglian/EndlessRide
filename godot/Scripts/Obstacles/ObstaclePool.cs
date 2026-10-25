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
    private readonly StandardMaterial3D _woodMat;
    private readonly StandardMaterial3D _hurdleWhiteMat;
    private readonly StandardMaterial3D _hurdleRedMat;

    public ObstaclePool(Node3D parent, int initialPoolSize = 16)
    {
        _parent = parent;

        _rockMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.39f, 0.45f, 0.55f),
            Roughness = 0.9f,
            Metallic = 0.1f
        };

        _woodMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.36f, 0.23f, 0.13f),
            Roughness = 0.85f,
            Metallic = 0.05f
        };

        _hurdleWhiteMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.97f, 0.98f, 0.99f),
            Roughness = 0.5f
        };

        _hurdleRedMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.94f, 0.27f, 0.27f),
            Roughness = 0.5f
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
                var mesh = new SphereMesh { Radius = 0.85f, Height = 1.4f, RadialSegments = 6, Rings = 4, Material = _rockMat };
                var inst = new MeshInstance3D { Mesh = mesh, Position = new Vector3(0, 0.65f, 0) };
                node.AddChild(inst);
                halfWidth = 0.85f;
                halfLength = 0.75f;
                break;
            }

            case ObstacleType.Log:
            {
                var mesh = new CylinderMesh { TopRadius = 0.35f, BottomRadius = 0.40f, Height = 2.4f, RadialSegments = 8, Material = _woodMat };
                var inst = new MeshInstance3D { Mesh = mesh, Position = new Vector3(0, 0.35f, 0) };
                inst.RotationDegrees = new Vector3(0, 0, 90.0f); // Lie across track lane
                node.AddChild(inst);
                halfWidth = 1.20f;
                halfLength = 0.45f;
                break;
            }

            case ObstacleType.Hurdle:
            {
                // Posts
                var postMesh = new CylinderMesh { TopRadius = 0.08f, BottomRadius = 0.08f, Height = 1.35f, RadialSegments = 6, Material = _hurdleWhiteMat };
                var postL = new MeshInstance3D { Mesh = postMesh, Position = new Vector3(-1.15f, 0.65f, 0) };
                var postR = new MeshInstance3D { Mesh = postMesh, Position = new Vector3(1.15f, 0.65f, 0) };
                node.AddChild(postL);
                node.AddChild(postR);

                // Bar
                var barMesh = new BoxMesh { Size = new Vector3(2.35f, 0.16f, 0.10f), Material = _hurdleRedMat };
                var barInst = new MeshInstance3D { Mesh = barMesh, Position = new Vector3(0, 1.15f, 0) };
                node.AddChild(barInst);

                halfWidth = 1.15f;
                halfLength = 0.35f;
                break;
            }

            case ObstacleType.Fence:
            {
                var postMesh = new BoxMesh { Size = new Vector3(0.20f, 1.20f, 0.20f), Material = _woodMat };
                var postL = new MeshInstance3D { Mesh = postMesh, Position = new Vector3(-1.15f, 0.60f, 0) };
                var postR = new MeshInstance3D { Mesh = postMesh, Position = new Vector3(1.15f, 0.60f, 0) };
                node.AddChild(postL);
                node.AddChild(postR);

                var railMesh = new BoxMesh { Size = new Vector3(2.40f, 0.14f, 0.10f), Material = _woodMat };
                var rail1 = new MeshInstance3D { Mesh = railMesh, Position = new Vector3(0, 0.50f, 0) };
                var rail2 = new MeshInstance3D { Mesh = railMesh, Position = new Vector3(0, 0.95f, 0) };
                node.AddChild(rail1);
                node.AddChild(rail2);

                halfWidth = 1.20f;
                halfLength = 0.35f;
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
