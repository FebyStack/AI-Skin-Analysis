import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { FaceAnalysisZone } from "@shared/face";
import { SEVERITY_COLOR, severityOf } from "@/motion/tokens";

/**
 * Zones as directions on the head — [yaw°, pitch°] — not as hand-typed xyz.
 * Positions are then projected onto the actual head surface, so a marker can
 * never end up buried inside the mesh (which silently hides a zone from the
 * clinician). Bilateral zones carry two directions and render as a pair.
 *
 * Laterality is clinical, not cosmetic: the model faces the camera (+Z), so
 * positive yaw is the patient's LEFT — the viewer's right — exactly as in a
 * frontal photograph. Backwards here would mislabel which side is affected.
 */
const ZONE_DIRS: Record<FaceAnalysisZone, [number, number][]> = {
  forehead: [[0, 40]],
  periorbital: [[-30, 20], [30, 20]],
  "under-eye": [[-18, 2], [18, 2]],
  nose: [[0, -3]],
  "left-cheek": [[34, -9]],
  "right-cheek": [[-34, -9]],
  chin: [[0, -42]],
};

const JAW_TAPER = 0.3;

const HEAD_RADII = { x: 0.72, y: 1.0, z: 0.78 };

/**
 * Point on the head surface along a [yaw, pitch] direction. `lift` pushes the
 * result outward (positive) or recesses it (negative) as a fraction of radius.
 */
function surfacePoint(yawDeg: number, pitchDeg: number, lift: number): THREE.Vector3 {
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const d = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  );
  // Ray/ellipsoid intersection for a ray from the centre.
  const p = d.multiplyScalar(
    1 / Math.hypot(d.x / HEAD_RADII.x, d.y / HEAD_RADII.y, d.z / HEAD_RADII.z),
  );
  // Mirror the jaw taper applied to the mesh so anchors track the real surface.
  if (p.y < 0) {
    const k = 1 - JAW_TAPER * Math.min(1, -p.y / HEAD_RADII.y) ** 2;
    p.x *= k;
    p.z *= k;
  }
  return p.multiplyScalar(1 + lift);
}

export interface ZoneScore {
  zone: FaceAnalysisZone;
  score: number;
}

/**
 * A schematic head with per-zone severity — NOT a 3D reconstruction of the
 * patient. Same honesty rule the derived views follow: it visualises numbers the
 * model produced, it does not claim to be scanned geometry.
 */
