import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface BallpitProps {
  className?: string;
  followCursor?: boolean;
  count?: number;
  gravity?: number;
  friction?: number;
  wallBounce?: number;
  colors?: number[];
}

interface BallConfig {
  count: number;
  gravity: number;
  friction: number;
  wallBounce: number;
  followCursor: boolean;
  colors: number[];
  ambientColor: number;
  ambientIntensity: number;
  lightIntensity: number;
  materialParams?: Record<string, any>;
  minSize: number;
  maxSize: number;
  size0: number;
  maxVelocity: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  controlSphere0?: boolean;
}

class BallPhysics {
  config: BallConfig;
  positionData: Float32Array;
  velocityData: Float32Array;
  sizeData: Float32Array;
  center: THREE.Vector3;

  constructor(config: BallConfig) {
    this.config = config;
    this.positionData = new Float32Array(3 * config.count).fill(0);
    this.velocityData = new Float32Array(3 * config.count).fill(0);
    this.sizeData = new Float32Array(config.count).fill(1);
    this.center = new THREE.Vector3();
    this.initPositions();
    this.setSizes();
  }

  initPositions() {
    const { positionData, config } = this;
    this.center.toArray(positionData, 0);
    for (let i = 1; i < config.count; i++) {
      const s = 3 * i;
      positionData[s] = THREE.MathUtils.randFloatSpread(2 * config.maxX);
      positionData[s + 1] = THREE.MathUtils.randFloatSpread(2 * config.maxY);
      positionData[s + 2] = THREE.MathUtils.randFloatSpread(2 * config.maxZ);
    }
  }

  setSizes() {
    const { config, sizeData } = this;
    sizeData[0] = config.size0;
    for (let i = 1; i < config.count; i++) {
      sizeData[i] = THREE.MathUtils.randFloat(config.minSize, config.maxSize);
    }
  }

  update(delta: number) {
    const { config, center, positionData, sizeData, velocityData } = this;
    let r = 0;
    const F = new THREE.Vector3();
    const I = new THREE.Vector3();
    const O = new THREE.Vector3();
    const B = new THREE.Vector3();
    const N = new THREE.Vector3();
    const _ = new THREE.Vector3();
    const j = new THREE.Vector3();
    const H = new THREE.Vector3();
    const T = new THREE.Vector3();

    if (config.controlSphere0) {
      r = 1;
      F.fromArray(positionData, 0);
      F.lerp(center, 0.1).toArray(positionData, 0);
      new THREE.Vector3(0, 0, 0).toArray(velocityData, 0);
    }

    for (let idx = r; idx < config.count; idx++) {
      const base = 3 * idx;
      I.fromArray(positionData, base);
      B.fromArray(velocityData, base);
      B.y -= delta * config.gravity * sizeData[idx];
      B.multiplyScalar(config.friction);
      B.clampLength(0, config.maxVelocity);
      I.add(B);
      I.toArray(positionData, base);
      B.toArray(velocityData, base);
    }

    for (let idx = r; idx < config.count; idx++) {
      const base = 3 * idx;
      I.fromArray(positionData, base);
      B.fromArray(velocityData, base);
      const radius = sizeData[idx];

      for (let jdx = idx + 1; jdx < config.count; jdx++) {
        const otherBase = 3 * jdx;
        O.fromArray(positionData, otherBase);
        N.fromArray(velocityData, otherBase);
        const otherRadius = sizeData[jdx];
        _.copy(O).sub(I);
        const dist = _.length();
        const sumRadius = radius + otherRadius;
        if (dist < sumRadius && dist > 0.001) {
          const overlap = sumRadius - dist;
          j.copy(_).normalize().multiplyScalar(0.5 * overlap);
          H.copy(j).multiplyScalar(Math.max(B.length(), 1));
          T.copy(j).multiplyScalar(Math.max(N.length(), 1));
          I.sub(j);
          B.sub(H);
          I.toArray(positionData, base);
          B.toArray(velocityData, base);
          O.add(j);
          N.add(T);
          O.toArray(positionData, otherBase);
          N.toArray(velocityData, otherBase);
        }
      }

      if (config.controlSphere0) {
        _.copy(F).sub(I);
        const dist = _.length();
        const sumRadius0 = radius + sizeData[0];
        if (dist < sumRadius0 && dist > 0.001) {
          const diff = sumRadius0 - dist;
          j.copy(_.normalize()).multiplyScalar(diff);
          H.copy(j).multiplyScalar(Math.max(B.length(), 2));
          I.sub(j);
          B.sub(H);
        }
      }

      if (Math.abs(I.x) + radius > config.maxX) {
        I.x = Math.sign(I.x) * (config.maxX - radius);
        B.x = -B.x * config.wallBounce;
      }
      if (config.gravity === 0) {
        if (Math.abs(I.y) + radius > config.maxY) {
          I.y = Math.sign(I.y) * (config.maxY - radius);
          B.y = -B.y * config.wallBounce;
        }
      } else if (I.y - radius < -config.maxY) {
        I.y = -config.maxY + radius;
        B.y = -B.y * config.wallBounce;
      }
      const maxBoundary = Math.max(config.maxZ, config.maxSize);
      if (Math.abs(I.z) + radius > maxBoundary) {
        I.z = Math.sign(I.z) * (config.maxZ - radius);
        B.z = -B.z * config.wallBounce;
      }

      I.toArray(positionData, base);
      B.toArray(velocityData, base);
    }
  }
}

