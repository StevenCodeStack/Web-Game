import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  ArenaBlock,
  ArenaMap,
  ClientInputCmd,
  LaserBeamEvent,
  PlayerSnapshot,
  TeamId,
} from '../../shared/types.ts';

// Pre-allocated math helpers (Zero GC in render loop)
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vUp = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

const PLAYER_RADIUS = 0.44;
const EYE_HEIGHT = 1.56;
const WALK_SPEED = 7.4;
const SPRINT_SPEED = 10.2;
const JUMP_VELOCITY = 6.9;
const GRAVITY = -19.5;
const INTERP_DELAY_MS = 100;

interface BufferedSnapshot {
  serverTime: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  alive: boolean;
}

interface RemoteRig {
  group: THREE.Group;
  headGroup: THREE.Group;
  weaponPivot: THREE.Group;
  chestMat: THREE.MeshStandardMaterial;
  visorMat: THREE.MeshStandardMaterial;
  team: TeamId;
  buffer: BufferedSnapshot[];
  lastX: number;
  lastY: number;
  lastZ: number;
}

interface ActiveBeam {
  mesh: THREE.Mesh;
  coreMesh: THREE.Mesh;
  impactRing: THREE.Mesh;
  createdAt: number;
  durationMs: number;
}

interface PadVisual {
  id: string;
  group: THREE.Group;
  ring: THREE.Mesh;
  orb: THREE.Mesh;
  kind: 'shield' | 'overcharge';
}

export interface HudTelemetry {
  x: number;
  z: number;
  yaw: number;
  players: PlayerSnapshot[];
  locked: boolean;
  contextLost: boolean;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function createGridTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0D121B';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle brushed surface noise lines
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }

  // Primary tactical grid line
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 510, 510);

  // Corner brackets
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 24);
  ctx.lineTo(0, 0);
  ctx.lineTo(24, 0);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

function createPanelTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#192130';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, 244, 244);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
  ctx.fillRect(22, 22, 212, 92);
  ctx.fillRect(22, 134, 212, 98);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

export class LaserTagEngine {
  private container: HTMLElement;
  private map: ArenaMap;
  private selfId: string;
  private selfTeam: TeamId;
  private onSendInput: (cmd: ClientInputCmd) => void;
  private onFire: (yaw: number, pitch: number, seq: number) => void;
  private onHudUpdate: (data: HudTelemetry) => void;
  private onPointerLockChange: (locked: boolean) => void;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private isSoftwareGl = false;
  private frameId = 0;
  private disposed = false;
  private clock = new THREE.Clock();

  // First-person viewmodel
  private weaponGroup!: THREE.Group;
  private weaponMuzzleLight!: THREE.PointLight;
  private weaponCoreMat!: THREE.MeshStandardMaterial;
  private recoilAmount = 0;
  private walkBobPhase = 0;

  // Local prediction state
  private localX = 0;
  private localY = 0.2;
  private localZ = 0;
  private localVy = 0;
  private localYaw = 0;
  private localPitch = 0;
  private localAlive = true;
  private localGrounded = true;
  private overchargeUntil = 0;
  private lastFireAt = 0;
  private inputSeq = 0;
  private pendingInputs: ClientInputCmd[] = [];
  private inputAccumulator = 0;
  private serverSnapshots: PlayerSnapshot[] = [];

  // Input flags
  private keys: Record<string, boolean> = {};
  private pointerLocked = false;
  private mouseDown = false;
  private chatOpen = false;

  // Remote rigs, beams, pads
  private remoteRigs = new Map<string, RemoteRig>();
  private activeBeams: ActiveBeam[] = [];
  private padVisuals: PadVisual[] = [];
  private padCooldowns: Record<string, number> = {};

