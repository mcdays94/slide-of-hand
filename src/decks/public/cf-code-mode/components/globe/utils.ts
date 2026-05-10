import * as THREE from "three";

/**
 * Convert latitude/longitude to 3D position on a sphere.
 */
export function latLngToVector3(
  lat: number,
  lng: number,
  radius: number
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

/**
 * Generate points along a great-circle arc between two points on a sphere,
 * with a configurable outward bulge.
 */
export function createArcPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  numPoints: number = 64,
  bulge: number = 0.06
): THREE.Vector3[] {
  const startNorm = start.clone().normalize();
  const endNorm = end.clone().normalize();
  const radius = start.length();

  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    // Slerp between start and end
    const point = new THREE.Vector3().copy(startNorm);
    point.lerp(endNorm, t).normalize();
    // Add outward bulge based on sine curve
    const heightOffset = bulge * Math.sin(t * Math.PI);
    point.multiplyScalar(radius + heightOffset);
    points.push(point);
  }
  return points;
}

/**
 * Generate graticule (lat/lng grid) line segments.
 */
export function createGraticulePoints(
  radius: number = 1.002,
  latStep: number = 30,
  lngStep: number = 30,
  segments: number = 128
): Float32Array {
  const positions: number[] = [];

  // Latitude lines
  for (let lat = -60; lat <= 60; lat += latStep) {
    for (let i = 0; i < segments; i++) {
      const lng1 = (i / segments) * 360 - 180;
      const lng2 = ((i + 1) / segments) * 360 - 180;
      const p1 = latLngToVector3(lat, lng1, radius);
      const p2 = latLngToVector3(lat, lng2, radius);
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }

  // Longitude lines
  for (let lng = -180; lng < 180; lng += lngStep) {
    for (let i = 0; i < segments; i++) {
      const lat1 = (i / segments) * 180 - 90;
      const lat2 = ((i + 1) / segments) * 180 - 90;
      const p1 = latLngToVector3(lat1, lng, radius);
      const p2 = latLngToVector3(lat2, lng, radius);
      positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  }

  return new Float32Array(positions);
}
