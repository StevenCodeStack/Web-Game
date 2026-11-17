import * as CANNON from 'cannon-es';
import type { ArenaBlock, ArenaMap, ClientInputCmd, TeamId } from '../shared/types.ts';

// Collision groups
export const GROUP_WORLD = 1;
export const GROUP_PLAYER = 2;
export const GROUP_HITBOX = 4;

export interface PhysicsPlayer {
  id: string;
  team: TeamId;
  body: CANNON.Body;
  hitbox: CANNON.Body;
  grounded: boolean;
  lastGroundTime: number;
  yaw: number;
  pitch: number;
}

export interface RaycastHitResult {
  hitPoint: [number, number, number];
  distance: number;
  hitPlayerId?: string;
  headshot: boolean;
}

const PLAYER_RADIUS = 0.44;
const PLAYER_EYE_HEIGHT = 1.56;
const WALK_SPEED = 7.4;
const SPRINT_SPEED = 10.2;
const JUMP_VELOCITY = 6.9;

export class ArenaPhysicsWorld {
  public readonly world: CANNON.World;
  public readonly map: ArenaMap;
  private readonly defaultMat: CANNON.Material;
  private readonly playerMat: CANNON.Material;
  private readonly players = new Map<string, PhysicsPlayer>();
  private readonly hitboxToPlayerId = new Map<number, string>();

  constructor(map: ArenaMap) {
    this.map = map;
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -19.5, 0),
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = false;

