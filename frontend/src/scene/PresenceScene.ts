/**
 * ORACLE — Three.js WebGL Presence & Dormant Scene Engine
 * Exact 1:1 conversion of ORACLE_Dormant_v4.html
 */

import * as THREE from 'three';
import { OracleMode, OracleState, ENERGY_LEVELS } from '../types';
import { readPlaybackEnergy } from '../utils/voice';

const ORB_COLORS: Record<OracleMode, number> = {
  initializing: 0x8fa8c4,
  dormant: 0x505866,
  ready: 0x8fa8c4,
  listening: 0x78c8f4,
  transcribing: 0x78c8f4,
  thinking: 0xa87ffb,
  speaking: 0xf59e0b,
};

const ORB_TRANSITION: Record<OracleMode, number> = {
  initializing: 0.32, dormant: 0.75, ready: 0.35,
  listening: 0.22, transcribing: 0.22, thinking: 0.28, speaking: 0.24,
};
const VOICE_BARS = 80;
const VOICE_RING_RADIUS = 2.18;

export type ColdBootStage =
  | 'ZERO'
  | 'CORE_IGNITION'
  | 'PARTICLES'
  | 'FRAMEWORK'
  | 'ORBITALS'
  | 'STABILIZING'
  | 'COMPLETE';

export interface ColdBootOptions {
  accelerated?: boolean;
  onStageChange?: (stage: ColdBootStage) => void;
  onComplete?: () => void;
}

interface OrbitFader {
  material: THREE.Material;
  baseOpacity: number;
  baseColor?: THREE.Color;
}

interface OrbitUserData {
  radius: number;
  opacity: number;
  speed: number;
  angle: number;
  baseTilt: number;
  baseTwist: number;
  marker: THREE.Group;
  bead: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  markerHalo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  trailPositions: Float32Array;
  faders: OrbitFader[];
}

interface DustConfig {
  count: number;
  zMin: number;
  zMax: number;
  size: number;
  alpha: number;
  drift: number;
  parallax: number;
}

interface DustLayer {
  cfg: DustConfig;
  xyz: Float32Array;
  vel: Float32Array;
  phase: Float32Array;
  geo: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  group: THREE.Group;
}

export class PresenceScene {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private rootPivot!: THREE.Group;
  private root!: THREE.Group;
  private speakingEnvelope = 0;
  private inputLevel = 0;
  private voiceErrorUntil = 0;
  private errorTint = new THREE.Color(0xe68d88);
  private displayAccent = new THREE.Color();
  private voiceHalo!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private inputEnvelope = 0;
  private voiceVisualMode: OracleMode = 'initializing';
  private voiceVisualProgress = 1;
  private accent = new THREE.Color(ORB_COLORS.initializing);
  private accentFrom = this.accent.clone();
  private accentTarget = this.accent.clone();
  private shellTint = new THREE.Color();
  private voiceDetail = new THREE.Vector4(0, 0, 0, 0);
  private voiceDetailFrom = new THREE.Vector4(0, 0, 0, 0);
  private voiceDetailTarget = new THREE.Vector4(0, 0, 0, 0);
  private voiceRings!: THREE.Group;
  private speakingRing!: THREE.Group;
  private speakingRingMaterial!: THREE.MeshBasicMaterial;
  private listeningRing!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private transcriptionRing!: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private processingRing!: THREE.Group;
  private processingRingMaterial!: THREE.MeshBasicMaterial;
  private visualTime = 0;
  private barDirections = new Float32Array(VOICE_BARS * 2);

  private orb!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private orbMaterial!: THREE.PointsMaterial;
  private orbGeometry!: THREE.BufferGeometry;
  private orbPositions!: Float32Array;
  private orbBasePositions!: Float32Array;
  private orbColors!: Float32Array;
  private orbBaseColors!: Float32Array;
  private orbScanActive = false;
  private orbDelays!: Float32Array;
  private innerCore!: THREE.Group;
  private singularityMaterial!: THREE.ShaderMaterial;
  private innerNucleusMaterial!: THREE.ShaderMaterial;
  private innerNucleusMesh!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private filamentMaterial!: THREE.ShaderMaterial;
  private coreRingGroup!: THREE.Group;
  private meridianGimbal!: THREE.Group;
  private axialGimbal!: THREE.Group;
  private coreRingFaders: OrbitFader[] = [];
  private coreSatellites!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private shell!: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private shellMaterial!: THREE.ShaderMaterial;
  private shellNodes!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private orbitGroups: THREE.Group[] = [];
  private dustLayers: DustLayer[] = [];

  // Celestial Dormant Elements: Falling Stars & Wireframe Satellite
  private meteorLine!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private meteorPositions = new Float32Array(16 * 3);
  private meteorColors = new Float32Array(16 * 3);
  private meteorState = {
    active: false,
    timer: 5.5, // First meteor streaks ~5.5s after entering dormant
    x: 0,
    y: 0,
    z: -9.5,
    vx: 0,
    vy: 0,
    vz: 0,
    progress: 0,
    duration: 0.75,
    length: 2.2
  };

  private satelliteGroup!: THREE.Group;
  private satelliteBeacon!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private satelliteFaders: OrbitFader[] = [];
  private satelliteState = {
    active: false,
    timer: 3.2, // First satellite transits ~3.2s after entering dormant
    x: -18,
    y: 4.2,
    z: -8.0,
    vx: 0.92,
    vy: -0.16,
    rotSpeedX: 0.014,
    rotSpeedY: 0.020,
    rotSpeedZ: 0.009
  };

  private animId: number = 0;
  private isRunning: boolean = false;
  private readonly listeners = new AbortController();
  private dotTexture!: THREE.CanvasTexture;
  private isBooting: boolean = false;
  private isAwakening: boolean = false;
  private coldBoot: {
    active: boolean;
    elapsed: number;
    stage: ColdBootStage;
    accelerated: boolean;
    onStageChange?: (stage: ColdBootStage) => void;
    onComplete?: () => void;
  } = {
    active: false,
    elapsed: 0,
    stage: 'ZERO',
    accelerated: false
  };
  private awakenProgress: number = 0;
    private lastTime: number = 0;
  public hibernating = false;
  private lastRendered: number = 0;
  private elapsed: number = 0;

  private mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  private lastPointerMove = 0;
  private reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  private targetOffsetX = 0;
  private currentOffsetX = 0;
  private targetOffsetY = 0.54;
  private currentOffsetY = 0.54;
  private targetScale = 1.0;
  private currentScale = 1.0;
  private isShifted = false;
  private isCornerDocked = false;

  public state: OracleState = {
    mode: 'dormant',
    energy: 0,
    targetEnergy: 0,
    sleep: 1,
    targetSleep: 1
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.init();
  }

  private init(): void {
    // Ensure clean WebGL pixelStore state before Three.js initializes (prevents texImage3D INVALID_OPERATION on remount)
    try {
      const existingGl = (this.canvas.getContext('webgl2') as WebGL2RenderingContext | null) || (this.canvas.getContext('webgl') as WebGLRenderingContext | null);
      if (existingGl) {
        existingGl.pixelStorei(existingGl.UNPACK_FLIP_Y_WEBGL, false);
        existingGl.pixelStorei(existingGl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      }
    } catch {
      // Ignore if context is not yet created
    }

    // 1. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'low-power'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x000000, 0);

    // 2. Scene & Fog
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080b0e, 0.048);

    // 3. Camera
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0, 10);

    // 4. Root anchor with Head-On Orientation Pivot
    this.rootPivot = new THREE.Group();
    this.root = new THREE.Group();
    this.rootPivot.add(this.root);
    this.scene.add(this.rootPivot);

    // 5. Procedural Crisp Antialiased Dot Texture
    const dotCanvas = document.createElement('canvas');
    dotCanvas.width = dotCanvas.height = 64;
    const ctx = dotCanvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.60, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const dotTexture = this.dotTexture = new THREE.CanvasTexture(dotCanvas);
    const initialScaleVal = (window.innerHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(20.0));