const DEFAULT_CONFIG: BallConfig = {
  count: 120,
  colors: [0xb08d57, 0x1b2a41, 0xd4c4a8, 0x8b7355, 0xc9b896, 0x6b5b45, 0xe8dcc8],
  ambientColor: 0xffffff,
  ambientIntensity: 0.8,
  lightIntensity: 150,
  materialParams: {
    metalness: 0.4,
    roughness: 0.4,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2
  } as any,
  minSize: 0.4,
  maxSize: 0.9,
  size0: 1.2,
  gravity: 0.5,
  friction: 0.998,
  wallBounce: 0.95,
  maxVelocity: 0.15,
  maxX: 5,
  maxY: 5,
  maxZ: 2,
  controlSphere0: false,
  followCursor: true
};

function createBallpit(canvas: HTMLCanvasElement, options: Partial<BallConfig> = {}) {
  const hasWebGL = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  if (!hasWebGL) {
    return { dispose() {} };
  }

  const config = { ...DEFAULT_CONFIG, ...options };

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 18);
  camera.lookAt(0, 0, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment() as any, 0.04).texture;

  const ambientLight = new THREE.AmbientLight(config.ambientColor, config.ambientIntensity);
  scene.add(ambientLight);

  const light = new THREE.PointLight(config.colors[0], config.lightIntensity);
  scene.add(light);

  const geometry = new THREE.SphereGeometry(1, 32, 32);
  const material = new THREE.MeshPhysicalMaterial({
    envMap,
    metalness: 0.4,
    roughness: 0.4,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2
  });
  material.envMapRotation = new THREE.Euler(-Math.PI / 2, 0, 0);

  const instancedMesh = new THREE.InstancedMesh(geometry, material, config.count);
  scene.add(instancedMesh);

  const physics = new BallPhysics(config);

  // Color generation
  const colorObjs = config.colors.map(c => new THREE.Color(c));
  function getColorAt(ratio: number): THREE.Color {
    const scaled = Math.max(0, Math.min(1, ratio)) * (colorObjs.length - 1);
    const idx = Math.floor(scaled);
    if (idx >= colorObjs.length - 1) return colorObjs[colorObjs.length - 1];
    const alpha = scaled - idx;
    return colorObjs[idx].clone().lerp(colorObjs[idx + 1], alpha);
  }

  for (let i = 0; i < config.count; i++) {
    instancedMesh.setColorAt(i, getColorAt(i / config.count));
  }
  if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

  // Cursor tracking
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const intersectPoint = new THREE.Vector3();
  const mouse = new THREE.Vector2();
  function onPointerMove(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    camera.getWorldDirection(plane.normal);
    raycaster.ray.intersectPlane(plane, intersectPoint);
    physics.center.copy(intersectPoint);
    config.controlSphere0 = true;
  }

  function onPointerLeave() {
    config.controlSphere0 = false;
  }

  function onPointerEnter() {
    // Track hover state if needed
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointerenter', onPointerEnter);

  // Resize
  function resize() {
    const parent = canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const fovRad = (camera.fov * Math.PI) / 180;
    const wHeight = 2 * Math.tan(fovRad / 2) * camera.position.length();
    const wWidth = wHeight * camera.aspect;
    physics.config.maxX = wWidth / 2;
    physics.config.maxY = wHeight / 2;
  }

  resize();

  const resizeObserver = new ResizeObserver(resize);
  if (canvas.parentElement) {
    resizeObserver.observe(canvas.parentElement);
  }

  // Animation
  let animId: number;
  let lastTime = performance.now();
  let isVisible = true;

  function animate(time: number) {
    animId = requestAnimationFrame(animate);
    if (!isVisible) return;
    const delta = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    physics.update(delta);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < config.count; i++) {
      dummy.position.fromArray(physics.positionData, 3 * i);
      if (i === 0 && !config.followCursor) {
        dummy.scale.setScalar(0);
      } else {
        dummy.scale.setScalar(physics.sizeData[i]);
      }
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
      if (i === 0) light.position.copy(dummy.position);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  }

  animId = requestAnimationFrame(animate);

  // Visibility
  const observer = new IntersectionObserver(
    ([entry]) => { isVisible = entry.isIntersecting; },
    { threshold: 0 }
  );
  observer.observe(canvas);

  return {
    dispose() {
      cancelAnimationFrame(animId);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerenter', onPointerEnter);
      resizeObserver.disconnect();
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
}

const Ballpit = ({
  className = '',
  followCursor = true,
  count = 120,
  gravity = 0.5,
  friction = 0.998,
  wallBounce = 0.95,
  ...props
}: BallpitProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<any>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      instanceRef.current = createBallpit(canvas, {
        followCursor,
        count,
        gravity,
        friction,
        wallBounce,
        ...props
      });
    } catch {
      instanceRef.current = null;
    }

    return () => {
      if (instanceRef.current) {
        instanceRef.current.dispose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
};

export default Ballpit;
