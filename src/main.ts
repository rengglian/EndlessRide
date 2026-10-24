import { Engine } from './core/Engine';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Game canvas element not found');
  }

  const engine = new Engine(canvas);
  engine.start();

  // Export engine for debugging only in DEV mode
  const isDev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  if (isDev) {
    (window as unknown as Record<string, unknown>).__engine = engine;
  }
});
