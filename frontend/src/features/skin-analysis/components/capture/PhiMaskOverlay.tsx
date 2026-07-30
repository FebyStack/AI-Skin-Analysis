import { useEffect, useRef } from "react";
import * as THREE from "three";
import { maskSegments, orthoFraming } from "./phi-mask";

/**
 * The phi mask as a 3D wireframe over the camera feed, turned to the yaw the
 * current step is asking for — so the patient can see the target head pose
 * instead of inferring it from an arrow.
 *
 * Deliberately thin: one LineSegments mesh, no lights, no controls, no
 * post-processing. It draws on top of a live video element on a phone, which is
 * already the most memory-pressured moment in the app.
 */
export default function PhiMaskOverlay({
  yawDeg,
  holding,
  progress,
}: {
  /** Current yaw, already eased by the caller so both overlay layers agree. */
  yawDeg: number;
  /** Pose is being held — the mask firms up and goes green. */
  holding: boolean;
  /** 0..1 of the hold countdown, for the settle animation. */
  progress: number;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Latest props for the render loop, without re-creating the scene each frame.
  const target = useRef({ yawDeg, holding, progress });
  target.current = { yawDeg, holding, progress };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // No WebGL — the SVG mask underneath is already doing the job.
    }

    const size = () => ({ w: mount.clientWidth, h: mount.clientHeight });
    const { w, h } = size();

    const scene = new THREE.Scene();
    // Orthographic: the guide must stay the same size wherever the head turns,
    // so it can be framed against. Perspective would make it breathe.
    const { halfHeight: halfH, offsetY } = orthoFraming();
    const camera = new THREE.OrthographicCamera(-halfH, halfH, halfH, -halfH, -10, 10);
    camera.position.z = 3;

    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(maskSegments(), 3));

    const mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.72 });
    const mask = new THREE.LineSegments(geo, mat);
    mask.position.y = offsetY;
    scene.add(mask);

    const GOLD = new THREE.Color(0xc8a96a);
    const READY = new THREE.Color(0x6fbf8f);

    const onResize = () => {
      const s = size();
      const aspect = s.w / s.h;
      // Keep the mask's height fixed and let width follow the container.
      camera.left = -halfH * aspect;
      camera.right = halfH * aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(s.w, s.h);
    };
    onResize();
    window.addEventListener("resize", onResize);

    let raf = 0;
    let running = true;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { yawDeg: wantYaw, holding: held, progress: p } = target.current;

      mask.rotation.y = THREE.MathUtils.degToRad(wantYaw);

      mat.color.lerpColors(GOLD, READY, held ? Math.min(1, p) : 0);
      mat.opacity = held ? 0.72 + 0.28 * Math.min(1, p) : 0.72;

      renderer.render(scene, camera);
    };
    tick();

    const setRunning = (next: boolean) => {
      if (next === running) return;
      running = next;
      if (next) tick();
      else cancelAnimationFrame(raf);
    };
    const onVisibility = () => setRunning(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0" aria-hidden />;
}