    this.defaultMat = new CANNON.Material('world');
    this.playerMat = new CANNON.Material('player');

    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.playerMat, this.defaultMat, {
        friction: 0.0,
        restitution: 0.0,
      }),
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.playerMat, this.playerMat, {
        friction: 0.0,
        restitution: 0.0,
      }),
    );

    this.buildArenaGeometry();
  }

  private addStaticBox(
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    quat?: CANNON.Quaternion,
  ): void {
    const body = new CANNON.Body({
      mass: 0,
      material: this.defaultMat,
      collisionFilterGroup: GROUP_WORLD,
      collisionFilterMask: GROUP_PLAYER | GROUP_HITBOX,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
    body.position.set(cx, cy, cz);
    if (quat) {
      body.quaternion.copy(quat);
    }
    this.world.addBody(body);
  }

  private buildRamp(block: ArenaBlock): void {
    const length = Math.hypot(block.w, block.h);
    const thickness = 0.36;
    const slopeAngle = Math.atan2(block.h, block.w);

    const qYaw = new CANNON.Quaternion();
    qYaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), block.rotY || 0);
    const qSlope = new CANNON.Quaternion();
    qSlope.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), slopeAngle);
    const qTotal = qYaw.mult(qSlope);

    const cy = block.y + block.h / 2 - (thickness / 2) * Math.cos(slopeAngle);
    this.addStaticBox(block.x, cy, block.z, length, thickness, block.d, qTotal);
  }

  private buildArenaGeometry(): void {
    const { width, depth, ceilingHeight, blocks } = this.map;

    // Floor slab
    this.addStaticBox(0, -0.5, 0, width + 4, 1.0, depth + 4);
    // Ceiling slab
    this.addStaticBox(0, ceilingHeight + 0.5, 0, width + 4, 1.0, depth + 4);

    // 4 Perimeter containment walls
    const wallT = 1.5;
    this.addStaticBox(0, ceilingHeight / 2, -(depth / 2 + wallT / 2), width + wallT * 2, ceilingHeight, wallT);
    this.addStaticBox(0, ceilingHeight / 2, depth / 2 + wallT / 2, width + wallT * 2, ceilingHeight, wallT);
    this.addStaticBox(-(width / 2 + wallT / 2), ceilingHeight / 2, 0, wallT, ceilingHeight, depth);
    this.addStaticBox(width / 2 + wallT / 2, ceilingHeight / 2, 0, wallT, ceilingHeight, depth);

    // Arena blocks
    for (const block of blocks) {
      if (block.type === 'ramp') {
        this.buildRamp(block);
      } else {
        const q = new CANNON.Quaternion();
        if (block.rotY) {
          q.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), block.rotY);
        }
        this.addStaticBox(block.x, block.y + block.h / 2, block.z, block.w, block.h, block.d, q);
      }
    }
  }

  public addPlayer(id: string, team: TeamId, x: number, y: number, z: number, yaw: number): PhysicsPlayer {
    const body = new CANNON.Body({
      mass: 75,
      material: this.playerMat,
      fixedRotation: true,
      linearDamping: 0.02,
      collisionFilterGroup: GROUP_PLAYER,
      collisionFilterMask: GROUP_WORLD | GROUP_PLAYER,
    });
    // Bottom sphere at offset y = PLAYER_RADIUS, upper sphere at y = 1.32 so total height ~ 1.76m
    body.addShape(new CANNON.Sphere(PLAYER_RADIUS), new CANNON.Vec3(0, PLAYER_RADIUS, 0));
    body.addShape(new CANNON.Sphere(PLAYER_RADIUS), new CANNON.Vec3(0, 1.25, 0));
    body.position.set(x, y, z);

    // Kinematic hitbox for laser raycast detection
    const hitbox = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      collisionResponse: false,
      collisionFilterGroup: GROUP_HITBOX,
      collisionFilterMask: 0,
    });
    hitbox.addShape(new CANNON.Box(new CANNON.Vec3(0.45, 0.88, 0.45)));
    hitbox.position.set(x, y + 0.88, z);

    this.world.addBody(body);
    this.world.addBody(hitbox);

    const p: PhysicsPlayer = {
      id,
      team,
      body,
      hitbox,
      grounded: false,
      lastGroundTime: 0,
      yaw,
      pitch: 0,
    };
    this.players.set(id, p);
    this.hitboxToPlayerId.set(hitbox.id, id);
    return p;
  }

  public removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.world.removeBody(p.body);
    this.world.removeBody(p.hitbox);
    this.hitboxToPlayerId.delete(p.hitbox.id);
    this.players.delete(id);
  }

  public getPlayerPosition(id: string): { x: number; y: number; z: number } | null {
    const p = this.players.get(id);
    if (!p) return null;
    return { x: p.body.position.x, y: p.body.position.y, z: p.body.position.z };
  }

  public teleportPlayer(id: string, x: number, y: number, z: number, yaw: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.body.position.set(x, y, z);
    p.body.velocity.set(0, 0, 0);
    p.hitbox.position.set(x, y + 0.88, z);
    p.yaw = yaw;
    p.pitch = 0;
  }

  public applyPlayerInput(id: string, cmd: ClientInputCmd, nowMs: number): void {
    const p = this.players.get(id);
    if (!p) return;

    p.yaw = cmd.yaw;
    p.pitch = Math.max(-1.45, Math.min(1.45, cmd.pitch));

    // Check grounded via short downward raycast
    const footFrom = new CANNON.Vec3(p.body.position.x, p.body.position.y + 0.35, p.body.position.z);
    const footTo = new CANNON.Vec3(p.body.position.x, p.body.position.y - 0.14, p.body.position.z);
    const groundResult = new CANNON.RaycastResult();
    this.world.raycastClosest(
      footFrom,
      footTo,
      { collisionFilterMask: GROUP_WORLD, skipBackfaces: true },
      groundResult,
    );
    p.grounded = groundResult.hasHit;
    if (p.grounded) {
      p.lastGroundTime = nowMs;
    }

    const fwd = Math.max(-1, Math.min(1, cmd.forward));
    const str = Math.max(-1, Math.min(1, cmd.strafe));
    const speed = cmd.sprint ? SPRINT_SPEED : WALK_SPEED;

    // Three.js camera forward with yaw: (-sin(yaw), 0, -cos(yaw)), right: (cos(yaw), 0, -sin(yaw))
    const sinY = Math.sin(p.yaw);
    const cosY = Math.cos(p.yaw);
    let vx = (-sinY * fwd + cosY * str);
    let vz = (-cosY * fwd - sinY * str);
    const len = Math.hypot(vx, vz);
    if (len > 1e-4) {
      vx = (vx / Math.max(1, len)) * speed;
      vz = (vz / Math.max(1, len)) * speed;
    } else {
      vx = 0;
      vz = 0;
    }

    p.body.velocity.x = vx;
    p.body.velocity.z = vz;

    // Coyote-time jump (120ms grace window)
    if (cmd.jump && (p.grounded || nowMs - p.lastGroundTime < 120) && p.body.velocity.y < 1.5) {
      p.body.velocity.y = JUMP_VELOCITY;
      p.grounded = false;
      p.lastGroundTime = 0;
    }
  }

  public setDroneVelocity(id: string, vx: number, vy: number, vz: number, yaw: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.body.velocity.set(vx, vy, vz);
    p.yaw = yaw;
  }

  public step(dt: number): void {
    this.world.step(dt);
    // Sync hitboxes & clamp bounds
    const halfW = this.map.width / 2 - 0.5;
    const halfD = this.map.depth / 2 - 0.5;
    for (const p of this.players.values()) {
      if (p.body.position.y < -2) {
        p.body.position.y = 0.2;
        p.body.velocity.y = 0;
      }
      p.body.position.x = Math.max(-halfW, Math.min(halfW, p.body.position.x));
      p.body.position.z = Math.max(-halfD, Math.min(halfD, p.body.position.z));
      p.hitbox.position.set(p.body.position.x, p.body.position.y + 0.88, p.body.position.z);
    }
  }

  public raycastLaser(
    shooterId: string,
    yaw: number,
    pitch: number,
    maxDistance = 120,
    ignoreDeadIds?: Set<string>,
  ): { start: [number, number, number]; hit: RaycastHitResult } {
    const shooter = this.players.get(shooterId);
    if (!shooter) {
      return {
        start: [0, PLAYER_EYE_HEIGHT, 0],
        hit: { hitPoint: [0, PLAYER_EYE_HEIGHT, -maxDistance], distance: maxDistance, headshot: false },
      };
    }

    const sx = shooter.body.position.x;
    const sy = shooter.body.position.y + PLAYER_EYE_HEIGHT;
    const sz = shooter.body.position.z;

    const cosP = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cosP;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cosP;

    const from = new CANNON.Vec3(sx, sy, sz);
    const to = new CANNON.Vec3(sx + dx * maxDistance, sy + dy * maxDistance, sz + dz * maxDistance);

    let closestDist = maxDistance;
    let closestPoint: [number, number, number] = [to.x, to.y, to.z];
    let closestPlayerId: string | undefined;
    let headshot = false;

    this.world.raycastAll(
      from,
      to,
      { collisionFilterMask: GROUP_WORLD | GROUP_HITBOX, skipBackfaces: true },
      (result) => {
        if (!result.hasHit || !result.body) return;
        const hitPlayerId = this.hitboxToPlayerId.get(result.body.id);
        if (hitPlayerId) {
          if (hitPlayerId === shooterId) return;
          if (ignoreDeadIds && ignoreDeadIds.has(hitPlayerId)) return;
        }
        if (result.distance < closestDist) {
          closestDist = result.distance;
          closestPoint = [result.hitPointWorld.x, result.hitPointWorld.y, result.hitPointWorld.z];
          closestPlayerId = hitPlayerId;
          if (hitPlayerId) {
            const target = this.players.get(hitPlayerId);
            if (target) {
              const relY = result.hitPointWorld.y - target.body.position.y;
              headshot = relY >= 1.32;
            }
          } else {
            headshot = false;
          }
        }
      },
    );

    return {
      start: [sx, sy, sz],
      hit: {
        hitPoint: closestPoint,
        distance: closestDist,
        hitPlayerId: closestPlayerId,
        headshot,
      },
    };
  }
}