    // 6. Central Dotted Sphere (Fixed Geometry: 2,400 points, Fibonacci lattice)
    const N = 2400;
    const R = 1.9;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < N; i++) {
      const y = 1 - 2 * (i + 0.5) / N;
      const r = Math.sqrt(1 - y * y);
      const a = golden * i;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      positions[i * 3] = x * R;
      positions[i * 3 + 1] = y * R;
      positions[i * 3 + 2] = z * R;

      // Enhanced volumetric 3D depth attenuation:
      // Front dots (+z) are bright cool-white, rear dots (-z) fade softly down to deep graphite
      const normZ = (z / R + 1) / 2; // 0.0 (back) to 1.0 (front)
      const shade = 0.28 + 0.76 * Math.pow(normZ, 1.35);
      // Soft equatorial brightness band: Gaussian peak at y=0, fades toward poles
      const normY = Math.abs(y); // 0 at equator, 1 at poles
      const equatorialBand = Math.exp(-normY * normY * 6.5) * 0.22;
      colors[i * 3 + 0] = Math.min(1, 0.90 * shade + equatorialBand * 0.92);
      colors[i * 3 + 1] = Math.min(1, 0.93 * shade + equatorialBand * 0.94);
      colors[i * 3 + 2] = Math.min(1, 0.98 * shade + equatorialBand * 0.78); // cooler tint on band
    }

    const aDelay = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // Staggered progressive emergence from core
      aDelay[i] = Math.min(0.85, (i / N) * 0.65 + Math.random() * 0.15);
    }

    this.orbPositions = positions;
    this.orbBasePositions = new Float32Array(positions);
    this.orbDelays = aDelay;
    this.orbColors = colors;
    this.orbBaseColors = new Float32Array(colors);

    const orbGeometry = new THREE.BufferGeometry();
    orbGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    orbGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.orbGeometry = orbGeometry;

    this.orbMaterial = new THREE.PointsMaterial({
      size: 0.05,
      map: dotTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.70,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.05
    });

    this.orb = new THREE.Points(orbGeometry, this.orbMaterial);
    this.root.add(this.orb);

    // 6.5. Direction 1: Multi-Layered Volumetric Quantum Core (Translucent Forcefield Shell + Quantum Nucleus + Gyroscopic Gimbals)
    this.innerCore = new THREE.Group();

    this.createVoiceRings();

    // A. Outer Translucent Singularity Forcefield Shell (Volumetric Glass & 3D Plasma Harmonics)
    this.singularityMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTint: { value: this.shellTint },
        uTime: { value: 0 },
        uReveal: { value: 0.0 },
        uFocus: { value: 0.0 },
        uEnergy: { value: 0.0 }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewVec;
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vLocalPos = position;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          vViewVec = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewVec;
        varying vec3 vLocalPos;
        varying vec3 vWorldPos;

        uniform vec3 uTint;
        uniform float uTime;
        uniform float uReveal;
        uniform float uFocus;
        uniform float uEnergy;

        void main() {
          if (uReveal < 0.001) discard;

          float ndotv = abs(dot(vNormal, vViewVec));

          // 1. Crisp, ethereal Fresnel rim glow (volumetric glass silhouette)
          float rimGlow = pow(1.0 - ndotv, 3.2);

          // 2. High-transparency front-facing center: reveals the interior nucleus and gimbal rings
          float centerGaze = pow(ndotv, 6.0) * 0.20;

          // 3. Delicate 3D procedural harmonic plasma waves flowing across the spherical surface
          float plasma1 = sin(vLocalPos.x * 12.0 + uTime * 0.8) * cos(vLocalPos.y * 12.0 - uTime * 0.6);
          float plasma2 = sin(vLocalPos.z * 10.0 + plasma1 * 2.5 + uTime * 0.4);
          float harmonicWaves = smoothstep(-0.2, 0.7, plasma2) * 0.16 * (1.0 - rimGlow * 0.4);

          // Alpha: strong edge silhouette, highly translucent interior for genuine 3D see-through depth
          float baseAlpha = rimGlow * 0.90 + centerGaze + harmonicWaves;
          float alpha = clamp(baseAlpha * (0.80 + uFocus * 0.55) * uReveal, 0.0, 1.0);

          vec3 rimColor = mix(uTint, vec3(0.96, 0.97, 1.0), 0.34);
          vec3 midColor = uTint * 0.46;
          vec3 interiorColor = mix(uTint * 0.52, vec3(0.5, 0.54, 0.58), 0.45);

          vec3 col = mix(interiorColor, midColor, 1.0 - ndotv);
          col = mix(col, rimColor, rimGlow * 0.85);
          col *= (1.0 + uFocus * 0.25);

          gl_FragColor = vec4(col, alpha);
        }
      `
    });

    const singularityGeo = new THREE.SphereGeometry(0.28, 48, 48);
    const singularityMesh = new THREE.Mesh(singularityGeo, this.singularityMaterial);
    this.innerCore.add(singularityMesh);

    // B. Inner Quantum Singularity Nucleus (Pulsating Micro-Pulsar Core)
    this.innerNucleusMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      uniforms: {
        uTint: { value: this.shellTint },
        uTime: { value: 0 },
        uReveal: { value: 0.0 },
        uFocus: { value: 0.0 },
        uEnergy: { value: 0.0 }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewVec;
        varying vec3 vLocalPos;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vLocalPos = position;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vViewVec = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewVec;
        varying vec3 vLocalPos;

        uniform vec3 uTint;
        uniform float uTime;
        uniform float uReveal;
        uniform float uFocus;
        uniform float uEnergy;

        void main() {
          if (uReveal < 0.001) discard;

          float ndotv = abs(dot(vNormal, vViewVec));

          // Hyper-dense pinpoint photon core
          float coreSpark = pow(ndotv, 10.0) * 1.6 + pow(ndotv, 2.5) * 0.5;

          // Internal quantum lattice pulse
          float microLattice = sin(vLocalPos.y * 28.0 + uTime * 3.5) * cos(vLocalPos.x * 28.0 - uTime * 2.5) * 0.14;

          float alpha = clamp((coreSpark + microLattice) * (0.88 + uFocus * 0.30) * uReveal, 0.0, 1.0);

          vec3 sparkWhite = vec3(1.0, 1.0, 1.0);
          vec3 coreColor = mix(uTint, sparkWhite, 0.20);
          vec3 col = mix(coreColor, sparkWhite, pow(ndotv, 3.5));

          gl_FragColor = vec4(col, alpha);
        }
      `
    });

    const nucleusGeo = new THREE.SphereGeometry(0.10, 32, 32);
    this.innerNucleusMesh = new THREE.Mesh(nucleusGeo, this.innerNucleusMaterial);
    this.innerCore.add(this.innerNucleusMesh);

    // C. Synaptic Radial Micro-Filaments (16 quantum rays radiating outward from nucleus)
    const RAY_COUNT = 16;
    const rayPositions = new Float32Array(RAY_COUNT * 2 * 3);
    const rayProgress = new Float32Array(RAY_COUNT * 2);
    const rayIds = new Float32Array(RAY_COUNT * 2);

    for (let i = 0; i < RAY_COUNT; i++) {
      const theta = (2 * Math.PI * i) / RAY_COUNT;
      const phi = Math.PI * 0.5 + 0.38 * Math.sin(i * 1.7);
      const rInner = 0.11;
      const rOuter = 1.05 + 0.25 * Math.cos(i * 2.3);

      const dirX = Math.sin(phi) * Math.cos(theta);
      const dirY = Math.cos(phi);
      const dirZ = Math.sin(phi) * Math.sin(theta);

      // Inner root vertex (0)
      const idx0 = i * 2;
      rayPositions[idx0 * 3 + 0] = dirX * rInner;
      rayPositions[idx0 * 3 + 1] = dirY * rInner;
      rayPositions[idx0 * 3 + 2] = dirZ * rInner;
      rayProgress[idx0] = 0.0;
      rayIds[idx0] = i;

      // Outer tip vertex (1)
      const idx1 = idx0 + 1;
      rayPositions[idx1 * 3 + 0] = dirX * rOuter;
      rayPositions[idx1 * 3 + 1] = dirY * rOuter;
      rayPositions[idx1 * 3 + 2] = dirZ * rOuter;
      rayProgress[idx1] = 1.0;
      rayIds[idx1] = i;
    }

    const filamentGeo = new THREE.BufferGeometry();
    filamentGeo.setAttribute('position', new THREE.BufferAttribute(rayPositions, 3));
    filamentGeo.setAttribute('aProgress', new THREE.BufferAttribute(rayProgress, 1));
    filamentGeo.setAttribute('aRayId', new THREE.BufferAttribute(rayIds, 1));

    this.filamentMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTint: { value: this.shellTint },
        uTime: { value: 0 },
        uReveal: { value: 0.0 },
        uFocus: { value: 0.0 },
        uEnergy: { value: 0.0 }
      },
      vertexShader: `
        attribute float aProgress;
        attribute float aRayId;

        varying float vAlpha;
        varying vec3 vColor;

        uniform vec3 uTint;
        uniform float uTime;
        uniform float uReveal;
        uniform float uFocus;
        uniform float uEnergy;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // Outward-propagating synaptic pulses along radial quantum filaments
          float fade = 1.0 - aProgress;
          float pulseSpeed = 6.0 + uEnergy * 6.0;
          float pulseWave = sin(aProgress * 6.28 - uTime * pulseSpeed + aRayId * 0.45);
          float pulse = pow(clamp(pulseWave, 0.0, 1.0), 3.0) * (0.45 + uFocus * 0.25);
          vAlpha = uReveal * (fade * (0.34 + uFocus * 0.28) + pulse);

          // Ethereal state-tinted glow with bright white packet at pulse crest
          vec3 pulseColor = mix(uTint, vec3(1.0, 1.0, 1.0), pulse * 0.85);
          vColor = mix(pulseColor, vec3(0.96, 0.98, 1.0), fade * 0.42);
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          if (vAlpha < 0.005) discard;
          gl_FragColor = vec4(vColor, vAlpha);
        }
      `
    });

    const filamentLines = new THREE.LineSegments(filamentGeo, this.filamentMaterial);
    this.innerCore.add(filamentLines);

    // D. Tri-Axial Gyroscopic Calibration Gimbals (Depth & Perspective)
    this.coreRingGroup = new THREE.Group();
    const coreRingRadius = 0.38;

    const ringCircle = (r: number, opacity: number) => {
      const coords: number[] = [];
      const segs = 120;
      for (let i = 0; i <= segs; i++) {
        const a = (i * Math.PI * 2) / segs;
        coords.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xcfd8e4, transparent: true, opacity, depthWrite: false });
      this.coreRingFaders.push({ material: mat, baseOpacity: opacity, baseColor: mat.color.clone() });
      return new THREE.Line(geo, mat);
    };

    // 1. Equatorial calibration ring with tick marks and index beads
    this.coreRingGroup.add(ringCircle(coreRingRadius, 0.26));

    const coreTickCoords: number[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (2 * Math.PI * k) / 16;
      const isMajor = k % 4 === 0;
      const rIn = coreRingRadius + 0.010;
      const rOut = rIn + (isMajor ? 0.035 : 0.018);
      coreTickCoords.push(Math.cos(a) * rIn, 0, Math.sin(a) * rIn, Math.cos(a) * rOut, 0, Math.sin(a) * rOut);
    }
    const coreTickGeo = new THREE.BufferGeometry();
    coreTickGeo.setAttribute('position', new THREE.Float32BufferAttribute(coreTickCoords, 3));
    const coreTickMat = new THREE.LineBasicMaterial({ color: 0xcfd8e4, transparent: true, opacity: 0.30, depthWrite: false });
    this.coreRingFaders.push({ material: coreTickMat, baseOpacity: 0.30, baseColor: coreTickMat.color.clone() });
    this.coreRingGroup.add(new THREE.LineSegments(coreTickGeo, coreTickMat));

    for (let m = 0; m < 2; m++) {
      const a = m * Math.PI;
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xe8ebef, transparent: true, opacity: 0.65, depthWrite: false })
      );
      bead.position.set(Math.cos(a) * coreRingRadius, 0, Math.sin(a) * coreRingRadius);
      this.coreRingGroup.add(bead);
      this.coreRingFaders.push({ material: bead.material, baseOpacity: 0.65, baseColor: bead.material.color.clone() });
    }
    this.coreRingGroup.rotation.x = 0.22;

    // 2. Meridian Gyroscopic Gimbal (Tilted 3D plane)
    this.meridianGimbal = new THREE.Group();
    const meridianRadius = 0.31;
    this.meridianGimbal.add(ringCircle(meridianRadius, 0.20));
    for (let m = 0; m < 2; m++) {
      const a = (m * Math.PI) + (Math.PI * 0.5);
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x9ebfdc, transparent: true, opacity: 0.60, depthWrite: false })
      );
      bead.position.set(Math.cos(a) * meridianRadius, 0, Math.sin(a) * meridianRadius);
      this.meridianGimbal.add(bead);
      this.coreRingFaders.push({ material: bead.material, baseOpacity: 0.60, baseColor: bead.material.color.clone() });
    }
    this.meridianGimbal.rotation.y = 1.1;
    this.meridianGimbal.rotation.z = 0.35;
    this.coreRingGroup.add(this.meridianGimbal);

    // 3. Axial Counter-Gimbal (Third orthogonal plane for full 3D spherical cage)
    this.axialGimbal = new THREE.Group();
    const axialRadius = 0.23;
    this.axialGimbal.add(ringCircle(axialRadius, 0.22));
    this.axialGimbal.rotation.x = 1.2;
    this.axialGimbal.rotation.y = -0.5;
    this.coreRingGroup.add(this.axialGimbal);

    this.innerCore.add(this.coreRingGroup);

    // E. 12 Quantum Micro-Nodes in 3D Spherical Shell Swarm
    const satCount = 12;
    const satPositions = new Float32Array(satCount * 3);
    for (let i = 0; i < satCount; i++) {
      const u = (i / satCount) * 2 * Math.PI;
      const incl = ((i % 3) - 1) * 0.55;
      const r = 0.21 + (i % 4) * 0.045;
      satPositions[i * 3 + 0] = Math.cos(u) * Math.cos(incl) * r;
      satPositions[i * 3 + 1] = Math.sin(incl) * r;
      satPositions[i * 3 + 2] = Math.sin(u) * Math.cos(incl) * r;
    }
    const satGeo = new THREE.BufferGeometry();
    satGeo.setAttribute('position', new THREE.BufferAttribute(satPositions, 3));
    const satMat = new THREE.PointsMaterial({
      size: 0.022,
      map: dotTexture,
      color: 0x9ebfdc,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.coreSatellites = new THREE.Points(satGeo, satMat);
    this.innerCore.add(this.coreSatellites);

    this.root.add(this.innerCore);

    // 7. Instrument-grade Orbital Rings with Gyroscopic Calibration & Trails
    const circleLine = (radius: number, opacity: number, start = 0, end = Math.PI * 2, segments = 320, color = 0xcfd8e4, tilt = 0) => {
      const coords: number[] = [];
      const colors: number[] = [];
      const baseCol = new THREE.Color(color);
      const isLoop = Math.abs(end - start) > Math.PI * 1.95;

      for (let i = 0; i <= segments; i++) {
        const a = start + ((end - start) * i) / segments;
        coords.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);

        if (isLoop) {
          // Volumetric 3D perspective depth: front of the tilted orbit is crisp, rear arc dips into cosmic depth
          const sinA = Math.sin(a);
          const zDepth = tilt >= 0 ? sinA : -sinA;
          const depthNorm = (zDepth + 1.0) * 0.5;
          const depthFactor = 0.32 + 0.68 * Math.pow(depthNorm, 1.25);
          colors.push(baseCol.r * depthFactor, baseCol.g * depthFactor, baseCol.b * depthFactor);
        } else {
          colors.push(baseCol.r, baseCol.g, baseCol.b);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      return new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: 0xffffff,
          vertexColors: true,
          transparent: true,
          opacity,
          depthWrite: false
        })
      );
    };

    // Keep the gyroscopic rings muted so the voice state defines the accent.
    const orbitConfigs = [
      { radius: 2.38, opacity: 0.13, tilt: 0.08, twist: -0.06, speed: -0.024, color: 0x657181 },
      { radius: 2.75, opacity: 0.17, tilt: 0.35, twist: -0.17, speed: 0.055,  color: 0x84909e },
      { radius: 3.33, opacity: 0.13, tilt: -0.52, twist: 0.32, speed: -0.038, color: 0x5d6571 }
    ];

    orbitConfigs.forEach(({ radius, opacity, tilt, twist, speed, color }, idx) => {
      const group = new THREE.Group();
      const faders: OrbitFader[] = [];

      const track = (obj: THREE.Line | THREE.LineSegments, baseOpacity: number) => {
        group.add(obj);
        faders.push({ material: obj.material as THREE.Material, baseOpacity, baseColor: new THREE.Color(0xffffff) });
        return obj;
      };

      track(circleLine(radius, opacity, 0, Math.PI * 2, 320, color, tilt), opacity);
      track(circleLine(radius + (idx === 0 ? 0.038 : idx === 1 ? 0.047 : 0.06), opacity * 0.31, 0, Math.PI * 2, 320, color, tilt), opacity * 0.31);

      // Incomplete engraved segments
      for (let k = 0; k < 3; k++) {
        const start = k * 2.15 + idx * 0.65;
        const end = start + (0.27 + (k % 2) * 0.14);
        track(circleLine(radius + (idx === 0 ? 0.038 : 0.05), opacity * 0.85, start, end, 28, color, tilt), opacity * 0.85);
      }

      // Index ticks + Cardinal Azimuth Markings (090°, 180°, 270°, 360°)
      const tickCoords: number[] = [];
      const tickCount = idx === 0 ? 36 : idx === 1 ? 48 : 60;
      for (let k = 0; k < tickCount; k++) {
        const a = (2 * Math.PI * k) / tickCount;
        const major = k % 6 === 0;
        const isCardinal = k % (tickCount / 4) === 0; // Exactly at 0°, 90°, 180°, 270°

        const inner = radius + (idx === 0 ? 0.065 : 0.085);
        const outer = inner + (isCardinal ? 0.14 : major ? 0.095 : 0.035);
        tickCoords.push(Math.cos(a) * inner, 0, Math.sin(a) * inner, Math.cos(a) * outer, 0, Math.sin(a) * outer);

        // Cardinal notch pair accent
        if (isCardinal) {
          const aOffset = 0.024;
          const innerPair = inner + 0.02;
          const outerPair = inner + 0.11;
          tickCoords.push(
            Math.cos(a - aOffset) * innerPair, 0, Math.sin(a - aOffset) * innerPair,
            Math.cos(a - aOffset) * outerPair, 0, Math.sin(a - aOffset) * outerPair,
            Math.cos(a + aOffset) * innerPair, 0, Math.sin(a + aOffset) * innerPair,
            Math.cos(a + aOffset) * outerPair, 0, Math.sin(a + aOffset) * outerPair
          );
        }
      }
      const tickGeo = new THREE.BufferGeometry();
      tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickCoords, 3));
      const ticks = new THREE.LineSegments(
        tickGeo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.52, depthWrite: false })
      );
      track(ticks, opacity * 0.52);

      // Marker Bead & Halo — bead size graduated & tinted to match parent orbit
      const marker = new THREE.Group();
      const beadColor = idx === 0 ? 0xd8f2ff : idx === 1 ? 0xffffff : 0xffeed8;
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(idx === 0 ? 0.028 : idx === 1 ? 0.040 : 0.024, 12, 12),
        new THREE.MeshBasicMaterial({ color: beadColor, transparent: true, opacity: 0.85, depthWrite: false })
      );
      marker.add(bead);

      const markerHalo = new THREE.Mesh(
        new THREE.RingGeometry(0.048, 0.064, 28),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })
      );
      markerHalo.rotation.x = Math.PI / 2;
      marker.add(markerHalo);
      group.add(marker);

      // Phosphor trailing arc (24 line segments extending backward ~25°)
      const TRAIL_SEGS = 24;
      const trailPositions = new Float32Array(TRAIL_SEGS * 3);
      const trailColors = new Float32Array(TRAIL_SEGS * 3);

      const baseR = idx === 0 ? 0.52 : idx === 1 ? 0.88 : 0.88;
      const baseG = idx === 0 ? 0.82 : idx === 1 ? 0.92 : 0.76;
      const baseB = idx === 0 ? 0.98 : idx === 1 ? 1.00 : 0.58;
      for (let k = 0; k < TRAIL_SEGS; k++) {
        const t = 1.0 - k / (TRAIL_SEGS - 1); // 1.0 at bead head, 0.0 at tail
        const alpha = Math.pow(t, 1.85); // Non-linear phosphor fade
        trailColors[k * 3 + 0] = baseR * alpha;
        trailColors[k * 3 + 1] = baseG * alpha;
        trailColors[k * 3 + 2] = baseB * alpha;
      }

      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
      trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));

      const trail = new THREE.Line(
        trailGeo,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.65,
          depthWrite: false
        })
      );
      group.add(trail);
      faders.push({ material: trail.material, baseOpacity: 0.65 });

      group.rotation.set(tilt, idx * 0.18, twist);
      const uData: OrbitUserData = {
        radius,
        opacity,
        speed,
        angle: idx * 2.4 + 0.7,
        baseTilt: tilt,
        baseTwist: twist,
        marker,
        bead,
        markerHalo,
        trail,
        trailPositions,
        faders
      };
      group.userData = uData;

      this.root.add(group);
      this.orbitGroups.push(group);
    });

    // 8. Progressive Polygon Framework (42 nodes, 120 edges) with Progressive Node-to-Node Line Assembly
    const icosaGeo = new THREE.IcosahedronGeometry(2.25, 2);
    const posAttr = icosaGeo.attributes.position;
    const indexAttr = icosaGeo.index;

    // A. Collect unique vertices
    const uniqueVerts: THREE.Vector3[] = [];
    const vertMap = new Map<string, number>();

    const getVertIndex = (x: number, y: number, z: number): number => {
      const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
      if (vertMap.has(k)) return vertMap.get(k)!;
      const idx = uniqueVerts.length;
      uniqueVerts.push(new THREE.Vector3(x, y, z));
      vertMap.set(k, idx);
      return idx;
    };

    const edgesSet = new Set<string>();
    const uniqueEdges: [number, number][] = [];

    const registerEdge = (iA: number, iB: number) => {
      if (iA === iB) return;
      const minI = Math.min(iA, iB);
      const maxI = Math.max(iA, iB);
      const key = `${minI}_${maxI}`;
      if (!edgesSet.has(key)) {
        edgesSet.add(key);
        uniqueEdges.push([minI, maxI]);
      }
    };

    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i += 3) {
        const a = getVertIndex(posAttr.getX(indexAttr.getX(i)), posAttr.getY(indexAttr.getX(i)), posAttr.getZ(indexAttr.getX(i)));
        const b = getVertIndex(posAttr.getX(indexAttr.getX(i + 1)), posAttr.getY(indexAttr.getX(i + 1)), posAttr.getZ(indexAttr.getX(i + 1)));
        const c = getVertIndex(posAttr.getX(indexAttr.getX(i + 2)), posAttr.getY(indexAttr.getX(i + 2)), posAttr.getZ(indexAttr.getX(i + 2)));
        registerEdge(a, b);
        registerEdge(b, c);
        registerEdge(c, a);
      }
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        const a = getVertIndex(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        const b = getVertIndex(posAttr.getX(i + 1), posAttr.getY(i + 1), posAttr.getZ(i + 1));
        const c = getVertIndex(posAttr.getX(i + 2), posAttr.getY(i + 2), posAttr.getZ(i + 2));
        registerEdge(a, b);
        registerEdge(b, c);
        registerEdge(c, a);
      }
    }

    // B. Root vertex V0 on north pole (+Y) for geodesic wave propagation
    let rootIdx = 0;
    let maxY = -9999;
    for (let i = 0; i < uniqueVerts.length; i++) {
      if (uniqueVerts[i].y > maxY) {
        maxY = uniqueVerts[i].y;
        rootIdx = i;
      }
    }
    const v0 = uniqueVerts[rootIdx];

    const dists = new Float32Array(uniqueVerts.length);
    let maxAngle = 0.001;
    for (let i = 0; i < uniqueVerts.length; i++) {
      const angle = v0.angleTo(uniqueVerts[i]);
      dists[i] = angle;
      if (angle > maxAngle) maxAngle = angle;
    }
    for (let i = 0; i < uniqueVerts.length; i++) {
      dists[i] /= maxAngle;
    }

    // C. Progressive line drawing geometry with upstream/downstream attributes
    const edgeCount = uniqueEdges.length;
    const linePositions = new Float32Array(edgeCount * 2 * 3);
    const lineDistA = new Float32Array(edgeCount * 2);
    const lineDistB = new Float32Array(edgeCount * 2);
    const lineIsDownstream = new Float32Array(edgeCount * 2);
    const lineOtherPos = new Float32Array(edgeCount * 2 * 3);

    for (let e = 0; e < edgeCount; e++) {
      const [iA, iB] = uniqueEdges[e];
      let uA = iA;
      let uB = iB;
      if (dists[iA] > dists[iB]) {
        uA = iB;
        uB = iA;
      }
      const posA = uniqueVerts[uA];
      const posB = uniqueVerts[uB];
      let dA = dists[uA];
      let dB = dists[uB];
      if (Math.abs(dB - dA) < 0.02) {
        dB = dA + 0.05;
      }

      // Vertex 0 (Upstream node A)
      const idx0 = e * 2;
      linePositions[idx0 * 3 + 0] = posA.x;
      linePositions[idx0 * 3 + 1] = posA.y;
      linePositions[idx0 * 3 + 2] = posA.z;
      lineDistA[idx0] = dA;
      lineDistB[idx0] = dB;
      lineIsDownstream[idx0] = 0.0;
      lineOtherPos[idx0 * 3 + 0] = posB.x;
      lineOtherPos[idx0 * 3 + 1] = posB.y;
      lineOtherPos[idx0 * 3 + 2] = posB.z;

      // Vertex 1 (Downstream node B)
      const idx1 = idx0 + 1;
      linePositions[idx1 * 3 + 0] = posB.x;
      linePositions[idx1 * 3 + 1] = posB.y;
      linePositions[idx1 * 3 + 2] = posB.z;
      lineDistA[idx1] = dA;
      lineDistB[idx1] = dB;
      lineIsDownstream[idx1] = 1.0;
      lineOtherPos[idx1 * 3 + 0] = posA.x;
      lineOtherPos[idx1 * 3 + 1] = posA.y;
      lineOtherPos[idx1 * 3 + 2] = posA.z;
    }

    const shellGeo = new THREE.BufferGeometry();
    shellGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    shellGeo.setAttribute('aDistA', new THREE.BufferAttribute(lineDistA, 1));
    shellGeo.setAttribute('aDistB', new THREE.BufferAttribute(lineDistB, 1));
    shellGeo.setAttribute('aIsDownstream', new THREE.BufferAttribute(lineIsDownstream, 1));
    shellGeo.setAttribute('aOtherPos', new THREE.BufferAttribute(lineOtherPos, 3));

    this.shellMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uReveal: { value: 0.0 },
        uBaseOpacity: { value: 0.052 },
        uBuildProgress: { value: 1.0 },
        uTint: { value: this.shellTint }
      },
      vertexShader: `
        attribute float aDistA;
        attribute float aDistB;
        attribute float aIsDownstream;
        attribute vec3 aOtherPos;

        uniform float uBuildProgress;
        uniform float uReveal;
        uniform float uBaseOpacity;

        varying float vLineAlpha;

        void main() {
          // If wavefront has not reached upstream vertex, hide line
          if (uBuildProgress < aDistA) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vLineAlpha = 0.0;
            return;
          }

          float span = max(0.003, aDistB - aDistA);
          float t = clamp((uBuildProgress - aDistA) / span, 0.0, 1.0);

          vec3 curPos = position;
          if (aIsDownstream > 0.5) {
            curPos = mix(aOtherPos, position, t);
          }

          vec4 mvPosition = modelViewMatrix * vec4(curPos, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // Growing tip glints brighter during construction
          float isTip = 1.0 + aIsDownstream * 1.25 * sin(3.14159 * t);
          vLineAlpha = uBaseOpacity * uReveal * isTip;
        }
      `,
      fragmentShader: `
        varying float vLineAlpha;
        uniform vec3 uTint;

        void main() {
          if (vLineAlpha < 0.002) discard;
          vec3 col = mix(vec3(0.78, 0.84, 0.92), uTint, 0.65);
          gl_FragColor = vec4(col, vLineAlpha);
        }
      `
    });

    this.shell = new THREE.LineSegments(shellGeo, this.shellMaterial);
    this.root.add(this.shell);

    // D. Holographic Vertex Nodes with Geodesic Illumination Wavefront & Neural Firing
    const nodeCount = uniqueVerts.length;
    const nodePositions = new Float32Array(nodeCount * 3);
    const speed1 = new Float32Array(nodeCount);
    const speed2 = new Float32Array(nodeCount);
    const phase1 = new Float32Array(nodeCount);
    const phase2 = new Float32Array(nodeCount);
    const maxIntensity = new Float32Array(nodeCount);

    for (let i = 0; i < nodeCount; i++) {
      nodePositions[i * 3 + 0] = uniqueVerts[i].x;
      nodePositions[i * 3 + 1] = uniqueVerts[i].y;
      nodePositions[i * 3 + 2] = uniqueVerts[i].z;

      const baseSpd = 0.22 + Math.random() * 0.26;
      speed1[i] = baseSpd;
      speed2[i] = baseSpd * (1.61803 + Math.random() * 0.15);
      phase1[i] = Math.random() * Math.PI * 2.0;
      phase2[i] = Math.random() * Math.PI * 2.0;
      maxIntensity[i] = 0.70 + Math.random() * 0.28;
    }

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
    nodeGeo.setAttribute('aDist', new THREE.BufferAttribute(dists, 1));
    nodeGeo.setAttribute('aSpeed1', new THREE.BufferAttribute(speed1, 1));
    nodeGeo.setAttribute('aSpeed2', new THREE.BufferAttribute(speed2, 1));
    nodeGeo.setAttribute('aPhase1', new THREE.BufferAttribute(phase1, 1));
    nodeGeo.setAttribute('aPhase2', new THREE.BufferAttribute(phase2, 1));
    nodeGeo.setAttribute('aMaxIntensity', new THREE.BufferAttribute(maxIntensity, 1));

    const nodeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uReveal: { value: 0.0 },
        uScale: { value: initialScaleVal },
        uBuildProgress: { value: 1.0 },
        uTexture: { value: dotTexture }
      },
      vertexShader: `
        attribute float aDist;
        attribute float aSpeed1;
        attribute float aSpeed2;
        attribute float aPhase1;
        attribute float aPhase2;
        attribute float aMaxIntensity;

        varying float vNodeAlpha;
        varying vec3 vNodeColor;

        uniform float uTime;
        uniform float uReveal;
        uniform float uScale;
        uniform float uBuildProgress;

        void main() {
          // Hide node until construction wavefront reaches it
          if (uBuildProgress < aDist) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vNodeAlpha = 0.0;
            return;
          }

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // Aperiodic interference waves
          float wave1 = sin(uTime * aSpeed1 + aPhase1);
          float wave2 = sin(uTime * aSpeed2 + aPhase2);
          float composite = wave1 * 0.54 + wave2 * 0.46;

          float activation = smoothstep(0.70, 0.96, composite);
          float neuralFlare = pow(activation, 2.2) * aMaxIntensity;

          // Brilliant ignition flash when wavefront first arrives at node
          float arrival = (1.0 - smoothstep(0.0, 0.12, uBuildProgress - aDist))
                        * (1.0 - smoothstep(0.95, 1.0, uBuildProgress));
          float flare = max(neuralFlare, arrival);

          float restingAlpha = 0.12;
          float firingAlpha = 0.92;
          vNodeAlpha = uReveal * mix(restingAlpha, firingAlpha, flare);

          vec3 restingColor = vec3(0.52, 0.62, 0.74);
          vec3 firingColor = vec3(1.0, 1.0, 1.0);
          vNodeColor = mix(restingColor, firingColor, flare);

          float sizeFactor = mix(0.036, 0.072, flare);
          gl_PointSize = sizeFactor * uScale * (1.0 / -mvPosition.z);
        }
      `,
      fragmentShader: `
        varying float vNodeAlpha;
        varying vec3 vNodeColor;
        uniform sampler2D uTexture;

        void main() {
          if (vNodeAlpha < 0.005) discard;
          vec2 coord = gl_PointCoord;
          vec4 tex = texture2D(uTexture, coord);
          if (tex.a < 0.04) discard;

          gl_FragColor = vec4(vNodeColor, tex.a * vNodeAlpha);
        }
      `
    });

    this.shellNodes = new THREE.Points(nodeGeo, nodeMat);
    this.root.add(this.shellNodes);

    // 9. Environmental 3D Dust Layers (3 distinct depth layers)
    const dustDefinitions: DustConfig[] = [
      { count: 155, zMin: -15, zMax: -9, size: 0.030, alpha: 0.12, drift: 0.010, parallax: 0.05 },
      { count: 95, zMin: -9, zMax: -3.5, size: 0.036, alpha: 0.19, drift: 0.016, parallax: 0.12 },
      { count: 38, zMin: -3.5, zMax: 1.5, size: 0.040, alpha: 0.21, drift: 0.023, parallax: 0.23 }
    ];

    const makeDust = (cfg: DustConfig, starColor: [number, number, number] = [0.87, 0.90, 0.93]): DustLayer => {
      const xyz = new Float32Array(cfg.count * 3);
      const vel = new Float32Array(cfg.count * 2);
      const phase = new Float32Array(cfg.count);
      const twinkleSpeed = new Float32Array(cfg.count);
      const twinklePhase = new Float32Array(cfg.count);
      const isTwinkler = new Float32Array(cfg.count);

      for (let i = 0; i < cfg.count; i++) {
        xyz[3 * i] = (Math.random() - 0.5) * 29;
        xyz[3 * i + 1] = (Math.random() - 0.5) * 18;
        xyz[3 * i + 2] = cfg.zMin + Math.random() * (cfg.zMax - cfg.zMin);

        const a = Math.random() * Math.PI * 2;
        const spd = cfg.drift * (0.45 + Math.random() * 0.9);
        vel[2 * i] = Math.cos(a) * spd;
        vel[2 * i + 1] = Math.sin(a) * spd * 0.65;
        phase[i] = Math.random() * Math.PI * 2;

        // Celestial twinkle parameters:
        // Slow respiratory rate: 0.35 to 0.95 rad/s (approx 6-12s full oscillation)
        twinkleSpeed[i] = 0.35 + Math.random() * 0.60;
        twinklePhase[i] = Math.random() * Math.PI * 2.0;
        // ~40% of particles are designated as celestial stars with twinkling ability
        isTwinkler[i] = Math.random() < 0.40 ? 1.0 : 0.0;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
      geo.setAttribute('aTwinkleSpeed', new THREE.BufferAttribute(twinkleSpeed, 1));
      geo.setAttribute('aTwinklePhase', new THREE.BufferAttribute(twinklePhase, 1));
      geo.setAttribute('aIsTwinkler', new THREE.BufferAttribute(isTwinkler, 1));

      const vHeight = window.innerHeight;
      const fovRad = THREE.MathUtils.degToRad(20.0);
      const scaleVal = (vHeight * 0.5) / Math.tan(fovRad);

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSleep: { value: 1.0 },
          uBaseAlpha: { value: cfg.alpha },
          uBaseSize: { value: cfg.size },
          uScale: { value: scaleVal },
          uTexture: { value: dotTexture },
          uStarColor: { value: new THREE.Vector3(starColor[0], starColor[1], starColor[2]) }
        },
        vertexShader: `
          attribute float aTwinkleSpeed;
          attribute float aTwinklePhase;
          attribute float aIsTwinkler;

          varying float vAlpha;

          uniform float uTime;
          uniform float uSleep;
          uniform float uBaseAlpha;
          uniform float uBaseSize;
          uniform float uScale;

          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;

            // Bell-curve star twinkle in sleep mode:
            // pow(max(0.0, sin(...)), 5.0) keeps the star dormant 90% of the time,
            // slowly swelling and breathing for 2-3 seconds when it peaks
            float sinVal = sin(uTime * aTwinkleSpeed + aTwinklePhase);
            float bell = pow(max(0.0, sinVal), 5.0) * aIsTwinkler * uSleep;

            // Opacity: smoothly rises from base alpha up to ~0.75 at peak glow
            float glowAlpha = mix(uBaseAlpha, min(0.85, uBaseAlpha + 0.58), bell);
            vAlpha = glowAlpha;

            // Size bloom: points subtly expand by ~35% when glowing
            float sizeBloom = 1.0 + bell * 0.38;
            gl_PointSize = uBaseSize * uScale * (1.0 / -mvPosition.z) * sizeBloom;
          }
        `,
        fragmentShader: `
          varying float vAlpha;
          uniform sampler2D uTexture;
          uniform vec3 uStarColor;

          void main() {
            vec2 coord = gl_PointCoord;
            vec4 tex = texture2D(uTexture, coord);
            if (tex.a < 0.04) discard;

            // Per-layer temperature tint (cold far, warm near) for volumetric depth
            gl_FragColor = vec4(uStarColor, tex.a * vAlpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
      });

      const group = new THREE.Group();
      group.add(new THREE.Points(geo, material));
      this.scene.add(group);

      return { cfg, xyz, vel, phase, geo, material, group };
    };

    // Per-layer star color temperatures: cold blue-white (far) → warm peach-white (near)
    const dustStarColors: [number, number, number][] = [
      [0.80, 0.86, 0.96], // Far  — cold blue-white
      [0.88, 0.90, 0.92], // Mid  — neutral white
      [0.94, 0.90, 0.84]  // Near — warm peach-white
    ];
    dustDefinitions.forEach((d, i) => this.dustLayers.push(makeDust(d, dustStarColors[i])));

    // 10. Celestial Dormant Features: Falling Stars (Meteors)
    for (let k = 0; k < 16; k++) {
      const t = 1.0 - k / 15.0; // 1.0 at head, 0.0 at tail
      const alpha = Math.pow(t, 1.6);
      this.meteorColors[k * 3 + 0] = 0.95 * alpha;
      this.meteorColors[k * 3 + 1] = 0.98 * alpha;
      this.meteorColors[k * 3 + 2] = 1.00 * alpha;
    }
    const meteorGeo = new THREE.BufferGeometry();
    meteorGeo.setAttribute('position', new THREE.BufferAttribute(this.meteorPositions, 3));
    meteorGeo.setAttribute('color', new THREE.BufferAttribute(this.meteorColors, 3));

    this.meteorLine = new THREE.Line(
      meteorGeo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.meteorLine.visible = false;
    this.scene.add(this.meteorLine);

    // 11. Celestial Dormant Features: 3D Wireframe Cubesat Satellite Probe
    this.satelliteGroup = new THREE.Group();

    // Cubesat Chassis
    const satBodyGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.20, 0.20, 0.30));
    const satBodyMat = new THREE.LineBasicMaterial({ color: 0xcfd8e4, transparent: true, opacity: 0.40, depthWrite: false });
    this.satelliteGroup.add(new THREE.LineSegments(satBodyGeo, satBodyMat));
    this.satelliteFaders.push({ material: satBodyMat, baseOpacity: 0.40 });

    // Solar Panel Arrays (Left & Right)
    const panelGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.42, 0.18, 3, 1));
    const panelMat = new THREE.LineBasicMaterial({ color: 0x9ec2e6, transparent: true, opacity: 0.32, depthWrite: false });
    this.satelliteFaders.push({ material: panelMat, baseOpacity: 0.32 });

    const leftPanel = new THREE.LineSegments(panelGeo, panelMat);
    leftPanel.position.set(-0.32, 0, 0);
    this.satelliteGroup.add(leftPanel);

    const rightPanel = new THREE.LineSegments(panelGeo, panelMat);
    rightPanel.position.set(0.32, 0, 0);
    this.satelliteGroup.add(rightPanel);

    // Antenna Mast
    const antGeo = new THREE.BufferGeometry();
    antGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.15, 0, 0.14, 0.28], 3));
    const antMat = new THREE.LineBasicMaterial({ color: 0xcfd8e4, transparent: true, opacity: 0.45, depthWrite: false });
    this.satelliteGroup.add(new THREE.Line(antGeo, antMat));
    this.satelliteFaders.push({ material: antMat, baseOpacity: 0.45 });

    // Navigational Beacon LED
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    this.satelliteBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), beaconMat);
    this.satelliteBeacon.position.set(0, 0.14, 0.28);
    this.satelliteGroup.add(this.satelliteBeacon);
    this.satelliteFaders.push({ material: beaconMat, baseOpacity: 0.85 });

    this.satelliteGroup.visible = false;
    this.scene.add(this.satelliteGroup);

    // Setup initial state: globe completely concealed for boot initialization
    this.root.visible = false;
    this.orb.visible = false;
    this.innerCore.visible = false;
    this.shell.visible = false;
    this.shellNodes.visible = false;
    this.satelliteGroup.visible = false;
    this.meteorLine.visible = false;
    this.orbitGroups.forEach((g) => (g.visible = false));
    this.setMode('initializing');

    // Setup pointer tracking
    window.addEventListener('pointermove', (event: PointerEvent) => {
      this.lastPointerMove = performance.now();
      this.mouse.tx = (event.clientX / window.innerWidth - 0.5) * 2;
      this.mouse.ty = (event.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true, signal: this.listeners.signal });

    window.addEventListener('pointerleave', () => {
      this.mouse.tx = 0;
      this.mouse.ty = 0;
    }, { signal: this.listeners.signal });

    this.resize();
    window.addEventListener('resize', () => this.resize(), { signal: this.listeners.signal });
  }

  public setViewportShift(shifted: boolean): void {
    this.isShifted = shifted;
    this.updateTargetTransforms();
  }

  public setCornerDock(docked: boolean): void {
    this.isCornerDocked = docked;
    if (this.scene) {
      // Retain authentic depth fog so rear dots gently soften into the deep background
      this.scene.fog = new THREE.FogExp2(0x080b0e, 0.048);
    }
    this.updateTargetTransforms();
  }

  public getIsCornerDocked(): boolean {
    return this.isCornerDocked;
  }

  private updateTargetTransforms(): void {
    const width = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const height = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const aspect = width / height;
    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
    const visibleHeight = 2 * Math.tan(vFOV / 2) * this.camera.position.z;
    const visibleWidth = visibleHeight * aspect;

    if (this.isCornerDocked) {
      // Exact concentric alignment with bottom-right aperture ring (115px right, 115px bottom)
      const targetPxFromRight = 115;
      const targetPxFromBottom = 115;
      const ndcX = 1 - (2 * targetPxFromRight / width);
      const ndcY = -1 + (2 * targetPxFromBottom / height);

      const refCam = this.camera.clone();
      refCam.position.set(0, 0, width / height < 0.7 ? 15 : width / height < 1.1 ? 12.5 : 10);
      refCam.aspect = width / height;
      refCam.updateProjectionMatrix();
      refCam.lookAt(0, 0.27, 0);
      refCam.updateMatrixWorld();

      const targetVec = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(refCam);
      const dir = targetVec.sub(refCam.position).normalize();
      const distance = -refCam.position.z / dir.z;
      const worldPos = refCam.position.clone().add(dir.multiplyScalar(distance));

      this.targetOffsetX = worldPos.x;
      this.targetOffsetY = worldPos.y;
      this.targetScale = 0.20;
      return;
    }

    this.targetOffsetY = 0.54;
    this.targetScale = 1.0;

    if (!this.isShifted) {
      this.targetOffsetX = 0;
      return;
    }
    const drawerPx = Math.min(460, width * 0.45);
    this.targetOffsetX = -((drawerPx / 2) / width) * visibleWidth;
  }

  private updateTargetOffsetX(): void {
    this.updateTargetTransforms();
  }

  public resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.position.z = width / height < 0.7 ? 15 : width / height < 1.1 ? 12.5 : 10;
    this.camera.updateProjectionMatrix();
    this.updateTargetOffsetX();

    const scaleVal = (height * 0.5) / Math.tan(THREE.MathUtils.degToRad(20.0));
    for (const layer of this.dustLayers) {
      if (layer.material && layer.material.uniforms.uScale) {
        layer.material.uniforms.uScale.value = scaleVal;
      }
    }
    // PointsMaterial automatically handles scale via sizeAttenuation
    if (this.shellNodes?.material?.uniforms?.uScale) {
      this.shellNodes.material.uniforms.uScale.value = scaleVal;
    }
  }


  public startColdBoot(options?: ColdBootOptions): void {
    this.coldBoot.active = true;
    this.coldBoot.elapsed = 0;
    this.coldBoot.stage = 'ZERO';
    this.coldBoot.accelerated = options?.accelerated ?? false;
    this.coldBoot.onStageChange = options?.onStageChange;
    this.coldBoot.onComplete = options?.onComplete;

    this.isBooting = true;
    this.state.sleep = 0;
    this.state.targetSleep = 0;
    this.state.energy = 0.5;
    this.state.targetEnergy = 0.35;
    this.root.visible = false;
    this.orb.visible = false;
    this.innerCore.visible = false;
    this.shell.visible = false;
    this.shellNodes.visible = false;
    this.coreRingGroup.visible = false;
    this.coreSatellites.visible = false;
    this.orbitGroups.forEach(g => (g.visible = false));
    this.meteorLine.visible = false;
    this.satelliteGroup.visible = false;

    if (this.orbPositions) {
      this.orbPositions.fill(0);
      this.orbGeometry.attributes.position.needsUpdate = true;
    }
    if (this.orbMaterial) {
      this.orbMaterial.opacity = 0.0;
    }
    if (this.shellMaterial?.uniforms?.uBuildProgress) {
      this.shellMaterial.uniforms.uBuildProgress.value = 0.0;
    }
    if (this.shellNodes?.material?.uniforms?.uBuildProgress) {
      this.shellNodes.material.uniforms.uBuildProgress.value = 0.0;
    }

    this.coldBoot.onStageChange?.('ZERO');
  }

  public skipColdBoot(): void {
    if (!this.coldBoot.active) return;
    this.coldBoot.active = false;
    this.coldBoot.stage = 'COMPLETE';
    this.isBooting = false;

    this.root.visible = true;
    this.orb.visible = true;
    this.innerCore.visible = true;
    this.shell.visible = true;
    this.shellNodes.visible = true;
    this.coreRingGroup.visible = true;
    this.coreSatellites.visible = true;
    this.orbitGroups.forEach(g => {
      g.visible = true;
      g.scale.setScalar(1.0);
    });

    if (this.orbPositions && this.orbBasePositions) {
      this.orbPositions.set(this.orbBasePositions);
      this.orbGeometry.attributes.position.needsUpdate = true;
    }
    if (this.orbMaterial) {
      this.orbMaterial.opacity = 0.70;
    }
    if (this.shellMaterial?.uniforms?.uBuildProgress) {
      this.shellMaterial.uniforms.uBuildProgress.value = 1.0;
      this.shellMaterial.uniforms.uReveal.value = 1.0;
    }
    if (this.shellNodes?.material?.uniforms?.uBuildProgress) {
      this.shellNodes.material.uniforms.uBuildProgress.value = 1.0;
      this.shellNodes.material.uniforms.uReveal.value = 1.0;
    }
    this.innerCore.scale.setScalar(1.0);
    this.singularityMaterial.uniforms.uReveal.value = 1.0;
    this.innerNucleusMaterial.uniforms.uReveal.value = 1.0;
    this.filamentMaterial.uniforms.uReveal.value = 0.85;

    this.coldBoot.onStageChange?.('COMPLETE');
    this.coldBoot.onComplete?.();
  }

  public setInputLevel(level: number): void {
    this.inputLevel = THREE.MathUtils.clamp(level, 0, 1);
  }

  public showVoiceError(): void {
    this.voiceErrorUntil = this.elapsed + 1.8;
  }

  private createVoiceRings(): void {
    this.voiceHalo = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTint: { value: this.shellTint }, uOpacity: { value: 0 } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform vec3 uTint;
          uniform float uOpacity;
          void main() {
            float radius = length(vUv * 2.0 - 1.0);
            if (radius > 1.0) discard;
            float coreGlow = pow(clamp(1.0 - radius / 0.40, 0.0, 1.0), 2.2) * 1.5;
            float midGlow = pow(clamp(1.0 - radius / 0.85, 0.0, 1.0), 2.8) * 0.85;
            float totalGlow = (coreGlow + midGlow) * uOpacity;
            vec3 coreWhite = vec3(0.96, 0.98, 1.0);
            vec3 col = mix(uTint, coreWhite, clamp(coreGlow * 0.60, 0.0, 0.70));
            gl_FragColor = vec4(col, totalGlow);
          }
        `,
      }),
    );
    this.voiceHalo.position.z = -2;
    this.voiceHalo.visible = false;
    this.root.add(this.voiceHalo);


    const bars = new THREE.BufferAttribute(new Float32Array(VOICE_BARS * 6), 3);
    bars.setUsage(THREE.DynamicDrawUsage);
    const listeningGeometry = new THREE.BufferGeometry().setAttribute('position', bars);
    const material = () => new THREE.LineBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false,
    });
    this.listeningRing = new THREE.LineSegments(listeningGeometry, material());
    this.listeningRing.frustumCulled = false;
    for (let i = 0; i < VOICE_BARS; i++) {
      const angle = i * Math.PI * 2 / VOICE_BARS;
      this.barDirections[i * 2] = Math.cos(angle);
      this.barDirections[i * 2 + 1] = Math.sin(angle);
    }

    this.processingRing = new THREE.Group();
    this.processingRingMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const violet = new THREE.Color(ORB_COLORS.thinking);
    const violetTip = new THREE.Color(0xd5caff);
    const arcColor = new THREE.Color();
    for (const [offset, span, intensity] of [[0, 1.18, 1], [Math.PI, 0.56, 0.58]]) {
      const radius = VOICE_RING_RADIUS;
      const geometry = new THREE.RingGeometry(radius - 0.065, radius + 0.065, 64, 1, 0, span);
      const positions = geometry.getAttribute('position');
      const colors = new Float32Array(positions.count * 4);
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const distance = Math.hypot(x, y);
        const progress = THREE.MathUtils.clamp(Math.atan2(y, x) / span, 0, 1);
        const taper = 0.2 + progress * 0.8;
        const scale = (radius + (distance - radius) * taper) / distance;
        positions.setXY(i, x * scale, y * scale);
        arcColor.copy(violet).lerp(violetTip, progress ** 3 * 0.8);
        colors.set([arcColor.r, arcColor.g, arcColor.b, intensity * (0.08 + progress * 0.92)], i * 4);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      const arc = new THREE.Mesh(geometry, this.processingRingMaterial);
      arc.rotation.z = offset;
      this.processingRing.add(arc);
    }
    const rimPoints = Array.from({ length: 96 }, (_, i) => {
      const angle = i * Math.PI * 2 / 96;
      return new THREE.Vector3(Math.cos(angle) * VOICE_RING_RADIUS, Math.sin(angle) * VOICE_RING_RADIUS, 0);
    });
    this.transcriptionRing = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(rimPoints), material(),
    );
    this.transcriptionRing.material.color.setHex(ORB_COLORS.transcribing);
    this.transcriptionRing.visible = false;
    this.listeningRing.visible = false;
    this.processingRing.visible = false;
    this.speakingRing = new THREE.Group();
    this.speakingRingMaterial = new THREE.MeshBasicMaterial({
      color: ORB_COLORS.speaking,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const arc = new THREE.RingGeometry(VOICE_RING_RADIUS - 0.065, VOICE_RING_RADIUS + 0.065, 48, 1, 0, 1.25);
    for (let i = 0; i < 4; i++) {
      const segment = new THREE.Mesh(arc, this.speakingRingMaterial);
      segment.rotation.z = i * Math.PI / 2 + 0.2;
      this.speakingRing.add(segment);
    }
    this.speakingRing.visible = false;

    // Keep voice feedback facing the viewer while the 3D orb precesses behind it.
    this.voiceRings = new THREE.Group();
    this.voiceRings.add(this.listeningRing, this.transcriptionRing, this.processingRing, this.speakingRing);
    this.root.add(this.voiceRings);
  }

  private updateVoiceVisuals(dt: number, reveal: number, reduced: boolean): void {
    const mode = this.state.mode;
    if (mode !== this.voiceVisualMode) {
      this.voiceVisualMode = mode;
      this.voiceVisualProgress = 0;
      this.accentFrom.copy(this.accent);
      this.accentTarget.setHex(ORB_COLORS[mode]);
      this.voiceDetailFrom.copy(this.voiceDetail);
      this.voiceDetailTarget.set(
        Number(mode === 'listening'), Number(mode === 'thinking'), Number(mode === 'speaking'),
        Number(mode === 'transcribing'),
      );
    }
    const duration = reduced ? 0.15 : ORB_TRANSITION[mode];
    this.voiceVisualProgress = Math.min(1, this.voiceVisualProgress + dt / duration);
    const p = this.voiceVisualProgress;
    const eased = p * p * (3 - 2 * p);
    this.accent.lerpColors(this.accentFrom, this.accentTarget, eased);
    const errorRemaining = this.voiceErrorUntil - this.elapsed;
    const errorBlend = mode === 'ready' && errorRemaining > 0
      ? Math.min(
        THREE.MathUtils.smoothstep(1.8 - errorRemaining, 0, reduced ? 0.12 : 0.28),
        THREE.MathUtils.smoothstep(errorRemaining, 0, 0.3),
      )
      : 0;
    this.displayAccent.copy(this.accent).lerp(this.errorTint, errorBlend);
    this.displayAccent.getRGB(this.shellTint, THREE.SRGBColorSpace);
    const active = mode === 'listening' || mode === 'transcribing';
    const isThinking = mode === 'thinking';
    const isSpeaking = mode === 'speaking';
    const halo = reveal * (active ? 0.12 : isThinking ? 0.16 : isSpeaking ? (0.13 + this.speakingEnvelope * 0.12) : 0.04);
    const opacity = this.voiceHalo.material.uniforms.uOpacity;
    opacity.value = THREE.MathUtils.damp(opacity.value, halo, 12, dt);
    this.voiceHalo.visible = opacity.value > 0.001;
    if (this.voiceHalo.visible && !reduced) {
      const haloScale = isSpeaking ? (1.0 + this.speakingEnvelope * 0.16) : isThinking ? (1.0 + Math.sin(this.visualTime * 4.2) * 0.045) : 1.0;
      this.voiceHalo.scale.setScalar(haloScale);
    }
    this.voiceDetail.lerpVectors(this.voiceDetailFrom, this.voiceDetailTarget, eased);

    // Audio Input (Listening) Envelope
    const input = mode === 'listening' && !reduced ? this.inputLevel : 0;
    const response = input > this.inputEnvelope ? 0.06 : 0.20;
    this.inputEnvelope += (input - this.inputEnvelope) * (1 - Math.exp(-dt / response));

    // Audio Playback / Output (Speaking) Envelope
    const realAudio = (mode === 'speaking' && !reduced) ? readPlaybackEnergy() : 0;
    const syntheticInflection = (mode === 'speaking' && !reduced)
      ? (Math.sin(this.visualTime * 11.2) * 0.22 + Math.sin(this.visualTime * 18.0) * 0.16 + 0.42)
      : 0;
    const targetSpeak = realAudio > 0.02 ? realAudio : (mode === 'speaking' ? Math.max(0, Math.min(0.85, syntheticInflection)) : 0);
    const speakSpeed = targetSpeak > this.speakingEnvelope ? 0.05 : 0.14;
    this.speakingEnvelope += (targetSpeak - this.speakingEnvelope) * (1 - Math.exp(-dt / speakSpeed));

    // 1. Listening Rings
    this.listeningRing.material.opacity = this.voiceDetail.x * reveal * 0.85;
    this.transcriptionRing.material.opacity = this.voiceDetail.w * reveal * 0.5;
    this.transcriptionRing.visible = this.transcriptionRing.material.opacity > 0.001;
    this.listeningRing.material.color.setHex(ORB_COLORS.listening);
    this.listeningRing.visible = this.listeningRing.material.opacity > 0.001;

    // 2. Thinking / Cognitive Processing Ring (Amethyst Precession Rings)
    const hasThinkingDetail = this.voiceDetail.y > 0.001;
    this.processingRingMaterial.opacity = this.voiceDetail.y * reveal * 0.95;
    this.processingRing.visible = hasThinkingDetail && reveal > 0.01;
    if (this.processingRing.visible && !reduced) {
      this.processingRing.rotation.z += dt * (2.2 + Math.sin(this.visualTime * 4.5) * 0.7);
      const thinkPulse = 1.0 + Math.sin(this.visualTime * 5.2) * 0.035;
      this.processingRing.scale.setScalar(thinkPulse);
    }

    // 3. Speaking / Harmonic Voice Acoustic Ring (Solar Amber Resonance)
    const hasSpeakingDetail = this.voiceDetail.z > 0.001;
    this.speakingRingMaterial.opacity = this.voiceDetail.z * reveal * (0.60 + this.speakingEnvelope * 0.40);
    this.speakingRingMaterial.color.setHex(ORB_COLORS.speaking);
    this.speakingRing.visible = hasSpeakingDetail && reveal > 0.01;
    if (this.speakingRing.visible && !reduced) {
      this.speakingRing.rotation.z += dt * (0.9 + this.speakingEnvelope * 2.2);
      const speakScale = 1.0 + this.speakingEnvelope * 0.16 + Math.sin(this.visualTime * 6.0) * 0.02;
      this.speakingRing.scale.setScalar(speakScale);
    }

    if (this.listeningRing.visible) {
      const positions = this.listeningRing.geometry.getAttribute('position');
      for (let i = 0; i < VOICE_BARS; i++) {
        const x = this.barDirections[i * 2];
        const y = this.barDirections[i * 2 + 1];
        const wave = 0.65 + 0.35 * Math.sin(i * Math.PI * 8 / VOICE_BARS - this.elapsed * 3);
        const tip = 2.22 + (reduced ? 0 : this.inputEnvelope * wave * 0.16);
        positions.setXYZ(i * 2, x * 2.10, y * 2.10, 0);
        positions.setXYZ(i * 2 + 1, x * tip, y * tip, 0);
      }
      positions.needsUpdate = true;
    }
  }

  public setMode(next: OracleMode): void {
    const prev = this.state.mode;
    // Voice initialization can report Ready while the intro is still running.
    if (this.coldBoot.active && prev === 'ready' && next === 'ready') return;
    if (prev === 'listening' && next !== prev) this.inputLevel = 0;
    this.state.mode = next;
    this.state.targetSleep = next === 'dormant' ? 1 : 0;
    this.state.targetEnergy = ENERGY_LEVELS[next];
    if (next === 'initializing') {
      this.startColdBoot();
    } else {
      if (this.coldBoot.active) {
        this.skipColdBoot();
      }
      if (prev === 'initializing' || this.isBooting) {
        this.triggerAwakening();
      } else {
        this.isBooting = false;
        this.root.visible = true;
        this.orb.visible = true;
      }
    }
  }

  public triggerAwakening(): void {
    this.isAwakening = true;
    this.awakenProgress = 0;
    this.isBooting = false;
    this.root.visible = true;
    this.orb.visible = true;
    this.state.sleep = 1.0;
    this.state.targetSleep = 0;
    this.state.energy = 0.85; // Initial kinetic energy surge
    this.state.targetEnergy = ENERGY_LEVELS[this.state.mode] ?? 0.35;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();

    const frame = (now: number) => {
      if (!this.isRunning) return;
      this.animId = requestAnimationFrame(frame);

      if (document.hidden) {
        this.lastTime = now;
        return;
      }

      const reduced = this.reducedMotionMedia.matches;
      const idle = this.state.mode === 'ready' && now - this.lastPointerMove > 500;
      const frameRate = reduced || this.hibernating ? 10 : (this.state.sleep > 0.95 || idle) ? 30 : 60;
      const minInterval = 1000 / frameRate;
      if (now - this.lastRendered < minInterval) return;

      const dt = Math.min((now - this.lastTime) / 1000, 0.08);
      this.lastTime = now;
      this.lastRendered = now;
      this.elapsed += dt;
      if (!reduced) this.visualTime += dt;

      // Exponential smoothing with luxurious organic rate (dt * 1.6 for gentle ease)
      const sleepSpeed = this.state.targetSleep === 0 ? 1.55 : 1.75;
      const interpSleep = 1 - Math.exp(-dt * sleepSpeed);
      const interpEnergy = 1 - Math.exp(-dt * 2.0);
      this.state.energy += (this.state.targetEnergy - this.state.energy) * interpEnergy;
      this.state.sleep += (this.state.targetSleep - this.state.sleep) * interpSleep;

      // Hermite S-curve interpolation for continuous, velvety smooth visual transitions:
      const s = this.state.sleep;
      const smoothIdle = s * s * (3.0 - 2.0 * s); // smoothstep curve
      
      // Smooth dock blend progress: 0.0 (home center) to 1.0 (corner dock)
      const dockProgress = Math.max(0, Math.min(1.0, (1.0 - this.currentScale) / (1.0 - 0.20)));
      // When docked in Tactical Geo Map, maintain authentic full spherical volume (do not deflate by idle dormant curve)
      const innerScale = (1.0 - smoothIdle * 0.5) * (1.0 - dockProgress) + 1.0 * dockProgress;

      const motion = reduced ? 0 : 1;
      this.root.rotation.y += dt * (0.014 + this.state.energy * 0.045) * motion;
      // Gentle axial precession: gracefully level to a poised horizontal alignment when docked
      const baseTiltX = (0.17 + Math.sin(this.visualTime * 0.08) * 0.04) * (1.0 - dockProgress) + 0.08 * dockProgress;
      this.root.rotation.x = baseTiltX;
      this.shell.rotation.y -= dt * 0.012 * motion;
      this.shellNodes.rotation.copy(this.shell.rotation);

      if (this.isAwakening) {
        this.awakenProgress += dt * 0.75; // ~1.33s smooth cinematic awakening
        if (this.awakenProgress >= 1.0) {
          this.awakenProgress = 1.0;
          this.isAwakening = false;
        }
      }
      const awakenP = this.isAwakening ? this.awakenProgress : 1.0;
      const easeAwaken = awakenP * awakenP * (3.0 - 2.0 * awakenP);

      // Eased reveal parameter: hermite S-curve from 0.0 to 1.0 (forced 0 during boot checking)
      const rawAwake = Math.max(0.0, Math.min(1.0, 1.0 - this.state.sleep));
      let reveal = this.isBooting ? 0 : rawAwake * rawAwake * (3.0 - 2.0 * rawAwake);
      if (this.isAwakening) {
        reveal = Math.max(reveal, easeAwaken);
      }
      // When docked in Tactical Geo Map, keep core active and radiant
      const effectiveReveal = Math.max(reveal, dockProgress * 0.92);

      let orbitalAssembly = 0;
      // Procedural Multi-Stage Cold Boot Engine
      if (this.coldBoot.active) {
        const speedMult = this.coldBoot.accelerated ? 1.75 : 1.0;
        this.coldBoot.elapsed += dt * speedMult;
        const time = this.coldBoot.elapsed;
        const ignitionEnd = 0.72;
        const particlesEnd = 2.45;
        const scanStart = 1.55;
        const scanEnd = 3.25;
        const orbitStart = 2.90;
        const bootEnd = 4.30;

        if (reduced || time >= bootEnd) {
          this.skipColdBoot();
        } else if (time < ignitionEnd) {
          // Light the core on the first frame.
          if (this.coldBoot.stage !== 'CORE_IGNITION') {
            this.coldBoot.stage = 'CORE_IGNITION';
            this.coldBoot.onStageChange?.('CORE_IGNITION');
          }
          this.root.visible = true;
          this.innerCore.visible = true;
          this.orb.visible = false;
          this.shell.visible = false;
          this.shellNodes.visible = false;
          this.orbitGroups.forEach(g => (g.visible = false));

          const u = time / ignitionEnd;
          const coreScale = 0.14 + 0.86 * (1.0 - Math.pow(1.0 - u, 3.0));
          const bloom = 0.12 * Math.pow(Math.sin(Math.PI * u), 2);
          const coreReveal = 0.20 + 0.80 * (1.0 - Math.pow(1.0 - u, 3.0)) + bloom;

          this.innerCore.scale.setScalar(coreScale);
          this.singularityMaterial.uniforms.uReveal.value = coreReveal;
          this.innerNucleusMaterial.uniforms.uReveal.value = coreReveal;
          this.filamentMaterial.uniforms.uReveal.value = coreReveal * 0.85;

          this.coreRingGroup.visible = coreReveal > 0.1;
          this.coreRingGroup.scale.setScalar(coreScale);
          for (const item of this.coreRingFaders) {
            item.material.opacity = item.baseOpacity * coreReveal;
          }
          this.coreSatellites.visible = coreReveal > 0.15;
        } else if (time < particlesEnd) {
          // Stage 03: Inner Particle Sphere Formation
          if (this.coldBoot.stage !== 'PARTICLES') {
            this.coldBoot.stage = 'PARTICLES';
            this.coldBoot.onStageChange?.('PARTICLES');
          }
          this.root.visible = true;
          this.innerCore.visible = true;
          this.orb.visible = true;
          this.shell.visible = false;
          this.shellNodes.visible = false;
          this.orbitGroups.forEach(g => (g.visible = false));

          // Start the shell scan while the particles are still settling.
          const shellProgress = Math.max(0, (time - scanStart) / (scanEnd - scanStart));
          this.shell.visible = shellProgress > 0;
          this.shellNodes.visible = shellProgress > 0;
          this.shellMaterial.uniforms.uBuildProgress.value = shellProgress;
          this.shellNodes.material.uniforms.uBuildProgress.value = shellProgress;
          this.shellMaterial.uniforms.uReveal.value = shellProgress * 1.25;
          this.shellNodes.material.uniforms.uReveal.value = shellProgress * 1.25;

          const u = (time - ignitionEnd) / (particlesEnd - ignitionEnd);
          const pos = this.orbPositions;
          const basePos = this.orbBasePositions;
          const delays = this.orbDelays;
          for (let i = 0; i < delays.length; i++) {
            const delay = delays[i];
            const progress = THREE.MathUtils.clamp((u - delay) / (1 - delay), 0, 1);
            const remaining = 1 - progress;
            const turn = (0.55 + delay * 0.8) * remaining * remaining;
            const radius = 1 + (0.58 + delay * 0.55) * remaining * remaining
              - 0.42 * Math.pow(Math.sin(Math.PI * progress), 2) * progress;
            const offset = i * 3;
            const x = basePos[offset];
            const z = basePos[offset + 2];
            const cos = Math.cos(turn);
            const sin = Math.sin(turn);
            pos[offset] = (x * cos - z * sin) * radius;
            pos[offset + 1] = basePos[offset + 1] * radius;
            pos[offset + 2] = (x * sin + z * cos) * radius;
          }
          this.orbGeometry.attributes.position.needsUpdate = true;
          this.orbMaterial.opacity = 0.70 * Math.min(1.0, u * 1.3);

          this.innerCore.scale.setScalar(1.0);
          this.coreRingGroup.scale.setScalar(1.0);
          this.singularityMaterial.uniforms.uReveal.value = 1.0;
          this.innerNucleusMaterial.uniforms.uReveal.value = 1.0;
          this.filamentMaterial.uniforms.uReveal.value = 0.85;
          for (const item of this.coreRingFaders) {
            item.material.opacity = item.baseOpacity;
          }
        } else if (time < scanEnd) {
          // Stage 04: Geometric Framework Construction
          if (this.coldBoot.stage !== 'FRAMEWORK') {
            this.coldBoot.stage = 'FRAMEWORK';
            this.coldBoot.onStageChange?.('FRAMEWORK');
          }
          this.root.visible = true;
          this.innerCore.visible = true;
          this.orb.visible = true;
          this.orbPositions.set(this.orbBasePositions);
          this.orbGeometry.attributes.position.needsUpdate = true;
          this.orbMaterial.opacity = 0.70;

          this.shell.visible = true;
          this.shellNodes.visible = true;
          this.orbitGroups.forEach(g => (g.visible = false));

          const u = (time - scanStart) / (scanEnd - scanStart);
          this.shellMaterial.uniforms.uBuildProgress.value = u;
          this.shellNodes.material.uniforms.uBuildProgress.value = u;
          this.shellMaterial.uniforms.uReveal.value = Math.min(1.0, u * 1.25);
          this.shellNodes.material.uniforms.uReveal.value = Math.min(1.0, u * 1.25);
        } else {
          // Stage 05: Outer Orbital Spiral Formation
          if (this.coldBoot.stage !== 'ORBITALS') {
            this.coldBoot.stage = 'ORBITALS';
            this.coldBoot.onStageChange?.('ORBITALS');
          }
          this.root.visible = true;
          this.innerCore.visible = true;
          this.orb.visible = true;
          this.shell.visible = true;
          this.shellNodes.visible = true;
          this.shellMaterial.uniforms.uBuildProgress.value = 1.0;
          this.shellNodes.material.uniforms.uBuildProgress.value = 1.0;
          this.shellMaterial.uniforms.uReveal.value = 1.0;
          this.shellNodes.material.uniforms.uReveal.value = 1.0;
        }
        orbitalAssembly = THREE.MathUtils.clamp((time - orbitStart) / (bootEnd - orbitStart), 0, 1);
      } else {
        this.root.visible = true;
        this.orb.visible = true;
        const orbScaleMult = this.isAwakening ? (0.45 + 0.55 * easeAwaken) : 1.0;
        const thinkContract = (!reduced && this.state.mode === 'thinking') ? (0.93 + Math.sin(this.visualTime * 4.8) * 0.02) : 1.0;
        const speakExpansion = (!reduced && this.state.mode === 'speaking') ? (1.0 + this.speakingEnvelope * 0.075) : 1.0;
        this.orb.scale.setScalar(innerScale * orbScaleMult * thinkContract * speakExpansion);
        this.orbMaterial.opacity = (0.60 + this.state.energy * 0.22 - smoothIdle * 0.09) * (this.isAwakening ? easeAwaken : 1.0);
      }

      this.updateVoiceVisuals(dt, this.coldBoot.active ? 0 : effectiveReveal, reduced);
      const isListeningState = this.state.mode === 'listening' && !reduced;
      const isThinkingState = this.state.mode === 'thinking' && !reduced;
      const isSpeakingState = this.state.mode === 'speaking' && !reduced;
      const accentLerp = isThinkingState ? 0.95 : isSpeakingState ? (0.75 + this.speakingEnvelope * 0.25) : isListeningState ? 0.70 : 0.25;
      this.orbMaterial.color.setRGB(1, 1, 1).lerp(this.displayAccent, accentLerp);
      if (this.orbMaterial) {
        this.orbMaterial.size = (0.05 + (isThinkingState ? Math.sin(this.visualTime * 6.0) * 0.005 : isSpeakingState ? this.speakingEnvelope * 0.008 : 0)) * this.currentScale;
      }

      // Propagate dynamic harmonic color wave across the 2,400 particle dots with 3D volumetric view-depth attenuation
      if (!reduced && (isThinkingState || isSpeakingState || isListeningState) && this.orbColors && this.orbBaseColors) {
        const tr = this.displayAccent.r;
        const tg = this.displayAccent.g;
        const tb = this.displayAccent.b;
        const tWeight = isThinkingState ? 0.72 : isSpeakingState ? (0.58 + this.speakingEnvelope * 0.38) : 0.45;
        const pos = this.orbPositions;
        const rotY = this.root.rotation.y;
        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);

        for (let i = 0; i < this.orbColors.length / 3; i++) {
          const baseR = this.orbBaseColors[i * 3];
          const baseG = this.orbBaseColors[i * 3 + 1];
          const baseB = this.orbBaseColors[i * 3 + 2];

          // Dynamic rotating 3D view-space depth attenuation
          const origX = this.orbBasePositions[i * 3];
          const origZ = this.orbBasePositions[i * 3 + 2];
          const worldZ = -origX * sinY + origZ * cosY;
          const zDepthNorm = THREE.MathUtils.clamp((worldZ / 1.9 + 1.0) * 0.5, 0.0, 1.0);
          const depthLuminance = 0.32 + 0.68 * Math.pow(zDepthNorm, 1.25);

          const wave = Math.sin(pos[i * 3 + 1] * 4.0 - this.visualTime * (isThinkingState ? 7.0 : 4.5)) * 0.22;
          const w = Math.max(0, Math.min(1, tWeight + wave));
          this.orbColors[i * 3 + 0] = (baseR * (1 - w) + tr * w) * depthLuminance;
          this.orbColors[i * 3 + 1] = (baseG * (1 - w) + tg * w) * depthLuminance;
          this.orbColors[i * 3 + 2] = (baseB * (1 - w) + tb * w) * depthLuminance;
        }
        this.orbGeometry.attributes.color.needsUpdate = true;
        this.orbScanActive = true;
      } else if (this.orbScanActive && this.orbColors && this.orbBaseColors) {
        this.orbColors.set(this.orbBaseColors);
        this.orbGeometry.attributes.color.needsUpdate = true;
        this.orbScanActive = false;
      }

      // Cursor focus detection (distance to center of orb)
      const mouseDist = Math.sqrt(this.mouse.x * this.mouse.x + Math.pow(this.mouse.y + 0.12, 2));
      const focus = Math.max(0.0, Math.min(1.0, 1.0 - mouseDist * 1.5)) * motion;

      // Central Core uniforms update
      this.singularityMaterial.uniforms.uTime.value = this.visualTime;
      this.singularityMaterial.uniforms.uFocus.value = focus;
      this.singularityMaterial.uniforms.uEnergy.value = this.state.energy;

      this.innerNucleusMaterial.uniforms.uTime.value = this.visualTime;
      this.innerNucleusMaterial.uniforms.uFocus.value = focus;
      this.innerNucleusMaterial.uniforms.uEnergy.value = this.state.energy;

      this.filamentMaterial.uniforms.uTime.value = this.visualTime;
      this.filamentMaterial.uniforms.uFocus.value = focus;
      this.filamentMaterial.uniforms.uEnergy.value = this.state.energy;

      if (!this.coldBoot.active) {
        this.innerCore.visible = effectiveReveal > 0.001;
        const coreScale = this.isAwakening ? (0.10 + 0.90 * easeAwaken) : 1.0;
        // Organic asymmetrical heartbeat breath curve for thinking mode
        const organicBreath = (Math.exp(Math.sin(this.visualTime * 3.8)) - 0.368) * 0.42;
        const thinkCoreScale = (!reduced && this.state.mode === 'thinking') ? (1.0 + organicBreath * 0.09) : 1.0;
        const speakCoreScale = (!reduced && this.state.mode === 'speaking') ? (1.0 + this.speakingEnvelope * 0.15) : 1.0;
        this.innerCore.scale.setScalar(coreScale * thinkCoreScale * speakCoreScale);
        this.singularityMaterial.uniforms.uReveal.value = effectiveReveal;
        this.innerNucleusMaterial.uniforms.uReveal.value = effectiveReveal;
        this.filamentMaterial.uniforms.uReveal.value = effectiveReveal;
      }

      // 3D Dimensional Precession & Perspective Tilt
      const modeCoreSpin = this.state.mode === 'thinking' ? 2.8 : this.state.mode === 'speaking' ? (1.4 + this.speakingEnvelope * 0.8) : 1.0;
      this.innerCore.rotation.y += dt * 0.04 * motion * modeCoreSpin;
      this.innerCore.rotation.x = Math.sin(this.visualTime * 0.35) * 0.06 + this.mouse.y * 0.12 * motion;
      this.innerCore.rotation.z = Math.cos(this.visualTime * 0.28) * 0.05 - this.mouse.x * 0.12 * motion;

      // Internal Nucleus counter-rotates for motion parallax
      this.innerNucleusMesh.rotation.y -= dt * 0.14 * motion * modeCoreSpin;
      this.innerNucleusMesh.rotation.x += dt * 0.08 * motion;

      // Calibration micro-ring & multi-axial gyroscopic gimbals dynamics
      this.coreRingGroup.rotation.z += dt * 0.035 * motion * modeCoreSpin;
      this.meridianGimbal.rotation.x += dt * 0.055 * motion * modeCoreSpin;
      this.axialGimbal.rotation.y -= dt * 0.045 * motion * modeCoreSpin;
      this.coreSatellites.rotation.y += dt * (0.10 + (this.state.mode === 'speaking' ? this.speakingEnvelope * 0.25 : 0)) * motion;
      this.coreSatellites.rotation.x += dt * 0.05 * motion;
      if (this.coreSatellites?.material) {
        (this.coreSatellites.material as THREE.PointsMaterial).color.copy(this.displayAccent).lerp(new THREE.Color(0xffffff), 0.22);
      }
      this.coreSatellites.rotation.x += dt * 0.05 * motion;
      this.shellNodes.material.uniforms.uTime.value = this.visualTime;
      this.shellMaterial.uniforms.uBaseOpacity.value = 0.052 + this.state.energy * 0.028;

      if (!this.coldBoot.active) {
        for (const item of this.coreRingFaders) {
          item.material.opacity = item.baseOpacity * effectiveReveal;
          if (item.baseColor && 'color' in item.material) {
            ((item.material as any).color as THREE.Color).copy(item.baseColor).lerp(this.displayAccent, 0.72);
          }
        }
        this.coreRingGroup.visible = effectiveReveal > 0.001;
        const ringScale = this.isAwakening ? (0.15 + 0.85 * easeAwaken) : 1.0;
        this.coreRingGroup.scale.setScalar(ringScale);

        // 3D Quantum micro-nodes swarm
        this.coreSatellites.visible = effectiveReveal > 0.001;

        // Smooth dock blend progress: 0.0 (home center) to 1.0 (corner dock)
        const dockProgress = Math.max(0, Math.min(1.0, (1.0 - this.currentScale) / (1.0 - 0.22)));

        // Update Polygon Shell: Fade out interior wireframe cage when docked to eliminate clutter
        const shellProg = this.isAwakening ? Math.max(0.001, Math.min(1.0, (awakenP - 0.15) / 0.75)) : 1.0;
        const shellEase = shellProg * shellProg * (3.0 - 2.0 * shellProg);
        const shellScale = this.isAwakening ? (0.30 + 0.70 * shellEase) : 1.0;
        this.shell.scale.setScalar(shellScale);
        this.shellNodes.scale.setScalar(shellScale);

        // Authentic crystalline icosahedron framework preserved in docked mode with refined hairline opacity
        const shellLodReveal = Math.max(reveal, dockProgress * 0.35);
        this.shellMaterial.uniforms.uReveal.value = shellLodReveal;
        this.shell.visible = shellLodReveal > 0.005;

        this.shellNodes.material.uniforms.uReveal.value = shellLodReveal;
        this.shellNodes.visible = shellLodReveal > 0.005;
      }

      // Magnetic gyroscopic tilt driven by cursor position
      const gyroX = this.mouse.y * 0.16 * motion;
      const gyroZ = -this.mouse.x * 0.16 * motion;

      this.orbitGroups.forEach((g, idx) => {
        const u = g.userData as OrbitUserData;
        const ringDelay = idx * 0.16;
        const ringProg = this.isAwakening ? Math.max(0.001, Math.min(1.0, (awakenP - ringDelay) / 0.65)) : 1.0;
        const ringEase = ringProg * ringProg * (3.0 - 2.0 * ringProg);
        const bootDelay = idx * 0.28 / Math.max(1, this.orbitGroups.length - 1);
        const bootProgress = THREE.MathUtils.clamp((orbitalAssembly - bootDelay) / 0.72, 0, 1);
        const bootEase = bootProgress * bootProgress * (3 - 2 * bootProgress);
        const approach = this.coldBoot.active ? (1 - bootEase) * (idx % 2 === 0 ? 1 : -1) : 0;
        g.scale.setScalar(this.coldBoot.active
          ? 1.20 - 0.20 * bootEase
          : this.isAwakening ? 0.15 + 0.85 * ringEase : 1);

        // Kinetic spin surge during awaken or active thinking/speaking
        const spinBoost = this.isAwakening
          ? Math.min(2.4, 2.8 - 1.8 * easeAwaken)
          : this.state.mode === 'thinking'
            ? 2.6
            : this.state.mode === 'speaking'
              ? (1.3 + this.speakingEnvelope * 0.8)
              : 1.0;
        u.angle += dt * u.speed * (1 + this.state.energy * 0.7) * spinBoost * motion;
        u.marker.position.set(Math.cos(u.angle) * u.radius, 0, Math.sin(u.angle) * u.radius);

        // Maintain authentic 3D gyroscopic orbital inclinations across all rings
        const dockP = Math.max(0, Math.min(1.0, (1.0 - this.currentScale) / (1.0 - 0.20)));
        const tiltMultX = idx === 0 ? 0.6 : idx === 1 ? 1.0 : -0.85;
        const tiltMultZ = idx === 0 ? -0.7 : idx === 1 ? -0.85 : 1.0;
        const ringGyroX = gyroX * (1.0 - dockP);
        const ringGyroZ = gyroZ * (1.0 - dockP);
        const thinkTilt = (!reduced && this.state.mode === 'thinking')
          ? Math.sin(this.visualTime * 3.5 + idx * 1.8) * 0.08
          : 0;
        g.rotation.x = u.baseTilt + ringGyroX * tiltMultX + approach * (0.30 + idx * 0.12) + thinkTilt;
        g.rotation.z = u.baseTwist + ringGyroZ * tiltMultZ - approach * 0.24;

        // Dynamic phosphor trailing arc - expands during high cognitive/speech activity
        const trailBoost = this.state.mode === 'thinking' ? 1.6 : this.state.mode === 'speaking' ? (1.0 + this.speakingEnvelope * 0.4) : 1.0;
        const trailSpan = (idx === 0 ? 0.44 : idx === 1 ? 0.72 : 0.56) * trailBoost;
        const pos = u.trailPositions;
        for (let k = 0; k < 24; k++) {
          const a = u.angle - (k / 23) * trailSpan;
          pos[k * 3 + 0] = Math.cos(a) * u.radius;
          pos[k * 3 + 1] = 0;
          pos[k * 3 + 2] = Math.sin(a) * u.radius;
        }
        u.trail.geometry.attributes.position.needsUpdate = true;

        const ringReveal = this.coldBoot.active ? bootEase : effectiveReveal;
        const lockGlint = this.coldBoot.active && idx === this.orbitGroups.length - 1
          ? 0.20 * Math.sin(Math.PI * THREE.MathUtils.smoothstep(bootProgress, 0.73, 1))
          : 0;
        for (const item of u.faders) {
          item.material.opacity = item.baseOpacity * (1 + this.state.energy * 0.28) * ringReveal;
          if ('color' in item.material) {
            const targetCol = (this.state.mode === 'ready' || this.state.mode === 'dormant')
              ? (item.baseColor || new THREE.Color(0x84909e))
              : this.displayAccent;
            ((item.material as any).color as THREE.Color).lerp(targetCol, 0.08);
          }
        }
        u.bead.material.opacity = Math.min(1.0, (0.62 + this.state.energy * 0.16) * ringReveal);
        u.bead.material.color.copy(this.displayAccent).lerp(new THREE.Color(0xffffff), 0.30);
        u.markerHalo.material.opacity = Math.min(1.0, 0.28 * ringReveal + lockGlint);
        u.markerHalo.material.color.copy(this.displayAccent);
        (u.trail.material as THREE.LineBasicMaterial).opacity = Math.min(1.0, 0.25 * ringReveal);
        g.visible = ringReveal > 0.001;
      });

      // Ambient dust drift with sinusoidal micro-curvature and celestial star twinkle
      for (const layer of this.dustLayers) {
        const { cfg, xyz, vel, phase, geo, group, material } = layer;

        // Update star twinkle uniforms
        material.uniforms.uTime.value = this.visualTime;
        material.uniforms.uSleep.value = this.state.sleep;

        if (motion) {
          const isThinking = this.state.mode === 'thinking';
          for (let i = 0; i < cfg.count; i++) {
            const k = i * 3;
            const a = i * 2;
            const inwardPullX = isThinking ? -Math.sign(xyz[k]) * 0.035 : 0;
            const inwardPullY = isThinking ? -Math.sign(xyz[k + 1]) * 0.025 : 0;
            xyz[k] += (vel[a] + inwardPullX + Math.sin(this.elapsed * 0.09 + phase[i]) * 0.003) * dt;
            xyz[k + 1] += (vel[a + 1] + inwardPullY + Math.cos(this.elapsed * 0.07 + phase[i]) * 0.002) * dt;

            if (xyz[k] > 15.2) xyz[k] = -15.2;
            if (xyz[k] < -15.2) xyz[k] = 15.2;
            if (xyz[k + 1] > 9.8) xyz[k + 1] = -9.8;
            if (xyz[k + 1] < -9.8) xyz[k + 1] = 9.8;
          }
          geo.attributes.position.needsUpdate = true;
        }
        group.position.x = -this.mouse.x * cfg.parallax * motion;
        group.position.y = this.mouse.y * cfg.parallax * 0.6 * motion;
      }

      // Update Celestial Dormant Events (Falling Stars & Wireframe Satellite)
      this.updateCelestialEvents(dt, motion);

      // Parallax camera lerp
      this.mouse.x += (this.mouse.tx - this.mouse.x) * (1 - Math.exp(-dt * 2.5));
      this.mouse.y += (this.mouse.ty - this.mouse.y) * (1 - Math.exp(-dt * 2.5));
      // Zero camera parallax when corner-docked so the sphere stays anchored inside the aperture ring
      const parallaxMotion = this.isCornerDocked ? 0 : motion;
      this.camera.position.x = this.mouse.x * 0.17 * parallaxMotion;
      this.camera.position.y = -this.mouse.y * 0.09 * parallaxMotion;
      this.camera.lookAt(0, 0.27, 0);

      const blend = 1 - Math.exp(-dt * 5.5);
      this.currentOffsetX += (this.targetOffsetX - this.currentOffsetX) * blend;
      this.currentOffsetY += (this.targetOffsetY - this.currentOffsetY) * blend;
      this.currentScale += (this.targetScale - this.currentScale) * blend;
      this.rootPivot.position.set(this.currentOffsetX, this.currentOffsetY, 0);
      
      // Face the camera while docking, blending from the home orientation.
      this.rootPivot.quaternion.identity();
      if (dockProgress > 0.01) {
        const facing = new THREE.Matrix4().lookAt(this.camera.position, this.rootPivot.position, this.rootPivot.up);
        const targetQuat = new THREE.Quaternion().setFromRotationMatrix(facing);
        this.rootPivot.quaternion.slerp(targetQuat, dockProgress);
      }

      // Keep the globe spherical as it shrinks into the map dock.
      const camDist = this.camera.position.distanceTo(this.rootPivot.position);
      this.root.scale.setScalar(this.currentScale * 10 / camDist);

      // Dynamically scale point sizes so dots retain identical visual proportion & ethereal spacing
      if (this.orbMaterial) {
        this.orbMaterial.size = 0.05 * this.currentScale;
      }
      if (this.coreSatellites?.material) {
        this.coreSatellites.material.size = 0.04 * this.currentScale;
      }
      if (this.shellNodes?.material?.uniforms?.uScale) {
        const h = (typeof window !== 'undefined' ? window.innerHeight : 1080);
        const baseScaleVal = (h * 0.5) / Math.tan(THREE.MathUtils.degToRad(20.0));
        this.shellNodes.material.uniforms.uScale.value = baseScaleVal * this.currentScale;
      }

      if (this.listeningRing.visible || this.transcriptionRing.visible || this.processingRing.visible || this.speakingRing.visible) {
        this.root.getWorldQuaternion(this.voiceRings.quaternion);
        this.voiceRings.quaternion.invert().multiply(this.camera.quaternion);
      }
      this.renderer.render(this.scene, this.camera);
    };

    this.animId = requestAnimationFrame(frame);
  }

  private updateCelestialEvents(dt: number, motion: number): void {
    const isDormant = this.state.sleep > 0.05;

    // 1. Falling Stars (Shooting Meteors with Tapering Phosphor Trail)
    if (isDormant && motion) {
      if (!this.meteorState.active) {
        this.meteorState.timer -= dt;
        if (this.meteorState.timer <= 0) {
          this.meteorState.active = true;
          this.meteorState.progress = 0;
          this.meteorState.duration = 0.65 + Math.random() * 0.35;
          this.meteorState.length = 2.2 + Math.random() * 1.4;

          // Start at randomized altitude in upper celestial periphery
          const fromLeft = Math.random() < 0.5;
          this.meteorState.x = fromLeft ? -13 - Math.random() * 4 : 9 + Math.random() * 5;
          this.meteorState.y = 5.2 + Math.random() * 3.8;
          this.meteorState.z = -8.5 - Math.random() * 4.0;

          // Angled downward shooting vector (~30° to 45°)
          const angle = fromLeft ? -0.42 - Math.random() * 0.35 : -2.65 - Math.random() * 0.35;
          const spd = 24.0 + Math.random() * 8.0;
          this.meteorState.vx = Math.cos(angle) * spd;
          this.meteorState.vy = Math.sin(angle) * spd * 0.72;
          this.meteorState.vz = (Math.random() - 0.5) * 1.8;
          this.meteorLine.visible = true;
        }
      } else {
        this.meteorState.progress += dt;
        const t = this.meteorState.progress / this.meteorState.duration;
        if (t >= 1.0) {
          this.meteorState.active = false;
          this.meteorLine.visible = false;
          this.meteorState.timer = 15.0 + Math.random() * 22.0; // Next meteor in 15-37s
        } else {
          // Advance head coordinates
          this.meteorState.x += this.meteorState.vx * dt;
          this.meteorState.y += this.meteorState.vy * dt;
          this.meteorState.z += this.meteorState.vz * dt;

          const dirLen =
            Math.sqrt(
              this.meteorState.vx * this.meteorState.vx +
                this.meteorState.vy * this.meteorState.vy +
                this.meteorState.vz * this.meteorState.vz
            ) || 1;
          const dx = this.meteorState.vx / dirLen;
          const dy = this.meteorState.vy / dirLen;
          const dz = this.meteorState.vz / dirLen;

          // Parabolic flight brightness curve
          const flightAlpha = Math.sin(t * Math.PI) * this.state.sleep;
          this.meteorLine.material.opacity = flightAlpha * 0.95;

          const pos = this.meteorPositions;
          for (let k = 0; k < 16; k++) {
            const frac = (k / 15.0) * this.meteorState.length;
            pos[k * 3 + 0] = this.meteorState.x - dx * frac;
            pos[k * 3 + 1] = this.meteorState.y - dy * frac;
            pos[k * 3 + 2] = this.meteorState.z - dz * frac;
          }
          this.meteorLine.geometry.attributes.position.needsUpdate = true;
        }
      }
    } else {
      this.meteorLine.visible = false;
    }

    // 2. 3D Wireframe Cubesat Satellite Probe Transit
    if (isDormant && motion) {
      if (!this.satelliteState.active) {
        this.satelliteState.timer -= dt;
        if (this.satelliteState.timer <= 0) {
          this.satelliteState.active = true;
          const fromLeft = Math.random() < 0.6;
          this.satelliteState.x = fromLeft ? -19 : 19;
          this.satelliteState.y = 3.6 + Math.random() * 3.2;
          this.satelliteState.z = -7.5 - Math.random() * 3.5;
          const spd = 0.82 + Math.random() * 0.40;
          this.satelliteState.vx = fromLeft ? spd : -spd;
          this.satelliteState.vy = -0.10 - Math.random() * 0.12;
          this.satelliteState.rotSpeedX = 0.012 + Math.random() * 0.015;
          this.satelliteState.rotSpeedY = 0.018 + Math.random() * 0.016;
          this.satelliteState.rotSpeedZ = 0.008 + Math.random() * 0.010;
          this.satelliteGroup.visible = true;
        }
      } else {
        this.satelliteState.x += this.satelliteState.vx * dt;
        this.satelliteState.y += this.satelliteState.vy * dt;
        this.satelliteGroup.position.set(this.satelliteState.x, this.satelliteState.y, this.satelliteState.z);
        this.satelliteGroup.rotation.x += this.satelliteState.rotSpeedX;
        this.satelliteGroup.rotation.y += this.satelliteState.rotSpeedY;
        this.satelliteGroup.rotation.z += this.satelliteState.rotSpeedZ;

        // Navigational beacon blink (1 Hz double-pulse)
        const beaconWave = Math.sin(this.elapsed * 3.14);
        const beaconFlash = Math.pow(Math.max(0.0, beaconWave), 8.0);
        this.satelliteBeacon.material.opacity = (0.2 + beaconFlash * 0.8) * this.state.sleep;

        // Scale wireframe opacity with sleep state
        for (const item of this.satelliteFaders) {
          item.material.opacity = item.baseOpacity * this.state.sleep;
        }

        // Check screen boundary departure
        if (Math.abs(this.satelliteState.x) > 21) {
          this.satelliteState.active = false;
          this.satelliteGroup.visible = false;
          this.satelliteState.timer = 12.0 + Math.random() * 18.0; // Next transit in 12-30s
        }
      }
    } else {
      this.satelliteGroup.visible = false;
    }
  }

  public stop(): void {
    this.isRunning = false;
    this.listeners.abort();
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = 0;
    }
    if (this.renderer) {
      try {
        const gl = this.renderer.getContext();
        if (gl) {
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        }
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        this.scene.traverse(object => {
          const { geometry, material } = object as THREE.Mesh;
          if (geometry) geometries.add(geometry);
          if (Array.isArray(material)) material.forEach(item => materials.add(item));
          else if (material) materials.add(material);
        });
        geometries.forEach(geometry => geometry.dispose());
        materials.forEach(material => material.dispose());
        this.dotTexture.dispose();
        this.renderer.dispose();
      } catch {
        // Ignore dispose errors on unmount
      }
    }
  }
}
