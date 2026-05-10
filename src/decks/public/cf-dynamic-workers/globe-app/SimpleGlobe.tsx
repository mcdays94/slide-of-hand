/**
 * SimpleGlobe — a slim, dependency-light globe for the spawn-the-globe-app
 * demo on slide 08.
 *
 * Distilled from cf-holding-screen's `Globe3D` (which itself descends from
 * cf-slides' Globe3D), tuned for a LIGHT warm-cream background:
 *
 *   - Canvas background is the deck's signature warm cream (#FFFBF5)
 *     with a subtle radial gradient that hints at lighting from the
 *     centre.
 *   - Earth sphere is a softly-tinted warm peach so the planet is
 *     unambiguously visible against the cream — no more invisible
 *     cream-on-cream.
 *   - A warm-brown graticule (lat/lng grid) sits on the surface as
 *     visible structure: 15° lat steps, 30° lng steps.
 *   - Brand-orange dots overlay the graticule for the "Cloudflare
 *     network" feel, plus PoP markers with halos and bright
 *     additive arcs.
 *
 * No topojson, no country-shape data, no OrbitControls — keeps the
 * bundle small (~240 KB gzipped including three.js).
 */

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const GLOBE_RADIUS = 1.0;
const ORANGE = new THREE.Color("#FF4801");
// Warm peach for the planet body — visibly different from the cream
// background but staying inside the deck's warm palette.
const EARTH_FILL = new THREE.Color("#f6dcc1");
// Warm brown for the lat/lng graticule. Same hue family as cf-text
// (#521000) so the planet's structure reads as "cartography" rather
// than "decoration".
const GRATICULE = new THREE.Color("#9b5a32");

interface PoP {
  name: string;
  lat: number;
  lng: number;
}

// A handful of evocative locations — enough arcs to feel like Cloudflare's
// network without trying to be a real PoP map.
const POPS: PoP[] = [
  { name: "London", lat: 51.5074, lng: -0.1278 },
  { name: "Lisbon", lat: 38.7223, lng: -9.1393 },
  { name: "New York", lat: 40.7128, lng: -74.006 },
  { name: "São Paulo", lat: -23.5505, lng: -46.6333 },
  { name: "Tokyo", lat: 35.6762, lng: 139.6503 },
  { name: "Sydney", lat: -33.8688, lng: 151.2093 },
  { name: "Singapore", lat: 1.3521, lng: 103.8198 },
  { name: "Mumbai", lat: 19.076, lng: 72.8777 },
  { name: "San Francisco", lat: 37.7749, lng: -122.4194 },
  { name: "Frankfurt", lat: 50.1109, lng: 8.6821 },
  { name: "Cape Town", lat: -33.9249, lng: 18.4241 },
];

const ARCS: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 9], [0, 6], [0, 7],
  [2, 3], [2, 8], [2, 4], [4, 6], [4, 5],
  [6, 7], [7, 5], [9, 1], [9, 0], [10, 1],
];

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function createArcPoints(start: THREE.Vector3, end: THREE.Vector3, n = 48, bulge = 0.07) {
  const a = start.clone().normalize();
  const b = end.clone().normalize();
  const r = start.length();
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().copy(a).lerp(b, t).normalize();
    p.multiplyScalar(r + bulge * Math.sin(t * Math.PI));
    points.push(p);
  }
  return points;
}