  // Colliders for client-side movement prediction
  private boxColliders: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }[] = [];
  private rampColliders: ArenaBlock[] = [];

  // Disposable resources
  private disposables: { dispose: () => void }[] = [];

  constructor(params: {
    container: HTMLElement;
    map: ArenaMap;
    selfId: string;
    selfTeam: TeamId;
    onSendInput: (cmd: ClientInputCmd) => void;
    onFire: (yaw: number, pitch: number, seq: number) => void;
    onHudUpdate: (data: HudTelemetry) => void;
    onPointerLockChange: (locked: boolean) => void;
  }) {
    this.container = params.container;
    this.map = params.map;
    this.selfId = params.selfId;
    this.selfTeam = params.selfTeam;
    this.onSendInput = params.onSendInput;
    this.onFire = params.onFire;
    this.onHudUpdate = params.onHudUpdate;
    this.onPointerLockChange = params.onPointerLockChange;

    const initialSpawn = this.map.spawns.find((s) => s.team === this.selfTeam) || this.map.spawns[0];
    if (initialSpawn) {
      this.localX = initialSpawn.x;
      this.localY = initialSpawn.y;
      this.localZ = initialSpawn.z;
      this.localYaw = initialSpawn.yaw;
    }

    this.initRendererAndScene();
    this.buildArena();
    this.buildViewModel();
    this.bindEvents();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.startLoop();
  }

  private initRendererAndScene(): void {
    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070a10);
    this.scene.fog = new THREE.FogExp2(0x070a10, 0.014);

    // Mandatory studio environment map for crisp metallic reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    const envTex = pmrem.fromScene(roomEnv, 0.04).texture;
    this.scene.environment = envTex;
    this.disposables.push(envTex);
    roomEnv.dispose();
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(78, width / height, 0.08, 220);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // 3-Point Studio + Arena Lighting (warm key, cool hemisphere fill, rim)
    const hemi = new THREE.HemisphereLight(0x7dd3fc, 0x1e293b, 0.85);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.55);
    keyLight.position.set(18, 28, 16);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 90;
    keyLight.shadow.camera.left = -36;
    keyLight.shadow.camera.right = 36;
    keyLight.shadow.camera.top = 36;
    keyLight.shadow.camera.bottom = -36;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
    rimLight.position.set(-22, 16, -24);
    this.scene.add(rimLight);
  }

  private buildArena(): void {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const gridTex = createGridTexture(maxAniso);
    gridTex.repeat.set(this.map.width / 4, this.map.depth / 4);
    this.disposables.push(gridTex);

    const panelTex = createPanelTexture(maxAniso);
    this.disposables.push(panelTex);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(this.map.width, this.map.depth);
    const floorMat = new THREE.MeshStandardMaterial({
      map: gridTex,
      roughness: 0.72,
      metalness: 0.25,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    this.disposables.push(floorGeo, floorMat);

    // Perimeter containment walls with illuminated trim
    const wallMat = new THREE.MeshStandardMaterial({
      map: panelTex,
      color: 0x1e293b,
      roughness: 0.6,
      metalness: 0.45,
    });
    this.disposables.push(wallMat);

    const halfW = this.map.width / 2;
    const halfD = this.map.depth / 2;
    const h = this.map.ceilingHeight;

    const perimeterDefs = [
      { x: 0, z: -halfD - 0.5, w: this.map.width + 2, d: 1, color: 0x38bdf8 },
      { x: 0, z: halfD + 0.5, w: this.map.width + 2, d: 1, color: 0xf97316 },
      { x: -halfW - 0.5, z: 0, w: 1, d: this.map.depth, color: 0x64748b },
      { x: halfW + 0.5, z: 0, w: 1, d: this.map.depth, color: 0x64748b },
    ];

    for (const pw of perimeterDefs) {
      const g = new THREE.BoxGeometry(pw.w, h, pw.d);
      const m = new THREE.Mesh(g, wallMat);
      m.position.set(pw.x, h / 2, pw.z);
      m.receiveShadow = true;
      this.scene.add(m);
      this.disposables.push(g);

      // Architectural trim strip along mid-wall
      const stripGeo = new THREE.BoxGeometry(pw.w > 2 ? pw.w - 1 : 0.14, 0.14, pw.d > 2 ? pw.d - 1 : 0.14);
      const stripMat = new THREE.MeshStandardMaterial({
        color: pw.color,
        emissive: pw.color,
        emissiveIntensity: 1.6,
        roughness: 0.25,
      });
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(
        pw.x + (pw.x < 0 ? 0.52 : pw.x > 0 ? -0.52 : 0),
        3.2,
        pw.z + (pw.z < 0 ? 0.52 : pw.z > 0 ? -0.52 : 0),
      );
      this.scene.add(strip);
      this.disposables.push(stripGeo, stripMat);
    }

    // Overhead skylight beams
    const beamMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0x94a3b8,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    });
    this.disposables.push(beamMat);
    const trussGeo = new THREE.BoxGeometry(this.map.width - 4, 0.28, 0.6);
    this.disposables.push(trussGeo);
    for (let z = -halfD + 8; z <= halfD - 8; z += 12) {
      const truss = new THREE.Mesh(trussGeo, beamMat);
      truss.position.set(0, h - 0.3, z);
      this.scene.add(truss);
    }

    // Build Arena Blocks
    const neutralBlockMat = new THREE.MeshStandardMaterial({
      map: panelTex,
      color: 0x263145,
      roughness: 0.5,
      metalness: 0.55,
    });
    const cobaltTrimMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 1.4,
      roughness: 0.25,
    });
    const emberTrimMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xea580c,
      emissiveIntensity: 1.4,
      roughness: 0.25,
    });
    const neutralTrimMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      emissive: 0x475569,
      emissiveIntensity: 0.6,
      roughness: 0.35,
    });
    this.disposables.push(neutralBlockMat, cobaltTrimMat, emberTrimMat, neutralTrimMat);

    for (const block of this.map.blocks) {
      const trimMat =
        block.accent === 'cobalt'
          ? cobaltTrimMat
          : block.accent === 'ember'
            ? emberTrimMat
            : neutralTrimMat;

      if (block.type === 'ramp') {
        const length = Math.hypot(block.w, block.h);
        const thickness = 0.36;
        const slopeAngle = Math.atan2(block.h, block.w);

        const group = new THREE.Group();
        group.position.set(block.x, block.y + block.h / 2 - (thickness / 2) * Math.cos(slopeAngle), block.z);
        group.rotation.y = block.rotY || 0;

        const slopeMesh = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, block.d), neutralBlockMat);
        slopeMesh.rotation.z = slopeAngle;
        slopeMesh.castShadow = true;
        slopeMesh.receiveShadow = true;
        group.add(slopeMesh);

        // Edge safety rail strips on ramp
        const railGeo = new THREE.BoxGeometry(length, 0.1, 0.1);
        const rail1 = new THREE.Mesh(railGeo, trimMat);
        rail1.position.set(0, 0.18, block.d / 2 - 0.08);
        rail1.rotation.z = slopeAngle;
        const rail2 = new THREE.Mesh(railGeo, trimMat);
        rail2.position.set(0, 0.18, -block.d / 2 + 0.08);
        rail2.rotation.z = slopeAngle;
        group.add(rail1, rail2);

        this.scene.add(group);
        this.disposables.push(slopeMesh.geometry, railGeo);
        this.rampColliders.push(block);
      } else {
        const group = new THREE.Group();
        group.position.set(block.x, block.y + block.h / 2, block.z);
        group.rotation.y = block.rotY || 0;

        const geo = new THREE.BoxGeometry(block.w, block.h, block.d);
        const mesh = new THREE.Mesh(geo, neutralBlockMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        // Accent top edge trim for visual silhouette clarity
        const capGeo = new THREE.BoxGeometry(block.w + 0.06, 0.12, block.d + 0.06);
        const cap = new THREE.Mesh(capGeo, trimMat);
        cap.position.y = block.h / 2 - 0.08;
        group.add(cap);

        this.scene.add(group);
        this.disposables.push(geo, capGeo);

        // Simple AABB collider for axis-aligned or nearly-axis-aligned boxes
        const cosR = Math.abs(Math.cos(block.rotY || 0));
        const sinR = Math.abs(Math.sin(block.rotY || 0));
        const effW = block.w * cosR + block.d * sinR;
        const effD = block.w * sinR + block.d * cosR;
        this.boxColliders.push({
          minX: block.x - effW / 2,
          maxX: block.x + effW / 2,
          minY: block.y,
          maxY: block.y + block.h,
          minZ: block.z - effD / 2,
          maxZ: block.z + effD / 2,
        });
      }
    }

    // Build Shield & Overcharge Pads
    for (const pad of this.map.pads) {
      const color = pad.kind === 'overcharge' ? 0xf59e0b : 0x10b981;
      const g = new THREE.Group();
      g.position.set(pad.x, pad.y, pad.z);

      const baseGeo = new THREE.CylinderGeometry(1.15, 1.3, 0.12, 24);
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.3 });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 0.06;

      const ringGeo = new THREE.TorusGeometry(0.92, 0.06, 12, 28);
      const ringMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.8,
        roughness: 0.2,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.14;

      const orbGeo = new THREE.OctahedronGeometry(0.32, 0);
      const orbMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.9,
        metalness: 0.3,
        roughness: 0.15,
      });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.y = 0.95;

      g.add(base, ring, orb);
      this.scene.add(g);
      this.padVisuals.push({ id: pad.id, group: g, ring, orb, kind: pad.kind });
      this.disposables.push(baseGeo, baseMat, ringGeo, ringMat, orbGeo, orbMat);
    }
  }

  private buildViewModel(): void {
    // 7-Part Composite Procedural Laser Pulse Carbine attached to Camera
    this.weaponGroup = new THREE.Group();
    const teamHex = this.selfTeam === 'cobalt' ? 0x38bdf8 : 0xf97316;

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e2430, metalness: 0.85, roughness: 0.28 });
    const shroudMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.65, roughness: 0.55 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.9, roughness: 0.22 });
    this.weaponCoreMat = new THREE.MeshStandardMaterial({
      color: teamHex,
      emissive: teamHex,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });
    const opticMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: teamHex,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.65,
      roughness: 0.1,
    });
    this.disposables.push(bodyMat, shroudMat, railMat, this.weaponCoreMat, opticMat);

    // 1. Main receiver hull
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.42), bodyMat);
    // 2. Barrel shroud
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.075, 0.32), shroudMat);
    shroud.position.set(0, 0.015, -0.28);
    // 3. Top picatinny rail
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.022, 0.36), railMat);
    topRail.position.set(0, 0.064, -0.08);
    // 4. Holographic optic housing + lens
    const opticFrame = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.048, 0.08), shroudMat);
    opticFrame.position.set(0, 0.095, -0.02);
    const opticLens = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.028), opticMat);
    opticLens.position.set(0, 0.096, 0.022);
    // 5. Glowing lateral energy core cell
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.03, 0.18), this.weaponCoreMat);
    core.position.set(0, 0.01, -0.06);
    // 6. Muzzle emitter tip
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.07, 12), railMat);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.016, -0.46);
    // 7. Angled foregrip
    const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.09, 0.05), shroudMat);
    foregrip.position.set(0, -0.065, -0.2);
    foregrip.rotation.x = 0.25;

    this.weaponMuzzleLight = new THREE.PointLight(teamHex, 0, 5);
    this.weaponMuzzleLight.position.set(0, 0.03, -0.5);

    this.weaponGroup.add(receiver, shroud, topRail, opticFrame, opticLens, core, muzzle, foregrip, this.weaponMuzzleLight);
    this.weaponGroup.position.set(0.24, -0.22, -0.44);
    this.camera.add(this.weaponGroup);

    this.disposables.push(
      receiver.geometry,
      shroud.geometry,
      topRail.geometry,
      opticFrame.geometry,
      opticLens.geometry,
      core.geometry,
      muzzle.geometry,
      foregrip.geometry,
    );
  }

  private createRemoteRig(player: PlayerSnapshot): RemoteRig {
    const teamHex = player.team === 'cobalt' ? 0x38bdf8 : 0xf97316;
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.72, roughness: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.45, roughness: 0.68 });
    const chestMat = new THREE.MeshStandardMaterial({
      color: teamHex,
      emissive: teamHex,
      emissiveIntensity: 1.5,
      roughness: 0.25,
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: teamHex,
      emissive: teamHex,
      emissiveIntensity: 2.0,
      roughness: 0.15,
    });
    this.disposables.push(armorMat, darkMat, chestMat, visorMat);

    const group = new THREE.Group();

    // 1-2. Grounded boots/legs (pivot at y = 0)
    const legGeo = new THREE.BoxGeometry(0.2, 0.74, 0.22);
    const leftLeg = new THREE.Mesh(legGeo, darkMat);
    leftLeg.position.set(-0.15, 0.37, 0);
    leftLeg.castShadow = true;
    const rightLeg = new THREE.Mesh(legGeo, darkMat);
    rightLeg.position.set(0.15, 0.37, 0);
    rightLeg.castShadow = true;

    // 3. Armored torso
    const torsoGeo = new THREE.BoxGeometry(0.56, 0.64, 0.34);
    const torso = new THREE.Mesh(torsoGeo, armorMat);
    torso.position.set(0, 1.06, 0);
    torso.castShadow = true;

    // 4. Glowing Laser Tag Sensor Chest Plate
    const chestGeo = new THREE.BoxGeometry(0.36, 0.28, 0.38);
    const chest = new THREE.Mesh(chestGeo, chestMat);
    chest.position.set(0, 1.12, 0);

    // 5. Shoulder Pauldrons
    const pauldronGeo = new THREE.BoxGeometry(0.18, 0.16, 0.3);
    const leftPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    leftPauldron.position.set(-0.36, 1.3, 0);
    const rightPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    rightPauldron.position.set(0.36, 1.3, 0);

    // 6. Power Backpack Core
    const packGeo = new THREE.BoxGeometry(0.34, 0.44, 0.18);
    const pack = new THREE.Mesh(packGeo, darkMat);
    pack.position.set(0, 1.1, 0.24);

    // 7. Helmet & Visor (articulated head group)
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.56, 0);
    const helmGeo = new THREE.BoxGeometry(0.34, 0.34, 0.36);
    const helm = new THREE.Mesh(helmGeo, armorMat);
    helm.castShadow = true;
    const visorGeo = new THREE.BoxGeometry(0.28, 0.1, 0.08);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.02, -0.17);
    headGroup.add(helm, visor);

    // 8. Held Laser Carbine
    const weaponPivot = new THREE.Group();
    weaponPivot.position.set(0.32, 1.24, -0.15);
    const gunBodyGeo = new THREE.BoxGeometry(0.09, 0.12, 0.56);
    const gunBody = new THREE.Mesh(gunBodyGeo, darkMat);
    gunBody.position.set(0, 0, -0.22);
    const gunStripGeo = new THREE.BoxGeometry(0.1, 0.035, 0.28);
    const gunStrip = new THREE.Mesh(gunStripGeo, visorMat);
    gunStrip.position.set(0, 0.02, -0.26);
    weaponPivot.add(gunBody, gunStrip);

    group.add(leftLeg, rightLeg, torso, chest, leftPauldron, rightPauldron, pack, headGroup, weaponPivot);
    this.scene.add(group);

    this.disposables.push(legGeo, torsoGeo, chestGeo, pauldronGeo, packGeo, helmGeo, visorGeo, gunBodyGeo, gunStripGeo);

    return {
      group,
      headGroup,
      weaponPivot,
      chestMat,
      visorMat,
      team: player.team,
      buffer: [],
      lastX: player.x,
      lastY: player.y,
      lastZ: player.z,
    };
  }

  public setChatOpen(open: boolean): void {
    this.chatOpen = open;
    if (open && document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
  }

  public lockPointer(): void {
    if (!this.chatOpen && this.renderer?.domElement) {
      this.renderer.domElement.requestPointerLock();
    }
  }

  public applyServerSnapshot(serverTime: number, players: PlayerSnapshot[], padCooldowns: Record<string, number>): void {
    this.padCooldowns = padCooldowns;
    const activeIds = new Set<string>();

    for (const p of players) {
      activeIds.add(p.id);
      if (p.id === this.selfId) {
        this.localAlive = p.alive;
        this.overchargeUntil = p.overchargeUntil;
        this.reconcileLocalPlayer(p);
      } else {
        let rig = this.remoteRigs.get(p.id);
        if (!rig) {
          rig = this.createRemoteRig(p);
          this.remoteRigs.set(p.id, rig);
        }
        rig.group.visible = p.alive;
        rig.buffer.push({
          serverTime,
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: p.yaw,
          pitch: p.pitch,
          alive: p.alive,
        });
        if (rig.buffer.length > 24) rig.buffer.shift();
      }
    }

    for (const [id, rig] of this.remoteRigs.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(rig.group);
        this.remoteRigs.delete(id);
      }
    }

    this.serverSnapshots = players;
  }

  private reconcileLocalPlayer(serverState: PlayerSnapshot): void {
    if (!serverState.alive) {
      this.localX = serverState.x;
      this.localY = serverState.y;
      this.localZ = serverState.z;
      this.localVy = 0;
      this.pendingInputs.length = 0;
      return;
    }

    const ackSeq = serverState.lastProcessedSeq || 0;
    this.pendingInputs = this.pendingInputs.filter((cmd) => cmd.seq > ackSeq);

    // Compute predicted server-originated position by replaying unacked inputs
    let rx = serverState.x;
    let ry = serverState.y;
    let rz = serverState.z;
    let rvy = serverState.vy;

    for (const cmd of this.pendingInputs) {
      const res = this.simulateLocalStep(rx, ry, rz, rvy, cmd);
      rx = res.x;
      ry = res.y;
      rz = res.z;
      rvy = res.vy;
    }

    const err = Math.hypot(rx - this.localX, ry - this.localY, rz - this.localZ);
    if (err > 2.4) {
      // Snap on major desync (respawn / teleport)
      this.localX = rx;
      this.localY = ry;
      this.localZ = rz;
      this.localVy = rvy;
    } else if (err > 0.04) {
      // Smoothly converge prediction toward authoritative server state
      this.localX += (rx - this.localX) * 0.25;
      this.localY += (ry - this.localY) * 0.25;
      this.localZ += (rz - this.localZ) * 0.25;
    }
  }

  private simulateLocalStep(
    x: number,
    y: number,
    z: number,
    vy: number,
    cmd: { dt: number; forward: number; strafe: number; jump: boolean; sprint: boolean; yaw: number },
  ): { x: number; y: number; z: number; vy: number; grounded: boolean } {
    const dt = Math.min(0.05, cmd.dt);
    const speed = cmd.sprint ? SPRINT_SPEED : WALK_SPEED;
    const sinY = Math.sin(cmd.yaw);
    const cosY = Math.cos(cmd.yaw);
    let vx = -sinY * cmd.forward + cosY * cmd.strafe;
    let vz = -cosY * cmd.forward - sinY * cmd.strafe;
    const len = Math.hypot(vx, vz);
    if (len > 1e-4) {
      vx = (vx / Math.max(1, len)) * speed;
      vz = (vz / Math.max(1, len)) * speed;
    } else {
      vx = 0;
      vz = 0;
    }

    let nx = x + vx * dt;
    let nz = z + vz * dt;
    let ny = y;
    let nvy = vy + GRAVITY * dt;
    let grounded = false;

    // Arena boundary clamp
    const halfW = this.map.width / 2 - 0.5;
    const halfD = this.map.depth / 2 - 0.5;
    nx = Math.max(-halfW, Math.min(halfW, nx));
    nz = Math.max(-halfD, Math.min(halfD, nz));

    // AABB collision resolution against static boxes
    for (const b of this.boxColliders) {
      const playerTop = ny + 1.75;
      if (playerTop <= b.minY + 0.05 || ny >= b.maxY - 0.05) {
        // Check floor/platform landing
        if (
          nx + PLAYER_RADIUS > b.minX &&
          nx - PLAYER_RADIUS < b.maxX &&
          nz + PLAYER_RADIUS > b.minZ &&
          nz - PLAYER_RADIUS < b.maxZ
        ) {
          if (ny >= b.maxY - 0.35 && ny + nvy * dt <= b.maxY) {
            ny = b.maxY;
            nvy = 0;
            grounded = true;
          }
        }
        continue;
      }

      const closestX = Math.max(b.minX, Math.min(nx, b.maxX));
      const closestZ = Math.max(b.minZ, Math.min(nz, b.maxZ));
      const dx = nx - closestX;
      const dz = nz - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
        const dist = Math.sqrt(distSq) || 0.001;
        const push = PLAYER_RADIUS - dist;
        nx += (dx / dist) * push;
        nz += (dz / dist) * push;
      }
    }

    // Ramp walk height approximation for smooth client prediction
    for (const r of this.rampColliders) {
      const cosR = Math.cos(-(r.rotY || 0));
      const sinR = Math.sin(-(r.rotY || 0));
      const lx = (nx - r.x) * cosR - (nz - r.z) * sinR;
      const lz = (nx - r.x) * sinR + (nz - r.z) * cosR;
      if (Math.abs(lx) <= r.w / 2 + 0.2 && Math.abs(lz) <= r.d / 2 + 0.2) {
        const t = Math.max(0, Math.min(1, (lx + r.w / 2) / r.w));
        const rampY = r.y + t * r.h;
        if (ny <= rampY + 0.35 && ny >= r.y - 0.3) {
          ny = rampY;
          nvy = 0;
          grounded = true;
        }
      }
    }

    ny += nvy * dt;
    if (ny <= 0) {
      ny = 0;
      nvy = 0;
      grounded = true;
    }

    if (cmd.jump && grounded && nvy < 1.5) {
      nvy = JUMP_VELOCITY;
      grounded = false;
    }

    return { x: nx, y: ny, z: nz, vy: nvy, grounded };
  }

  public spawnLaserBeam(beam: LaserBeamEvent): void {
    const start = _vA.set(beam.start[0], beam.start[1], beam.start[2]);
    // Offset local shooter beam start slightly toward weapon barrel
    if (beam.shooterId === this.selfId) {
      start.y -= 0.14;
    }
    const end = _vB.set(beam.end[0], beam.end[1], beam.end[2]);
    const dist = start.distanceTo(end);
    if (dist < 0.05) return;

    const colorHex = beam.team === 'cobalt' ? 0x38bdf8 : 0xf97316;

    const outerGeo = new THREE.CylinderGeometry(0.055, 0.055, dist, 8, 1, true);
    const outerMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(outerGeo, outerMat);

    const coreGeo = new THREE.CylinderGeometry(0.018, 0.018, dist, 6, 1, true);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);

    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start).normalize();
    _quat.setFromUnitVectors(_vUp, dir);

    mesh.position.copy(mid);
    mesh.quaternion.copy(_quat);
    coreMesh.position.copy(mid);
    coreMesh.quaternion.copy(_quat);

    const ringGeo = new THREE.SphereGeometry(0.18, 10, 10);
    const ringMat = new THREE.MeshBasicMaterial({
      color: beam.hitPlayerId ? 0xfef08a : colorHex,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const impactRing = new THREE.Mesh(ringGeo, ringMat);
    impactRing.position.copy(end);

    this.scene.add(mesh, coreMesh, impactRing);
    this.activeBeams.push({
      mesh,
      coreMesh,
      impactRing,
      createdAt: performance.now(),
      durationMs: 170,
    });
  }

  private bindEvents(): void {
    const onResize = () => {
      if (this.disposed) return;
      const w = Math.max(1, this.container.clientWidth);
      const h = Math.max(1, this.container.clientHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    const onKeyDown = (e: KeyboardEvent) => {
      if (this.chatOpen) return;
      this.keys[e.code] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const onMouseMove = (e: MouseEvent) => {
      if (!this.pointerLocked || this.chatOpen) return;
      const sens = 0.0021;
      this.localYaw -= e.movementX * sens;
      this.localPitch = Math.max(-1.42, Math.min(1.42, this.localPitch - e.movementY * sens));
    };
    document.addEventListener('mousemove', onMouseMove);

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || this.chatOpen) return;
      if (this.pointerLocked) {
        this.mouseDown = true;
        this.tryFire();
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = false;
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);

    const onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
      if (!this.pointerLocked) {
        this.mouseDown = false;
        this.keys = {};
      }
      this.onPointerLockChange(this.pointerLocked);
    };
    document.addEventListener('pointerlockchange', onLockChange);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      this.onHudUpdate({
        x: this.localX,
        z: this.localZ,
        yaw: this.localYaw,
        players: this.serverSnapshots,
        locked: false,
        contextLost: true,
      });
    };
    this.renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    this.cleanupListeners = () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      this.renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    };
  }

  private cleanupListeners: () => void = () => {};

  private tryFire(): void {
    if (!this.localAlive || !this.pointerLocked || this.chatOpen) return;
    const now = Date.now();
    const cd = now < this.overchargeUntil ? 105 : 175;
    if (now - this.lastFireAt < cd) return;
    this.lastFireAt = now;

    this.recoilAmount = 1.0;
    this.weaponMuzzleLight.intensity = 4.5;
    this.onFire(this.localYaw, this.localPitch, this.inputSeq);
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop(): void {
    let hudTimer = 0;

    const tick = () => {
      if (this.disposed) return;
      const dt = Math.min(0.05, this.clock.getDelta() || 1 / 60);
      const nowPerf = performance.now();
      const nowMs = Date.now();

      // Local input & movement prediction
      const forward =
        (this.keys['KeyW'] || this.keys['ArrowUp'] ? 1 : 0) -
        (this.keys['KeyS'] || this.keys['ArrowDown'] ? 1 : 0);
      const strafe =
        (this.keys['KeyD'] || this.keys['ArrowRight'] ? 1 : 0) -
        (this.keys['KeyA'] || this.keys['ArrowLeft'] ? 1 : 0);
      const jump = Boolean(this.keys['Space']);
      const sprint = Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight']);

      if (this.localAlive && this.pointerLocked && !this.chatOpen) {
        const res = this.simulateLocalStep(this.localX, this.localY, this.localZ, this.localVy, {
          dt,
          forward,
          strafe,
          jump,
          sprint,
          yaw: this.localYaw,
        });
        this.localX = res.x;
        this.localY = res.y;
        this.localZ = res.z;
        this.localVy = res.vy;
        this.localGrounded = res.grounded;

        this.inputAccumulator += dt;
        if (this.inputAccumulator >= 1 / 60) {
          this.inputSeq += 1;
          const cmd: ClientInputCmd = {
            seq: this.inputSeq,
            dt: this.inputAccumulator,
            forward,
            strafe,
            jump,
            sprint,
            yaw: this.localYaw,
            pitch: this.localPitch,
            clientTime: nowMs,
          };
          this.inputAccumulator = 0;
          this.pendingInputs.push(cmd);
          if (this.pendingInputs.length > 60) this.pendingInputs.shift();
          this.onSendInput(cmd);
        }

        if (this.mouseDown) {
          this.tryFire();
        }
      }

      // Camera transform + subtle FOV sprint punch
      this.camera.position.set(this.localX, this.localY + EYE_HEIGHT, this.localZ);
      _euler.set(this.localPitch, this.localYaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(_euler);

      const targetFov = sprint && (forward !== 0 || strafe !== 0) ? 84 : 78;
      if (Math.abs(this.camera.fov - targetFov) > 0.05) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 10, dt);
        this.camera.updateProjectionMatrix();
      }

      // Weapon viewmodel sway, walk bob, & recoil spring recovery
      const moving = (forward !== 0 || strafe !== 0) && this.localGrounded && this.pointerLocked;
      if (moving) {
        this.walkBobPhase += dt * (sprint ? 14 : 9.5);
      }
      this.recoilAmount = THREE.MathUtils.damp(this.recoilAmount, 0, 16, dt);
      this.weaponMuzzleLight.intensity = THREE.MathUtils.damp(this.weaponMuzzleLight.intensity, 0, 22, dt);

      const bobX = moving ? Math.cos(this.walkBobPhase) * 0.012 : 0;
      const bobY = moving ? Math.abs(Math.sin(this.walkBobPhase)) * 0.014 : 0;
      this.weaponGroup.position.set(0.24 + bobX, -0.22 - bobY, -0.44 + this.recoilAmount * 0.065);
      this.weaponGroup.rotation.x = this.recoilAmount * 0.09;
      this.weaponCoreMat.emissiveIntensity = nowMs < this.overchargeUntil ? 3.2 : 1.7;

      // Client-side Snapshot Interpolation for remote players (100ms render delay)
      const renderTime = nowMs - INTERP_DELAY_MS;
      for (const rig of this.remoteRigs.values()) {
        const buf = rig.buffer;
        if (buf.length === 0) continue;

        let s0 = buf[0];
        let s1 = buf[buf.length - 1];
        for (let i = 0; i < buf.length - 1; i++) {
          if (buf[i].serverTime <= renderTime && buf[i + 1].serverTime >= renderTime) {
            s0 = buf[i];
            s1 = buf[i + 1];
            break;
          }
        }

        if (renderTime >= s1.serverTime) {
          s0 = s1;
        }
        const span = s1.serverTime - s0.serverTime;
        const alpha = span > 0 ? Math.max(0, Math.min(1, (renderTime - s0.serverTime) / span)) : 1;

        const ix = THREE.MathUtils.lerp(s0.x, s1.x, alpha);
        const iy = THREE.MathUtils.lerp(s0.y, s1.y, alpha);
        const iz = THREE.MathUtils.lerp(s0.z, s1.z, alpha);
        const iyaw = lerpAngle(s0.yaw, s1.yaw, alpha);
        const ipitch = THREE.MathUtils.lerp(s0.pitch, s1.pitch, alpha);

        rig.group.position.set(ix, iy, iz);
        rig.group.rotation.y = iyaw;
        rig.headGroup.rotation.x = ipitch * 0.7;
        rig.weaponPivot.rotation.x = ipitch;
      }

      // Animate recharge pads
      for (const pad of this.padVisuals) {
        const cdUntil = this.padCooldowns[pad.id] || 0;
        const ready = nowMs >= cdUntil;
        pad.orb.visible = ready;
        pad.orb.rotation.y += dt * 1.8;
        pad.orb.position.y = 0.95 + Math.sin(nowPerf * 0.003) * 0.14;
        pad.ring.scale.setScalar(ready ? 1 : 0.72);
      }

      // Update & expire laser beams
      for (let i = this.activeBeams.length - 1; i >= 0; i--) {
        const b = this.activeBeams[i];
        const age = nowPerf - b.createdAt;
        if (age >= b.durationMs) {
          this.scene.remove(b.mesh, b.coreMesh, b.impactRing);
          b.mesh.geometry.dispose();
          (b.mesh.material as THREE.Material).dispose();
          b.coreMesh.geometry.dispose();
          (b.coreMesh.material as THREE.Material).dispose();
          b.impactRing.geometry.dispose();
          (b.impactRing.material as THREE.Material).dispose();
          this.activeBeams.splice(i, 1);
        } else {
          const t = 1 - age / b.durationMs;
          (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.65 * t;
          (b.coreMesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * t;
          (b.impactRing.material as THREE.MeshBasicMaterial).opacity = 0.9 * t;
          b.impactRing.scale.setScalar(1 + (1 - t) * 1.6);
        }
      }

      hudTimer += dt;
      if (hudTimer >= 0.08) {
        hudTimer = 0;
        this.onHudUpdate({
          x: this.localX,
          z: this.localZ,
          yaw: this.localYaw,
          players: this.serverSnapshots,
          locked: this.pointerLocked,
          contextLost: false,
        });
      }

      this.renderer.render(this.scene, this.camera);
      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(tick, 16);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.cleanupListeners();

    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;

    for (const b of this.activeBeams) {
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      b.coreMesh.geometry.dispose();
      (b.coreMesh.material as THREE.Material).dispose();
      b.impactRing.geometry.dispose();
      (b.impactRing.material as THREE.Material).dispose();
    }

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
