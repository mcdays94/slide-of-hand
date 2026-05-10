/**
 * Globe3D — interactive 3D globe of Cloudflare's PoP network.
 *
 * Adapted from cf-slides' `Globe3D` (src/components/globe/Globe3D.tsx) with
 * three enhancements for the DTX Manchester deck:
 *
 *   1. Stronger colors — bumped opacities across sphere, arcs, dots, and
 *      coastlines to compete with the saturated text alongside it on stage.
 *   2. Traffic-flow arcs — pulsing dots travel along every backbone arc,
 *      simulating the data moving across Cloudflare's network.
 *   3. Manchester pulse — a single highlighted PoP at Manchester (DTX 2026's
 *      host city) with continuously expanding rings.
 *
 * Two upstream changes are preserved here too:
 *   - Vanilla CSS class wrapper instead of Tailwind.
 *   - `<Environment preset="dawn" />` removed — it pulls an HDR cubemap from
 *     a CDN at runtime; conference Wi-Fi is unreliable, so we use direct
 *     lighting only.
 */
import { useRef, useMemo, useEffect, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { mesh as topoMesh } from "topojson-client";
import countriesTopoRaw from "world-atlas/countries-110m.json";
import { POP_LOCATIONS, NAMED_CITIES, BACKBONE_CONNECTIONS } from "./data";
import { latLngToVector3, createArcPoints, createGraticulePoints } from "./utils";

// world-atlas ships this JSON without precise types; the runtime shape is a
// valid TopoJSON Topology with an `objects.countries` GeometryCollection.
// Use a permissive cast at the boundary so the rest of the file stays typed.
type AnyTopology = Parameters<typeof topoMesh>[0];
type AnyTopologyObject = Parameters<typeof topoMesh>[1];
const countriesTopo = countriesTopoRaw as unknown as AnyTopology & {
  objects: { countries: AnyTopologyObject };
};

/* ─── Constants ─── */

/** Manchester PoP — DTX 2026 host city, highlighted with a pulse. */
const MANCHESTER: [number, number] = [53.4808, -2.2426];

/** Manchester is so close to other UK PoPs (London/Birmingham at ~52.5,-0.1)
 *  that the regular blue dot would overlap the pulse rings. Drop it from the
 *  default location set so the highlighted pulse is unambiguous. */
const POP_LOCATIONS_WITHOUT_MANCHESTER: [number, number][] = POP_LOCATIONS.filter(
  ([lat, lng]) => !(Math.abs(lat - 53.4808) < 0.01 && Math.abs(lng - -2.2426) < 0.01),
);

/* ─── Types ─── */

export interface Globe3DProps {
  className?: string;
  showGraticule?: boolean;
  showNetworkArcs?: boolean;
  showPopDots?: boolean;
  /** Animate dots travelling along each arc — gives the network a heartbeat. */
  showTrafficFlow?: boolean;
  /** Highlight Manchester with an orange pulse — DTX 2026 host city. */
  showManchesterPulse?: boolean;
  spinSpeed?: number;
  cameraDistance?: number;
  tiltX?: number;
  initialRotationY?: number;
  draggable?: boolean;
  dotColor?: string;
  landColor?: string;
  arcColor?: string;
  manchesterColor?: string;
  trafficColor?: string;
  sphereOpacity?: number;
  locations?: [number, number][];
}

/* ─── Globe Sphere ─── */

function GlobeSphere({ opacity = 0.12 }: { opacity?: number }) {
  return (
    <mesh>
      <sphereGeometry args={[1, 96, 96]} />
      <meshPhysicalMaterial
        color="#FFF8F0"
        transparent
        opacity={opacity}
        roughness={0.18}
        metalness={0}
        clearcoat={0.4}
        transmission={0.88}
        ior={1.4}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/* ─── Graticule Grid Lines ─── */

function Graticule() {
  const geometry = useMemo(() => {
    const positions = createGraticulePoints(1.002, 30, 30, 128);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#8A6A50" transparent opacity={0.28} depthWrite={false} />
    </lineSegments>
  );
}

/* ─── PoP Location Dots ─── */

function PopDots({
  locations,
  color = "#0066FF",
}: {
  locations: [number, number][];
  color?: string;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    locations.forEach(([lat, lng], i) => {
      const pos = latLngToVector3(lat, lng, 1.015);
      dummy.position.copy(pos);
      dummy.lookAt(pos.clone().multiplyScalar(2));
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [locations, dummy]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, locations.length]}>
      <sphereGeometry args={[0.014, 12, 12]} />
      <meshBasicMaterial color={color} />
    </instancedMesh>
  );
}

/* ─── Land Mass Dots (procedural continents) ─── */

function LandDots({ color = "#FF4801" }: { color?: string }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const radius = 1.005;
    const step = 2.5;

    const continents: { latRange: [number, number]; lngRange: [number, number] }[] = [
      { latRange: [25, 72], lngRange: [-170, -50] },
      { latRange: [7, 25], lngRange: [-120, -60] },
      { latRange: [-56, 12], lngRange: [-82, -34] },
      { latRange: [36, 72], lngRange: [-12, 40] },
      { latRange: [-35, 37], lngRange: [-18, 52] },
      { latRange: [12, 55], lngRange: [40, 100] },
      { latRange: [18, 72], lngRange: [100, 150] },
      { latRange: [-10, 20], lngRange: [95, 140] },
      { latRange: [-44, -10], lngRange: [113, 154] },
      { latRange: [12, 42], lngRange: [25, 60] },
      { latRange: [8, 36], lngRange: [68, 90] },
      { latRange: [30, 46], lngRange: [126, 146] },
    ];

    for (const { latRange, lngRange } of continents) {
      for (let lat = latRange[0]; lat <= latRange[1]; lat += step) {
        for (let lng = lngRange[0]; lng <= lngRange[1]; lng += step) {
          if (Math.random() > 0.3) {
            const jLat = lat + (Math.random() - 0.5) * step * 0.6;
            const jLng = lng + (Math.random() - 0.5) * step * 0.6;
            const pos = latLngToVector3(jLat, jLng, radius);
            positions.push(pos.x, pos.y, pos.z);
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    return geo;
  }, []);

  return (
    <points geometry={geometry}>
      <pointsMaterial
        color={color}
        size={0.014}
        sizeAttenuation
        transparent
        opacity={0.92}
        depthWrite={false}
      />
    </points>
  );
}

/* ─── World Borders (accurate, from Natural Earth via world-atlas) ─── */

/**
 * Pre-built buffer geometries for:
 *   - `coastline` — every land/water boundary (the continent outlines).
 *   - `borders`   — every country boundary that ISN'T also a coastline,
 *                    so France-Germany etc. show without doubling up.
 *
 * Computed once at module load so we don't burn frames on this on every
 * mount.
 */
function buildBorderGeometry(
  coords: ReadonlyArray<ReadonlyArray<[number, number]>>,
  radius: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const ring of coords) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng1, lat1] = ring[i];
      const [lng2, lat2] = ring[i + 1];
      const p1 = latLngToVector3(lat1, lng1, radius);
      const p2 = latLngToVector3(lat2, lng2, radius);
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geo;
}

const COASTLINE_GEOMETRY = (() => {
  // `topoMesh(topo, obj, filter)` returns the boundaries between geometries.
  // `(a, b) => a === b` filters to *exterior* boundaries — i.e. coastlines.
  const featureCollection = topoMesh(
    countriesTopo,
    countriesTopo.objects.countries,
    (a, b) => a === b,
  );
  const coords = featureCollection.coordinates as unknown as [number, number][][];
  return buildBorderGeometry(coords, 1.006);
})();

const COUNTRY_BORDER_GEOMETRY = (() => {
  // Same call but `(a, b) => a !== b` returns *interior* boundaries —
  // i.e. country borders that aren't also a coastline.
  const featureCollection = topoMesh(
    countriesTopo,
    countriesTopo.objects.countries,
    (a, b) => a !== b,
  );
  const coords = featureCollection.coordinates as unknown as [number, number][][];
  return buildBorderGeometry(coords, 1.0055);
})();

function WorldCoastlines({ color = "#FF4801" }: { color?: string }) {
  return (
    <lineSegments geometry={COASTLINE_GEOMETRY}>
      <lineBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
    </lineSegments>
  );
}

function WorldCountryBorders({ color = "#FF4801" }: { color?: string }) {
  return (
    <lineSegments geometry={COUNTRY_BORDER_GEOMETRY}>
      <lineBasicMaterial color={color} transparent opacity={0.32} depthWrite={false} />
    </lineSegments>
  );
}

/* ─── Network Arcs ─── */

/**
 * Compute the curve for a single backbone connection. Shared by static
 * NetworkArcs (the visible tube) and TrafficFlow (the moving dots) so the
 * dots stay glued to the tube even if we tweak bulge later.
 */
type ArcCurve = {
  curve: THREE.CatmullRomCurve3;
  tubeGeo: THREE.TubeGeometry;
};

function useArcCurves(): ArcCurve[] {
  return useMemo(() => {
    return BACKBONE_CONNECTIONS.map(([fromCity, toCity]) => {
      const from = NAMED_CITIES[fromCity];
      const to = NAMED_CITIES[toCity];
      if (!from || !to) return null;

      const startPos = latLngToVector3(from[0], from[1], 1.01);
      const endPos = latLngToVector3(to[0], to[1], 1.01);
      const dist = startPos.distanceTo(endPos);
      const bulge = Math.max(0.03, dist * 0.08);

      const points = createArcPoints(startPos, endPos, 64, bulge);
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, 48, 0.0028, 6, false);

      return { curve, tubeGeo };
    }).filter(Boolean) as ArcCurve[];
  }, []);
}

function NetworkArcs({ color, arcs }: { color: string; arcs: ArcCurve[] }) {
  return (
    <group>
      {arcs.map((arc, i) => (
        <mesh key={i} geometry={arc.tubeGeo}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.85}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ─── Traffic Flow (animated dots travelling along arcs) ─── */

function TrafficFlow({ color, arcs }: { color: string; arcs: ArcCurve[] }) {
  // Two dots per arc, half a cycle apart, so each path always has
  // something visibly moving. Random per-arc phase offset keeps the
  // streams from all firing in sync.
  const dotsPerArc = 2;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Random phase offsets — generated once on mount so dots don't reshuffle
  // across re-renders.
  const phaseOffsets = useMemo(
    () => arcs.map(() => Math.random()),
    [arcs],
  );

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // ~3 seconds per full traversal at speed 1.0
    const t = (state.clock.getElapsedTime() * 0.32) % 1;

    arcs.forEach((arc, arcIdx) => {
      for (let d = 0; d < dotsPerArc; d++) {
        const phase = (t + phaseOffsets[arcIdx] + d / dotsPerArc) % 1;
        const pos = arc.curve.getPoint(phase);
        dummy.position.copy(pos);
        // Scale fades in at the start, peaks mid-arc, fades at the end —
        // gives the classic comet-trail-ish suggestion.
        const sizeCurve = Math.sin(phase * Math.PI);
        dummy.scale.setScalar(0.5 + sizeCurve * 0.9);
        dummy.updateMatrix();
        mesh.setMatrixAt(arcIdx * dotsPerArc + d, dummy.matrix);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, arcs.length * dotsPerArc]}
      frustumCulled={false}
    >
      <sphereGeometry args={[0.012, 10, 10]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} blending={THREE.AdditiveBlending} />
    </instancedMesh>
  );
}

/* ─── Manchester Pulse (highlighted PoP with expanding rings) ─── */

function ManchesterPulse({
  color = "#FFCC00",
  showDtxBadge = true,
}: {
  color?: string;
  showDtxBadge?: boolean;
}) {
  // Expanding ring meshes — each is a thin ring oriented tangent to the
  // sphere at Manchester. We grow scale and fade opacity in `useFrame`
  // for a continuous radar-pulse effect.
  const RING_COUNT = 3;
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const dotRef = useRef<THREE.Mesh>(null);

  // Pre-compute the orientation matrix once; this places + rotates the
  // group so the rings lie tangent to the sphere at Manchester.
  const groupMatrix = useMemo(() => {
    const m = new THREE.Matrix4();
    const dummy = new THREE.Object3D();
    const pos = latLngToVector3(MANCHESTER[0], MANCHESTER[1], 1.018);
    dummy.position.copy(pos);
    dummy.lookAt(pos.clone().multiplyScalar(2));
    dummy.updateMatrix();
    m.copy(dummy.matrix);
    return m;
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    // Center dot: gentle pulse in size
    if (dotRef.current) {
      const pulse = 1 + Math.sin(t * 3) * 0.12;
      dotRef.current.scale.setScalar(pulse);
    }

    // Expanding rings: each ring runs a 2-second cycle, offset by 1/N
    // so we always have rings at different stages of the animation.
    for (let i = 0; i < RING_COUNT; i++) {
      const ring = ringRefs.current[i];
      if (!ring) continue;
      const cycle = 2.4;
      const phase = ((t + i * (cycle / RING_COUNT)) % cycle) / cycle; // 0..1

      // scale grows from 0.6 → 4.5 over the cycle
      const scale = 0.6 + phase * 3.9;
      ring.scale.setScalar(scale);

      // opacity fades from 0.85 → 0
      const mat = ring.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.85 * (1 - phase));
    }
  });

  return (
    <group matrix={groupMatrix} matrixAutoUpdate={false}>
      {/* Central beacon dot */}
      <mesh ref={dotRef}>
        <sphereGeometry args={[0.022, 16, 16]} />
        <meshBasicMaterial color={color} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* Faint static halo right behind the dot */}
      <mesh position={[0, 0, -0.001]}>
        <ringGeometry args={[0.022, 0.04, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Animated radar rings */}
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            ringRefs.current[i] = el;
          }}
        >
          <ringGeometry args={[0.04, 0.046, 48]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.85}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* DTX badge — 3D textured plane tangent to the globe, hovering just
          above the Manchester dot. Front-side culling means it naturally
          disappears when Manchester rotates to the far side of the globe. */}
      {showDtxBadge && <DtxBadge3D />}
    </group>
  );
}

function DtxBadge3D() {
  const texture = useTexture("/cf-code-mode/photos/dtx-logo.png");
  // PNG has transparency; tell three.js to treat its colors as sRGB
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  // Aspect of the source PNG = 1838 / 781 ≈ 2.353
  const width = 0.26;
  const height = width / 2.353;

  return (
    <mesh
      // Slightly above the Manchester dot, with a small upward shift so the
      // badge sits just above the pulse rings rather than centered on them.
      position={[0, 0.025, 0.05]}
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        toneMapped={false}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}

/* ─── Globe Group (rotation + children) ─── */

function GlobeGroup(props: {
  showGraticule: boolean;
  showNetworkArcs: boolean;
  showPopDots: boolean;
  showTrafficFlow: boolean;
  showManchesterPulse: boolean;
  spinSpeed: number;
  tiltX: number;
  initialRotationY: number;
  dotColor: string;
  landColor: string;
  arcColor: string;
  manchesterColor: string;
  trafficColor: string;
  sphereOpacity: number;
  locations: [number, number][];
}) {
  const groupRef = useRef<THREE.Group>(null);
  const initializedRef = useRef(false);
  const arcs = useArcCurves();

  useFrame((_state, delta) => {
    if (!groupRef.current) return;
    if (!initializedRef.current) {
      groupRef.current.rotation.x = props.tiltX;
      groupRef.current.rotation.y = props.initialRotationY;
      initializedRef.current = true;
    }
    if (props.spinSpeed > 0) {
      groupRef.current.rotation.y += delta * 0.06 * props.spinSpeed;
    }
  });

  return (
    <group ref={groupRef}>
      <GlobeSphere opacity={props.sphereOpacity} />
      {props.showGraticule && <Graticule />}
      <LandDots color={props.landColor} />
      <WorldCoastlines color={props.landColor} />
      <WorldCountryBorders color={props.landColor} />
      {props.showPopDots && <PopDots locations={props.locations} color={props.dotColor} />}
      {props.showNetworkArcs && <NetworkArcs color={props.arcColor} arcs={arcs} />}
      {props.showTrafficFlow && props.showNetworkArcs && (
        <TrafficFlow color={props.trafficColor} arcs={arcs} />
      )}
      {props.showManchesterPulse && <ManchesterPulse color={props.manchesterColor} />}
    </group>
  );
}

/* ─── Main Component ─── */

export function Globe3D({
  className = "",
  showGraticule = true,
  showNetworkArcs = true,
  showPopDots = true,
  showTrafficFlow = true,
  showManchesterPulse = true,
  spinSpeed = 1,
  cameraDistance = 3.0,
  tiltX = 0.4,
  initialRotationY = 3.5,
  draggable = false,
  dotColor = "#0A95FF",
  landColor = "#FF4801",
  arcColor = "#FF4801",
  manchesterColor = "#FFCC00",
  trafficColor = "#FFE38A",
  sphereOpacity = 0.12,
  // Default to the location set with Manchester removed so the highlighted
  // pulse isn't visually competing with a regular blue dot.
  locations = POP_LOCATIONS_WITHOUT_MANCHESTER,
}: Globe3DProps) {
  return (
    <div className={`globe3d ${className}`} style={{ width: "100%", height: "100%" }}>
      <Canvas
        camera={{ position: [0, 0, cameraDistance], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <Suspense fallback={null}>
          {/* Lighting — no Environment HDR (CDN dep), so we tune lights more aggressively */}
          <ambientLight intensity={1.8} color="#FFF8F0" />
          <directionalLight position={[3, 4, 3]} intensity={1.4} color="#FFF5EC" />
          <directionalLight position={[-3, 2, -2]} intensity={0.7} color="#FFE8D6" />
          <pointLight position={[4, 4, 4]} intensity={0.9} color="#FF6633" />
          <pointLight position={[-4, -2, 2]} intensity={0.4} color="#FF4801" />

          <GlobeGroup
            showGraticule={showGraticule}
            showNetworkArcs={showNetworkArcs}
            showPopDots={showPopDots}
            showTrafficFlow={showTrafficFlow}
            showManchesterPulse={showManchesterPulse}
            spinSpeed={spinSpeed}
            tiltX={tiltX}
            initialRotationY={initialRotationY}
            dotColor={dotColor}
            landColor={landColor}
            arcColor={arcColor}
            manchesterColor={manchesterColor}
            trafficColor={trafficColor}
            sphereOpacity={sphereOpacity}
            locations={locations}
          />

          {draggable && (
            <OrbitControls enablePan={false} enableZoom={true} minDistance={1.8} maxDistance={5} />
          )}
        </Suspense>
      </Canvas>
    </div>
  );
}
