import { Engine } from './core/Engine';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Game canvas element not found');
  }

  const engine = new Engine(canvas);
  engine.start();

  // Export engine for debugging
  (window as any).__engine = engine;
});
