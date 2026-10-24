export class HUD {
  private distElement: HTMLElement | null;
  private speedElement: HTMLElement | null;
  private gameoverModal: HTMLElement | null;
  private finalStatsElement: HTMLElement | null;
  private restartBtn: HTMLElement | null;

  public onRestart?: () => void;

  private onKeyDownBound = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && this.gameoverModal?.classList.contains('visible')) {
      if (this.onRestart) {
        this.onRestart();
      }
    }
  };

  private onRestartClickBound = (): void => {
    if (this.onRestart) {
      this.onRestart();
    }
  };

  constructor() {
    this.distElement = document.getElementById('hud-distance');
    this.speedElement = document.getElementById('hud-speed');
    this.gameoverModal = document.getElementById('gameover-modal');
    this.finalStatsElement = document.getElementById('final-stats');
    this.restartBtn = document.getElementById('restart-btn');

    if (this.restartBtn) {
      this.restartBtn.addEventListener('click', this.onRestartClickBound);
    }

    // Space key to restart
    window.addEventListener('keydown', this.onKeyDownBound);
  }

  public update(distance: number, speed: number): void {
    const validDist = isNaN(distance) ? 0 : Math.max(0, distance);
    const validSpeed = isNaN(speed) ? 12.0 : speed;

    if (this.distElement) {
      this.distElement.innerText = `${Math.floor(validDist)} m`;
    }
    if (this.speedElement) {
      this.speedElement.innerText = `${validSpeed.toFixed(1)} m/s`;
    }
  }

  public showGameOver(distance: number): void {
    const validDist = isNaN(distance) ? 0 : Math.max(0, distance);
    if (this.finalStatsElement) {
      this.finalStatsElement.innerText = `You covered ${Math.floor(validDist)} meters through the winding trail!`;
    }
    if (this.gameoverModal) {
      this.gameoverModal.classList.add('visible');
    }
  }

  public hideGameOver(): void {
    if (this.gameoverModal) {
      this.gameoverModal.classList.remove('visible');
    }
  }

  public dispose(): void {
    if (this.restartBtn) {
      this.restartBtn.removeEventListener('click', this.onRestartClickBound);
    }
    window.removeEventListener('keydown', this.onKeyDownBound);
  }
}
