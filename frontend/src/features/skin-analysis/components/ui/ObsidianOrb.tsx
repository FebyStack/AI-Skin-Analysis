import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { isMemoryConstrained } from "@ai/face/segmentation/parser";

/**
 * The waiting state while a scan is analysed and saved: a faceted obsidian
 * sphere with countless motes suspended around it.
 *
 * Obsidian is volcanic glass — it fractures conchoidally into sharp facets, so
 * the form is a low-poly icosahedron with flat shading rather than a smooth
 * ball. The look comes from lights raking across those facets, NOT from an
 * environment map: this mounts at the single most memory-pressured moment in the
 * app (five captured frames still in hand, ONNX mid-inference, on a phone that
 * has OOMed here before), and an HDR is exactly the allocation to refuse.
 * Nothing here is fetched — geometry and motes are generated in a few lines.
 *
 * Quality is TIERED rather than gated. A memory-constrained phone gets fewer
 * motes and a lower pixel ratio, not a blank box — it is the device most likely
 * to be waiting the longest.
 */

interface Tier {
  motes: number;
  detail: number;
  maxPixelRatio: number;
}

function tierFor(): Tier {
  return isMemoryConstrained()
    ? { motes: 160, detail: 1, maxPixelRatio: 1.5 }
    : { motes: 520, detail: 1, maxPixelRatio: 2 };
}

/** Motes drift in a shell around the orb — memories held in the glass, not on it. */
function motePositions(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Even-ish spherical distribution, then jittered outward so it reads as a
    // cloud with depth rather than a shell.
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 1.25 + Math.random() * 1.15;
    out[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    out[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r * 0.8;
    out[i * 3 + 2] = Math.cos(phi) * r;
  }
  return out;
}

export default function ObsidianOrb({ label }: { label: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [noWebgl, setNoWebgl] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // No WebGL — show the CSS fallback so the wait is never a blank panel.
      setNoWebgl(true);
      return;
    }

    const tier = tierFor();
    const size = () => Math.min(mount.clientWidth, 260);
    let side = size();

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.z = 5.4;

    renderer.setSize(side, side);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxPixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // ── the stone ────────────────────────────────────────────────────────────
    const geo = new THREE.IcosahedronGeometry(1.32, tier.detail);
    const mat = new THREE.MeshPhysicalMaterial({
      // Not pure black: obsidian carries a faint warm-brown depth, and a true
      // 0x000000 gives the lights nothing to sit on.
      color: 0x14110f,
      roughness: 0.12,
      metalness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      // Flat shading is what turns a sphere into fractured glass.
      flatShading: true,
    });
    const orb = new THREE.Mesh(geo, mat);
    scene.add(orb);

    // A hairline gold edge so the silhouette exists against a near-black page.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 18),
      new THREE.LineBasicMaterial({ color: 0xc8a96a, transparent: true, opacity: 0.5 }),
    );
    scene.add(edges);

    // ── countless memories ───────────────────────────────────────────────────
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(motePositions(tier.motes), 3));
    const moteMat = new THREE.PointsMaterial({
      color: 0xe8d5a8,
      size: 0.032,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const motes = new THREE.Points(moteGeo, moteMat);
    scene.add(motes);

    // Lights stand in for the reflections an environment map would give.
    // Several moderate sources beat one bright one: on flat-shaded geometry each
    // facet resolves to a distinct value, which is what reads as fractured glass.
    // A single strong key just blows out one face and leaves the rest black.
    scene.add(new THREE.AmbientLight(0x322c26, 2.6));
    const key = new THREE.DirectionalLight(0xffe4b5, 3.4);
    key.position.set(2.5, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xc8a96a, 2.4);
    rim.position.set(-3.5, -1, 1.5);
    scene.add(rim);
    // Cool counter-light kept desaturated and dim — a blue strong enough to see
    // fights the champagne palette everywhere else in the app.
    const counter = new THREE.DirectionalLight(0x9aa8c0, 0.7);
    counter.position.set(-1, 2.5, -3);
    scene.add(counter);
    // A close point light gives the hot, travelling specular that makes the
    // surface read as polished glass rather than matte stone. Directional lights
    // alone light a whole facet evenly and never glint.
    const glint = new THREE.PointLight(0xfff2d8, 26, 7, 2);
    glint.position.set(1.5, 1.6, 2.4);
    scene.add(glint);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();

      if (!reduced) {
        // Slow and unhurried: this is a wait, not a spinner urging speed.
        orb.rotation.y = edges.rotation.y = t * 0.28;
        orb.rotation.x = edges.rotation.x = Math.sin(t * 0.21) * 0.22;
        // The cloud counter-rotates, so motes read as separate from the stone.
        motes.rotation.y = -t * 0.11;
        motes.rotation.z = Math.sin(t * 0.17) * 0.14;
        // Breathing, tied to the same clock so nothing drifts out of phase.
        const breath = 1 + Math.sin(t * 0.9) * 0.022;
        orb.scale.setScalar(breath);
        edges.scale.setScalar(breath);
        moteMat.opacity = 0.6 + Math.sin(t * 1.3) * 0.18;
      } else {
        // Still legible as "working" without any motion at all.
        moteMat.opacity = 0.7;
      }

      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      side = size();
      renderer.setSize(side, side);
    };
    window.addEventListener("resize", onResize);
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      geo.dispose();
      mat.dispose();
      edges.geometry.dispose();
      (edges.material as THREE.Material).dispose();
      moteGeo.dispose();
      moteMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-5 py-10" role="status" aria-live="polite">
      <div className="relative h-[260px] w-[260px]">
        <div ref={mountRef} className="absolute inset-0 flex items-center justify-center" aria-hidden />
        {noWebgl && (
          <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
            <span className="h-24 w-24 animate-pulse rounded-full border border-gold/30 bg-gold/[0.06]" />
          </div>
        )}
      </div>
      <p className="text-sm text-ink-secondary">{label}</p>
    </div>
  );
}
