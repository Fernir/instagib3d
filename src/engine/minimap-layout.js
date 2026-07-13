import { state } from '@/core/runtime-state.js';

export class MinimapLayout {
  static RADIUS = 0.28;
  static PAD = 0.04;

  static center(aspect) {
    const r = MinimapLayout.RADIUS;
    return {
      x: -1 + MinimapLayout.PAD + r / aspect,
      y: -1 + MinimapLayout.PAD + r,
      radiusY: r,
      radiusX: r / aspect,
    };
  }

  static rightEdge(aspect) {
    const c = MinimapLayout.center(aspect);
    return c.x + c.radiusX;
  }

  static clientToNdc(clientX, clientY, canvas) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    return { x, y };
  }

  static hitMinimapZone(clientX, clientY, canvas) {
    if (!canvas) return false;
    const aspect = canvas.width / canvas.height;
    const c = MinimapLayout.center(aspect);
    const ndc = MinimapLayout.clientToNdc(clientX, clientY, canvas);
    const dx = (ndc.x - c.x) / c.radiusX;
    const dy = (ndc.y - c.y) / c.radiusY;
    return dx * dx + dy * dy <= 1.05;
  }

  static hitConsoleToggleZone(clientX, clientY, canvas) {
    if (!canvas) return false;
    const ndc = MinimapLayout.clientToNdc(clientX, clientY, canvas);
    return ndc.x < -0.72 && ndc.y > 0.72;
  }

  static hitPlayButton(clientX, clientY, canvas) {
    const gc = state.gameClient;
    if (!gc || !gc.playButtonHitTest || (gc.isPlaying && gc.isPlaying())) return false;
    const ndc = MinimapLayout.clientToNdc(clientX, clientY, canvas);
    const btn = gc.playButtonHitTest();
    if (!btn) return false;
    return Math.abs(ndc.x - btn.x) <= btn.w && Math.abs(ndc.y - btn.y) <= btn.h;
  }
}

