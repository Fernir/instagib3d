import { state } from '@/core/runtime-state.js';

export const MINIMAP_RADIUS = 0.28;
export const MINIMAP_PAD = 0.04;

export function minimapCenter(aspect) {
  const r = MINIMAP_RADIUS;
  return {
    x: -1 + MINIMAP_PAD + r / aspect,
    y: -1 + MINIMAP_PAD + r,
    radiusY: r,
    radiusX: r / aspect,
  };
}

export function minimapRightEdge(aspect) {
  const c = minimapCenter(aspect);
  return c.x + c.radiusX;
}

export function clientToNdc(clientX, clientY, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  return { x, y };
}

export function hitMinimapZone(clientX, clientY, canvas) {
  if (!canvas) return false;
  const aspect = canvas.width / canvas.height;
  const c = minimapCenter(aspect);
  const ndc = clientToNdc(clientX, clientY, canvas);
  const dx = (ndc.x - c.x) / c.radiusX;
  const dy = (ndc.y - c.y) / c.radiusY;
  return dx * dx + dy * dy <= 1.05;
}

export function hitConsoleToggleZone(clientX, clientY, canvas) {
  if (!canvas) return false;
  const ndc = clientToNdc(clientX, clientY, canvas);
  return ndc.x < -0.72 && ndc.y > 0.72;
}

export function hitPlayButton(clientX, clientY, canvas) {
  const gc = state.gameClient;
  if (!gc || !gc.playButtonHitTest || (gc.isPlaying && gc.isPlaying())) return false;
  const ndc = clientToNdc(clientX, clientY, canvas);
  const btn = gc.playButtonHitTest();
  if (!btn) return false;
  return Math.abs(ndc.x - btn.x) <= btn.w && Math.abs(ndc.y - btn.y) <= btn.h;
}