export default function FaceZoneMap3D({ zones, label }: { zones: ZoneScore[]; label: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<ZoneScore | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = Math.round(width * 0.8);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);
    camera.position.set(0, 0.02, 3.9);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // No WebGL — the caller's 2D map stays on screen.
    }
    renderer.setSize(width, height);
    // Cap at 2: a 3x retina phone would trip the memory ceiling this app has
    // already been bitten by once.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // Head, rim and markers share one rig so the presentation turn moves them
    // together — markers must stay pinned to their zones as the head rotates.
    const rig = new THREE.Group();
    scene.add(rig);

    // --- head -------------------------------------------------------------
    const headGeo = new THREE.SphereGeometry(1, 48, 32);
    headGeo.scale(HEAD_RADII.x, HEAD_RADII.y, HEAD_RADII.z);
    // Taper the lower half into a jaw. Without it the head reads as an egg and
    // the viewer cannot tell which way it is facing.
    const pos = headGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y >= 0) continue;
      const t2 = Math.min(1, -y / HEAD_RADII.y);
      const k = 1 - JAW_TAPER * t2 * t2;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    pos.needsUpdate = true;
    headGeo.computeVertexNormals();
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1f,
      roughness: 0.78,
      metalness: 0.05,
      transparent: true,
      opacity: 0.92,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    rig.add(head);

    // Champagne rim light picks the silhouette out of the dark canvas.
    const rim = new THREE.Mesh(
      headGeo.clone(),
      new THREE.MeshBasicMaterial({ color: 0xc8a96a, side: THREE.BackSide, transparent: true, opacity: 0.13 }),
    );
    rim.scale.setScalar(1.022);
    rig.add(rim);

    // Minimal features — enough to read orientation at a glance, not enough to
    // suggest this is anyone's actual face.
    const featureGeo = new THREE.SphereGeometry(1, 16, 12);
    const featureMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0d });
    const feature = (yaw: number, pitch: number, s: [number, number, number]) => {
      const m = new THREE.Mesh(featureGeo, featureMat);
      m.position.copy(surfacePoint(yaw, pitch, -0.012));
      m.scale.set(...s);
      rig.add(m);
    };
    feature(-20, 14, [0.1, 0.042, 0.05]); // eyes
    feature(20, 14, [0.1, 0.042, 0.05]);
    feature(0, -26, [0.13, 0.026, 0.05]); // mouth

    // --- zone markers -----------------------------------------------------
    const markerGeo = new THREE.SphereGeometry(1, 20, 16);
    const markers: { mesh: THREE.Mesh; data: ZoneScore; base: number }[] = [];

    for (const z of zones) {
      const dirs = ZONE_DIRS[z.zone];
      if (!dirs) continue;
      const color = SEVERITY_COLOR[severityOf(z.score)];
      // Size carries severity too, so the map still reads without colour.
      const base = 0.05 + z.score * 0.07;
      for (const [yaw, pitch] of dirs) {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88 });
        const mesh = new THREE.Mesh(markerGeo, mat);
        mesh.scale.setScalar(base);
        // Nose sits proud of the face; everything else hugs the surface.
        mesh.position.copy(surfacePoint(yaw, pitch, z.zone === "nose" ? 0.06 : 0.025));
        rig.add(mesh);
        markers.push({ mesh, data: z, base });
      }
    }

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xfff2dc, 1.5);
    key.position.set(2, 3, 4);
    scene.add(key);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // Keep the face broadly toward the viewer — no spinning to the back of a head.
    controls.minAzimuthAngle = -Math.PI / 2.1;
    controls.maxAzimuthAngle = Math.PI / 2.1;
    controls.minPolarAngle = Math.PI / 3.4;
    controls.maxPolarAngle = Math.PI / 1.6;

    // --- hover / tap ------------------------------------------------------
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const meshes = markers.map((m) => m.mesh);

    const onPointer = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(meshes)[0];
      setHovered(hit ? (markers.find((m) => m.mesh === hit.object)?.data ?? null) : null);
    };
    renderer.domElement.addEventListener("pointermove", onPointer);

    // --- loop -------------------------------------------------------------
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let interacted = false;
    controls.addEventListener("start", () => {
      interacted = true;
    });

    const clock = new THREE.Clock();
    let raf = 0;
    let running = true;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();

      // Ambient layer: a slow presentation turn that yields the moment the user
      // takes control (leaving the head wherever it was, no snap back), and
      // never runs under reduced-motion.
      if (!reduced && !interacted) rig.rotation.y = Math.sin(t * 0.22) * 0.42;

      // Secondary layer: severe zones breathe, drawing the eye without blinking.
      if (!reduced) {
        for (const m of markers) {
          if (m.data.score < 0.45) continue;
          m.mesh.scale.setScalar(m.base * (1 + Math.sin(t * 2.1) * 0.07));
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    // Stop the GPU when the map isn't on screen or the tab is hidden.
    const setRunning = (next: boolean) => {
      if (next === running) return;
      running = next;
      if (next) tick();
      else cancelAnimationFrame(raf);
    };
    const io = new IntersectionObserver(([e]) => setRunning(e.isIntersecting), { threshold: 0.05 });
    io.observe(mount);
    const onVisibility = () => setRunning(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);

    const onResize = () => {
      const w = mount.clientWidth;
      const h = Math.round(w * 0.8);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointermove", onPointer);
      controls.dispose();
      headGeo.dispose();
      markerGeo.dispose();
      featureGeo.dispose();
      featureMat.dispose();
      headMat.dispose();
      (rim.material as THREE.Material).dispose();
      rim.geometry.dispose();
      for (const m of markers) (m.mesh.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [zones]);

  return (
    <figure className="rounded-2xl border border-hairline bg-surface/40 p-2">
      <div ref={mountRef} className="w-full touch-pan-y" aria-hidden />
      <figcaption className="px-2 pb-1 pt-2 text-center text-[11px] leading-relaxed text-ink-tertiary">
        {hovered ? (
          <span className="text-ink">
            {hovered.zone.replace(/-/g, " ")} — {Math.round(hovered.score * 100)}% {label}
          </span>
        ) : (
          <>Drag to rotate. Schematic head — a map of {label} scores by zone, not a scan of this face.</>
        )}
      </figcaption>
    </figure>
  );
}