/** Lat/lng graticule positions as a Float32Array for line segments. */
function createGraticulePositions(): Float32Array {
  const positions: number[] = [];
  const r = GLOBE_RADIUS * 1.001;
  const segments = 96;

  // Latitude lines (parallels)
  for (let lat = -75; lat <= 75; lat += 15) {
    for (let i = 0; i < segments; i++) {
      const lng1 = (i / segments) * 360 - 180;
      const lng2 = ((i + 1) / segments) * 360 - 180;
      const p1 = latLngToVector3(lat, lng1, r);
      const p2 = latLngToVector3(lat, lng2, r);
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }

  // Longitude lines (meridians)
  for (let lng = -180; lng < 180; lng += 30) {
    for (let i = 0; i < segments; i++) {
      const lat1 = (i / segments) * 180 - 90;
      const lat2 = ((i + 1) / segments) * 180 - 90;
      const p1 = latLngToVector3(lat1, lng, r);
      const p2 = latLngToVector3(lat2, lng, r);
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }

  return new Float32Array(positions);
}

/* ── Sphere wire + dot pattern + graticule ── */
function GlobeSphere() {
  const dotPositions = useMemo(() => {
    const positions: number[] = [];
    const lat = 24;
    const lng = 48;
    for (let i = 0; i <= lat; i++) {
      for (let j = 0; j <= lng; j++) {
        const phi = (i / lat) * Math.PI;
        const theta = (j / lng) * Math.PI * 2;
        const x = GLOBE_RADIUS * Math.sin(phi) * Math.cos(theta);
        const y = GLOBE_RADIUS * Math.cos(phi);
        const z = GLOBE_RADIUS * Math.sin(phi) * Math.sin(theta);
        positions.push(x, y, z);
      }
    }
    return new Float32Array(positions);
  }, []);

  const dotsGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(dotPositions, 3));
    return g;
  }, [dotPositions]);

  const graticuleGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(createGraticulePositions(), 3),
    );
    return g;
  }, []);

  return (
    <>
      {/* Solid Earth — warm peach, visibly distinct from the cream
          background. Slightly inset so graticule + dots read as
          surface markings. */}
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 0.997, 96, 96]} />
        <meshBasicMaterial color={EARTH_FILL} side={THREE.FrontSide} />
      </mesh>

      {/* Soft outer halo — a slightly larger ghost sphere on the back
          face, tinted brand-orange and blended additively. Reads as
          atmosphere on the planet's edge. */}
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS * 1.025, 64, 64]} />
        <meshBasicMaterial
          color={ORANGE}
          transparent
          opacity={0.12}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Graticule lines — warm brown for clear visibility on cream. */}
      <lineSegments geometry={graticuleGeo}>
        <lineBasicMaterial color={GRATICULE} transparent opacity={0.55} />
      </lineSegments>

      {/* Dot grid — brand orange, dense enough to read as a Cloudflare-
          themed map without being noisy. */}
      <points geometry={dotsGeo}>
        <pointsMaterial
          color={ORANGE}
          size={0.012}
          sizeAttenuation
          transparent
          opacity={0.85}
        />
      </points>
    </>
  );
}

/* ── PoP dots ── */
function Pops() {
  const positions = useMemo(() => POPS.map((p) => latLngToVector3(p.lat, p.lng, GLOBE_RADIUS)), []);
  return (
    <>
      {positions.map((p, i) => (
        <group key={i} position={p}>
          {/* Bright dot */}
          <mesh>
            <sphereGeometry args={[0.018, 16, 16]} />
            <meshBasicMaterial color={ORANGE} />
          </mesh>
          {/* Halo */}
          <mesh>
            <sphereGeometry args={[0.034, 12, 12]} />
            <meshBasicMaterial
              color={ORANGE}
              transparent
              opacity={0.18}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

/* ── Arcs ── */
function Arcs() {
  const meshes = useMemo(
    () =>
      ARCS.map(([a, b]) => {
        const start = latLngToVector3(POPS[a].lat, POPS[a].lng, GLOBE_RADIUS);
        const end = latLngToVector3(POPS[b].lat, POPS[b].lng, GLOBE_RADIUS);
        const points = createArcPoints(start, end);
        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeo = new THREE.TubeGeometry(curve, 56, 0.0034, 6, false);
        return tubeGeo;
      }),
    [],
  );

  return (
    <>
      {meshes.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial
            color={ORANGE}
            transparent
            opacity={0.7}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </>
  );
}

/* ── Travelling pulses along arcs ── */
function ArcPulses() {
  const dotsRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const arcs = useMemo(
    () =>
      ARCS.map(([a, b], i) => {
        const start = latLngToVector3(POPS[a].lat, POPS[a].lng, GLOBE_RADIUS);
        const end = latLngToVector3(POPS[b].lat, POPS[b].lng, GLOBE_RADIUS);
        const points = createArcPoints(start, end);
        return { points, phase: (i * 0.13) % 1 };
      }),
    [],
  );

  useFrame((state) => {
    if (!dotsRef.current) return;
    const t = state.clock.elapsedTime * 0.18;
    arcs.forEach((arc, i) => {
      const localT = ((t + arc.phase) % 1.0);
      const idx = Math.floor(localT * (arc.points.length - 1));
      const p = arc.points[idx];
      dummy.position.copy(p);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      dotsRef.current!.setMatrixAt(i, dummy.matrix);
    });
    dotsRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={dotsRef} args={[undefined, undefined, ARCS.length]}>
      <sphereGeometry args={[0.022, 8, 8]} />
      <meshBasicMaterial color={ORANGE} blending={THREE.AdditiveBlending} />
    </instancedMesh>
  );
}

/* ── Group with slow rotation ── */
function GlobeGroup() {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.04;
    }
  });
  return (
    <group ref={groupRef}>
      <GlobeSphere />
      <Pops />
      <Arcs />
      <ArcPulses />
    </group>
  );
}

export function SimpleGlobe() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        // Deck's signature warm cream, with a very subtle radial
        // gradient that gives the planet a soft "spotlight" feel
        // without breaking the light-bg identity.
        background:
          "radial-gradient(ellipse at center, #fffbf5 0%, #f8f0e3 75%, #f1e7d5 100%)",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 2.8], fov: 32 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={1.0} />
        <GlobeGroup />
      </Canvas>
    </div>
  );
}
