import { readPlaybackEnergy } from '../utils/voice';
/**
 * ORACLE — Three.js WebGL Presence & Dormant Scene Engine
 * Exact 1:1 conversion of ORACLE_Dormant_v4.html
 */

import * as THREE from 'three';
import { OracleMode, OracleState, ENERGY_LEVELS } from '../types';

interface OrbitFader {
  material: THREE.Material;
  baseOpacity: number;
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
  private root!: THREE.Group;
  private speakingEnvelope = 0;
  private speakingFade = 0;

  private orb!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private orbMaterial!: THREE.PointsMaterial;
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
  private shell!: THREE.Mesh<THREE.IcosahedronGeometry, THREE.ShaderMaterial>;
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
  private isBooting: boolean = false;
  private isAwakening: boolean = false;
  private awakenProgress: number = 0;
  private bootTime: number = 0;
  private lastTime: number = 0;
  private lastRendered: number = 0;
  private elapsed: number = 0;

  private mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  private reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');

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
    // 1. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'low-power'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x0c0e11, 1);

    // 2. Scene & Fog
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0c0e11, 0.042);

    // 3. Camera
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0, 10);

    // 4. Root anchor
    this.root = new THREE.Group();
    this.root.position.y = 0.48;
    this.scene.add(this.root);

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
    const dotTexture = new THREE.CanvasTexture(dotCanvas);
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
      const shade = 0.32 + 0.72 * Math.pow(normZ, 1.25);
      colors[i * 3 + 0] = 0.90 * shade;
      colors[i * 3 + 1] = 0.93 * shade;
      colors[i * 3 + 2] = 0.98 * shade;
    }

    const orbGeometry = new THREE.BufferGeometry();
    orbGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    orbGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.orbMaterial = new THREE.PointsMaterial({
      size: 0.05,
      map: dotTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: 0.05
    });

    this.orb = new THREE.Points(orbGeometry, this.orbMaterial);
    this.root.add(this.orb);

    // 6.5. Direction 1: Multi-Layered Volumetric Quantum Core (Translucent Forcefield Shell + Quantum Nucleus + Gyroscopic Gimbals)
    this.innerCore = new THREE.Group();

    // A. Outer Translucent Singularity Forcefield Shell (Volumetric Glass & 3D Plasma Harmonics)
    this.singularityMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
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
          float alpha = clamp(baseAlpha * (0.85 + uFocus * 0.35) * uReveal, 0.0, 1.0);

          // Ethereal Luxury Palette:
          // Edge silhouette: Icy Titanium / Electric Silver (#CFE2F7)
          // Mid rim: Deep Orbital Sapphire (#355C8A)
          // Interior mist: Translucent Cyan-Ice (#7AA7D9)
          vec3 rimColor = vec3(0.82, 0.90, 0.98);
          vec3 midColor = vec3(0.20, 0.35, 0.55);
          vec3 interiorColor = vec3(0.45, 0.62, 0.82);

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
          vec3 coreCyan = vec3(0.45, 0.70, 0.95);
          vec3 col = mix(coreCyan, sparkWhite, pow(ndotv, 5.0));

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

        uniform float uTime;
        uniform float uReveal;
        uniform float uFocus;
        uniform float uEnergy;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // Steady, delicate radial micro-filaments without pulsing waves
          float fade = 1.0 - aProgress;
          vAlpha = uReveal * fade * (0.24 + uFocus * 0.28);

          // Ethereal cyan-silver glow
          vColor = mix(vec3(0.55, 0.72, 0.90), vec3(0.92, 0.96, 1.0), fade * 0.5);
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
      this.coreRingFaders.push({ material: mat, baseOpacity: opacity });
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
    this.coreRingFaders.push({ material: coreTickMat, baseOpacity: 0.30 });
    this.coreRingGroup.add(new THREE.LineSegments(coreTickGeo, coreTickMat));

    for (let m = 0; m < 2; m++) {
      const a = m * Math.PI;
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xe8ebef, transparent: true, opacity: 0.65, depthWrite: false })
      );
      bead.position.set(Math.cos(a) * coreRingRadius, 0, Math.sin(a) * coreRingRadius);
      this.coreRingGroup.add(bead);
      this.coreRingFaders.push({ material: bead.material, baseOpacity: 0.65 });
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
      this.coreRingFaders.push({ material: bead.material, baseOpacity: 0.60 });
    }
    this.meridianGimbal.rotation.y = 1.1;
    this.meridianGimbal.rotation.z = 0.35;
    this.coreRingGroup.add(this.meridianGimbal);

    // 3. Axial Counter-Gimbal (Third orthogonal plane for full 3D spherical cage)
    this.axialGimbal = new THREE.Group();
    const axialRadius = 0.23;
    this.axialGimbal.add(ringCircle(axialRadius, 0.16));
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
    const circleLine = (radius: number, opacity: number, start = 0, end = Math.PI * 2, segments = 320) => {
      const coords: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const a = start + (end - start) * i / segments;
        coords.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
      return new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xcfd8e4, transparent: true, opacity, depthWrite: false })
      );
    };

    // 3 Gyroscopic Rings: Equatorial micro-ring + Inner main + Outer main
    const orbitConfigs = [
      { radius: 2.38, opacity: 0.11, tilt: 0.08, twist: -0.06, speed: -0.024 }, // Counter-rotating micro-gimbal
      { radius: 2.75, opacity: 0.14, tilt: 0.35, twist: -0.17, speed: 0.055 },   // Inner main
      { radius: 3.33, opacity: 0.09, tilt: -0.52, twist: 0.32, speed: -0.038 }  // Outer main
    ];

    orbitConfigs.forEach(({ radius, opacity, tilt, twist, speed }, idx) => {
      const group = new THREE.Group();
      const faders: OrbitFader[] = [];

      const track = (obj: THREE.Line | THREE.LineSegments, baseOpacity: number) => {
        group.add(obj);
        faders.push({ material: obj.material as THREE.Material, baseOpacity });
        return obj;
      };

      track(circleLine(radius, opacity), opacity);
      track(circleLine(radius + (idx === 0 ? 0.038 : idx === 1 ? 0.047 : 0.06), opacity * 0.31), opacity * 0.31);

      // Incomplete engraved segments
      for (let k = 0; k < 3; k++) {
        const start = k * 2.15 + idx * 0.65;
        const end = start + (0.27 + (k % 2) * 0.14);
        track(circleLine(radius + (idx === 0 ? 0.038 : 0.05), opacity * 0.85, start, end, 28), opacity * 0.85);
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
        new THREE.LineBasicMaterial({ color: 0xcfd8e4, transparent: true, opacity: opacity * 0.52, depthWrite: false })
      );
      track(ticks, opacity * 0.52);

      // Marker Bead & Halo
      const marker = new THREE.Group();
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(idx === 0 ? 0.025 : idx === 1 ? 0.034 : 0.029, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xe8ebef, transparent: true, opacity: 0.75, depthWrite: false })
      );
      marker.add(bead);

      const markerHalo = new THREE.Mesh(
        new THREE.RingGeometry(0.050, 0.062, 28),
        new THREE.MeshBasicMaterial({ color: 0xaab8c9, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false })
      );
      markerHalo.rotation.x = Math.PI / 2;
      marker.add(markerHalo);
      group.add(marker);

      // Phosphor trailing arc (24 line segments extending backward ~25°)
      const TRAIL_SEGS = 24;
      const trailPositions = new Float32Array(TRAIL_SEGS * 3);
      const trailColors = new Float32Array(TRAIL_SEGS * 3);

      for (let k = 0; k < TRAIL_SEGS; k++) {
        const t = 1.0 - k / (TRAIL_SEGS - 1); // 1.0 at bead head, 0.0 at tail
        const alpha = Math.pow(t, 1.85); // Non-linear phosphor fade
        trailColors[k * 3 + 0] = 0.88 * alpha;
        trailColors[k * 3 + 1] = 0.92 * alpha;
        trailColors[k * 3 + 2] = 1.00 * alpha;
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

    // 8. Polygon Icosahedron Shell with Organic Random Synaptic Node Flashes
    const icosaGeo = new THREE.IcosahedronGeometry(2.25, 2);

    this.shellMaterial = new THREE.ShaderMaterial({
      wireframe: true,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uReveal: { value: 0.0 },
        uBaseOpacity: { value: 0.034 }
      },
      vertexShader: `
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uReveal;
        uniform float uBaseOpacity;

        void main() {
          if (uReveal < 0.001) discard;
          // Ultra-fine architectural hairline cage
          float alpha = uBaseOpacity * uReveal;
          gl_FragColor = vec4(vec3(0.78, 0.84, 0.92), alpha);
        }
      `
    });

    this.shell = new THREE.Mesh(icosaGeo, this.shellMaterial);
    this.root.add(this.shell);

    // Extract unique vertices for Holographic Vertex Nodes (42 nodes) with Random Firing Parameters
    const posAttr = icosaGeo.attributes.position;
    const uniqueVertices: number[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < posAttr.count; i++) {
      const x = Number(posAttr.getX(i).toFixed(4));
      const y = Number(posAttr.getY(i).toFixed(4));
      const z = Number(posAttr.getZ(i).toFixed(4));
      const key = `${x},${y},${z}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueVertices.push(x, y, z);
      }
    }

    const nodeCount = uniqueVertices.length / 3;
    const speed1 = new Float32Array(nodeCount);
    const speed2 = new Float32Array(nodeCount);
    const phase1 = new Float32Array(nodeCount);
    const phase2 = new Float32Array(nodeCount);
    const maxIntensity = new Float32Array(nodeCount);

    for (let i = 0; i < nodeCount; i++) {
      // Incommensurate dual frequencies (golden ratio harmonic separation)
      // Produces natural aperiodic neural firing without repeating patterns
      const baseSpd = 0.22 + Math.random() * 0.26;
      speed1[i] = baseSpd;
      speed2[i] = baseSpd * (1.61803 + Math.random() * 0.15); // Irrational golden ratio
      phase1[i] = Math.random() * Math.PI * 2.0;
      phase2[i] = Math.random() * Math.PI * 2.0;
      maxIntensity[i] = 0.70 + Math.random() * 0.28;
    }

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.Float32BufferAttribute(uniqueVertices, 3));
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
        uTexture: { value: dotTexture }
      },
      vertexShader: `
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

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // Dual incommensurate harmonic waves produce natural, aperiodic interference peaks
          float wave1 = sin(uTime * aSpeed1 + aPhase1);
          float wave2 = sin(uTime * aSpeed2 + aPhase2);
          float composite = wave1 * 0.54 + wave2 * 0.46; // Range: -1.0 to 1.0

          // High activation threshold: node only flares when both waves constructively peak
          // Active only ~5-8% of the time, so at any moment only 1 to 3 nodes flare across the entire cage!
          float activation = smoothstep(0.70, 0.96, composite);
          float flare = pow(activation, 2.2) * aMaxIntensity;

          // Resting state (very subtle, clean ambient baseline ~0.12)
          float restingAlpha = 0.12;
          float firingAlpha = 0.92;
          vNodeAlpha = uReveal * mix(restingAlpha, firingAlpha, flare);

          // Color: cool muted slate-cyan (#7E95AD) blooming into brilliant diamond-white (#FFFFFF)
          vec3 restingColor = vec3(0.52, 0.62, 0.74);
          vec3 firingColor = vec3(1.0, 1.0, 1.0);
          vNodeColor = mix(restingColor, firingColor, flare);

          // Gentle smooth bloom (0.036 -> 0.068) only during the rare flare
          float sizeFactor = mix(0.036, 0.068, flare);
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

    const makeDust = (cfg: DustConfig): DustLayer => {
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
          uTexture: { value: dotTexture }
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

          void main() {
            vec2 coord = gl_PointCoord;
            vec4 tex = texture2D(uTexture, coord);
            if (tex.a < 0.04) discard;

            // Subtle celestial star tint: #DFE5EC
            vec3 starColor = vec3(0.87, 0.90, 0.93);
            gl_FragColor = vec4(starColor, tex.a * vAlpha);
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

    dustDefinitions.forEach((d) => this.dustLayers.push(makeDust(d)));

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
      this.mouse.tx = (event.clientX / window.innerWidth - 0.5) * 2;
      this.mouse.ty = (event.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    window.addEventListener('pointerleave', () => {
      this.mouse.tx = 0;
      this.mouse.ty = 0;
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  public resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.position.z = width / height < 0.7 ? 15 : width / height < 1.1 ? 12.5 : 10;
    this.camera.updateProjectionMatrix();

    const scaleVal = (height * 0.5) / Math.tan(THREE.MathUtils.degToRad(20.0));
    for (const layer of this.dustLayers) {
      if (layer.material && layer.material.uniforms.uScale) {
        layer.material.uniforms.uScale.value = scaleVal;
      }
    }
    if (this.shellNodes?.material?.uniforms?.uScale) {
      this.shellNodes.material.uniforms.uScale.value = scaleVal;
    }
  }

  public setMode(next: OracleMode): void {
    const prev = this.state.mode;
    this.state.mode = next;
    this.state.targetSleep = next === 'dormant' ? 1 : 0;
    this.state.targetEnergy = ENERGY_LEVELS[next];
    if (next === 'initializing') {
      this.isBooting = true;
      this.isAwakening = false;
      this.awakenProgress = 0;
      this.bootTime = 0;
      this.root.visible = false;
      this.satelliteGroup.visible = false;
      this.meteorLine.visible = false;
      this.orb.visible = false;
      this.shell.visible = false;
      this.shellNodes.visible = false;
      this.innerCore.visible = false;
      this.coreRingGroup.visible = false;
      this.coreSatellites.visible = false;
      this.orbitGroups.forEach((g) => (g.visible = false));
    } else {
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
      const minInterval = reduced ? 1000 / 10 : this.state.sleep > 0.95 ? 1000 / 30 : 1000 / 60;
      if (now - this.lastRendered < minInterval) return;

      const dt = Math.min((now - this.lastTime) / 1000, 0.08);
      this.lastTime = now;
      this.lastRendered = now;
      this.elapsed += dt;

      // Exponential smoothing with luxurious organic rate (dt * 1.6 for gentle ease)
      const sleepSpeed = this.state.targetSleep === 0 ? 1.55 : 1.75;
      const interpSleep = 1 - Math.exp(-dt * sleepSpeed);
      const interpEnergy = 1 - Math.exp(-dt * 2.0);
      this.state.energy += (this.state.targetEnergy - this.state.energy) * interpEnergy;
      this.state.sleep += (this.state.targetSleep - this.state.sleep) * interpSleep;

      // Hermite S-curve interpolation for continuous, velvety smooth visual transitions:
      const s = this.state.sleep;
      const smoothIdle = s * s * (3.0 - 2.0 * s); // smoothstep curve
      const innerScale = 1.0 - smoothIdle * 0.5;

      const motion = reduced ? 0 : 1;
      this.root.rotation.y += dt * (0.014 + this.state.energy * 0.045) * motion;
      this.root.rotation.x = 0.17;
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

      const isChecking = this.isBooting || this.state.mode === 'initializing';
      this.root.visible = !isChecking;

      // First-Boot Cinematic Initialization Logic (Globe completely hidden so focus is purely on the card)
      if (isChecking) {
        this.bootTime += dt;
        this.satelliteGroup.visible = false;
        this.meteorLine.visible = false;
        this.orb.visible = false;
        this.shell.visible = false;
        this.shellNodes.visible = false;
        this.innerCore.visible = false;
        this.coreRingGroup.visible = false;
        this.coreSatellites.visible = false;
        this.orbitGroups.forEach((g) => {
          g.visible = false;
        });
      } else {
        this.orb.visible = true;
        const orbScaleMult = this.isAwakening ? (0.45 + 0.55 * easeAwaken) : 1.0;
        this.orb.scale.setScalar(innerScale * orbScaleMult);
        this.orbMaterial.opacity = (0.60 + this.state.energy * 0.22 - smoothIdle * 0.09) * (this.isAwakening ? easeAwaken : 1.0);
      }

      const speaking = this.state.mode === 'speaking';
      const audioEnergy = speaking && !reduced ? readPlaybackEnergy() : 0;
      this.speakingEnvelope += (audioEnergy - this.speakingEnvelope) * (1 - Math.exp(-dt * (audioEnergy > this.speakingEnvelope ? 15 : 6)));
      this.speakingFade += ((speaking ? 1 : 0) - this.speakingFade) * (1 - Math.exp(-dt * 7));
      const voiceAccent = reduced ? (speaking ? .18 : 0) : this.speakingEnvelope;
      const voiceBreath = reduced ? 1 : 1 + voiceAccent * .025;
      if (!isChecking) {
        this.orb.scale.multiplyScalar(voiceBreath);
        this.orbMaterial.opacity = Math.min(1, this.orbMaterial.opacity + voiceAccent * .22);
      }

      // Cursor focus detection (distance to center of orb)
      const mouseDist = Math.sqrt(this.mouse.x * this.mouse.x + Math.pow(this.mouse.y + 0.12, 2));
      const focus = Math.max(0.0, Math.min(1.0, 1.0 - mouseDist * 1.5)) * motion;

      // Central Core: visible ONLY when awake / ready (completely hidden in dormant mode)
      this.innerCore.visible = reveal > 0.001;
      const coreScale = this.isAwakening ? (0.10 + 0.90 * easeAwaken) : 1.0;
      this.innerCore.scale.setScalar(coreScale * (reduced ? 1 : 1 + voiceAccent * .05));
      this.singularityMaterial.uniforms.uTime.value = this.elapsed;
      this.singularityMaterial.uniforms.uReveal.value = reveal;
      this.singularityMaterial.uniforms.uFocus.value = focus;
      this.singularityMaterial.uniforms.uEnergy.value = this.state.energy + voiceAccent * .55;

      this.innerNucleusMaterial.uniforms.uTime.value = this.elapsed;
      this.innerNucleusMaterial.uniforms.uReveal.value = reveal;
      this.innerNucleusMaterial.uniforms.uFocus.value = focus;
      this.innerNucleusMaterial.uniforms.uEnergy.value = this.state.energy + voiceAccent * .55;

      this.filamentMaterial.uniforms.uTime.value = this.elapsed;
      this.filamentMaterial.uniforms.uReveal.value = reveal;
      this.filamentMaterial.uniforms.uFocus.value = focus;
      this.filamentMaterial.uniforms.uEnergy.value = this.state.energy + voiceAccent * .55;

      // 3D Dimensional Precession & Perspective Tilt
      this.innerCore.rotation.y += dt * 0.04 * motion;
      this.innerCore.rotation.x = Math.sin(this.elapsed * 0.35) * 0.06 + this.mouse.y * 0.12 * motion;
      this.innerCore.rotation.z = Math.cos(this.elapsed * 0.28) * 0.05 - this.mouse.x * 0.12 * motion;

      // Internal Nucleus counter-rotates for motion parallax
      this.innerNucleusMesh.rotation.y -= dt * 0.14 * motion;
      this.innerNucleusMesh.rotation.x += dt * 0.08 * motion;

      // Calibration micro-ring & multi-axial gyroscopic gimbals dynamics
      for (const item of this.coreRingFaders) {
        item.material.opacity = item.baseOpacity * reveal * (1 + voiceAccent * .45);
      }
      this.coreRingGroup.visible = reveal > 0.001;
      const ringScale = this.isAwakening ? (0.15 + 0.85 * easeAwaken) : 1.0;
      this.coreRingGroup.scale.setScalar(ringScale);
      this.coreRingGroup.rotation.z += dt * 0.035 * motion;
      this.meridianGimbal.rotation.x += dt * 0.055 * motion;
      this.axialGimbal.rotation.y -= dt * 0.045 * motion;

      // 3D Quantum micro-nodes swarm
      this.coreSatellites.visible = reveal > 0.001;
      this.coreSatellites.rotation.y += dt * 0.10 * motion;
      this.coreSatellites.rotation.x += dt * 0.05 * motion;

      // Update Polygon Shell & Random Synaptic Node Flashes
      const shellProg = this.isAwakening ? Math.max(0.001, Math.min(1.0, (awakenP - 0.15) / 0.75)) : 1.0;
      const shellEase = shellProg * shellProg * (3.0 - 2.0 * shellProg);
      const shellScale = this.isAwakening ? (0.30 + 0.70 * shellEase) : 1.0;
      this.shell.scale.setScalar(shellScale * voiceBreath);
      this.shellNodes.scale.setScalar(shellScale);
      this.shellMaterial.uniforms.uReveal.value = reveal;
      this.shellMaterial.uniforms.uBaseOpacity.value = 0.034 + this.state.energy * 0.022 + voiceAccent * .012;
      this.shell.visible = reveal > 0.001;

      this.shellNodes.material.uniforms.uTime.value = this.elapsed;
      this.shellNodes.material.uniforms.uReveal.value = reveal;
      this.shellNodes.visible = reveal > 0.001;

      // Magnetic gyroscopic tilt driven by cursor position
      const gyroX = this.mouse.y * 0.16 * motion;
      const gyroZ = -this.mouse.x * 0.16 * motion;

      this.orbitGroups.forEach((g, idx) => {
        const u = g.userData as OrbitUserData;
        const ringDelay = idx * 0.12;
        const ringProg = this.isAwakening ? Math.max(0.001, Math.min(1.0, (awakenP - ringDelay) / 0.65)) : 1.0;
        const ringEase = ringProg * ringProg * (3.0 - 2.0 * ringProg);
        g.scale.setScalar(this.isAwakening ? (0.15 + 0.85 * ringEase) : 1.0);

        // Kinetic spin surge during awaken: spins faster initially then settles smoothly
        const spinBoost = this.isAwakening ? (2.8 - 1.8 * easeAwaken) : 1.0;
        u.angle += dt * u.speed * (1 + this.state.energy * 0.7) * spinBoost * motion;
        u.marker.position.set(Math.cos(u.angle) * u.radius, 0, Math.sin(u.angle) * u.radius);

        // Gyroscopic tilt with individual ring phase leverage
        const tiltMultX = idx === 0 ? 0.6 : idx === 1 ? 1.0 : -0.85;
        const tiltMultZ = idx === 0 ? -0.7 : idx === 1 ? -0.85 : 1.0;
        g.rotation.x = u.baseTilt + gyroX * tiltMultX;
        g.rotation.z = u.baseTwist + gyroZ * tiltMultZ;

        // Dynamic phosphor trailing arc behind bead (24 segments tracing backward)
        const trailSpan = 0.44 + voiceAccent * .22; // ~25° arc
        const pos = u.trailPositions;
        for (let k = 0; k < 24; k++) {
          const a = u.angle - (k / 23) * trailSpan;
          pos[k * 3 + 0] = Math.cos(a) * u.radius;
          pos[k * 3 + 1] = 0;
          pos[k * 3 + 2] = Math.sin(a) * u.radius;
        }
        u.trail.geometry.attributes.position.needsUpdate = true;

        for (const item of u.faders) {
          item.material.opacity = item.baseOpacity * (1 + this.state.energy * 0.28 + voiceAccent * .65) * reveal;
        }
        u.bead.material.opacity = (0.62 + this.state.energy * 0.16) * reveal;
        u.markerHalo.material.opacity = (0.18 + voiceAccent * .25) * reveal;
        (u.trail.material as THREE.LineBasicMaterial).opacity = (.15 + voiceAccent * .5) * reveal;
        g.visible = reveal > 0.001;
      });

      // Ambient dust drift with sinusoidal micro-curvature and celestial star twinkle
      for (const layer of this.dustLayers) {
        const { cfg, xyz, vel, phase, geo, group, material } = layer;

        // Update star twinkle uniforms
        material.uniforms.uTime.value = this.elapsed;
        material.uniforms.uSleep.value = this.state.sleep;

        if (motion) {
          for (let i = 0; i < cfg.count; i++) {
            const k = i * 3;
            const a = i * 2;
            xyz[k] += (vel[a] + Math.sin(this.elapsed * 0.09 + phase[i]) * 0.003) * dt;
            xyz[k + 1] += (vel[a + 1] + Math.cos(this.elapsed * 0.07 + phase[i]) * 0.002) * dt;

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
      this.camera.position.x = this.mouse.x * 0.17 * motion;
      this.camera.position.y = -this.mouse.y * 0.09 * motion;
      this.camera.lookAt(0, 0.27, 0);

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
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = 0;
    }
  }
}
