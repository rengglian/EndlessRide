export class HUD {
  private distElement: HTMLElement | null;
  private speedElement: HTMLElement | null;
  private highScoreElement: HTMLElement | null;

  private startModal: HTMLElement | null;
  private startBtn: HTMLElement | null;

  private pauseModal: HTMLElement | null;
  private resumeBtn: HTMLElement | null;

  private gameoverModal: HTMLElement | null;
  private finalStatsElement: HTMLElement | null;
  private restartBtn: HTMLElement | null;
  private newRecordBadge: HTMLElement | null;

  // Cached display values to avoid layout thrashing and DOM writes every frame
  private lastDisplayedDist = -1;
  private lastDisplayedSpeedTenths = -1;
  private lastDisplayedHighScore = -1;

  public onStart?: () => void;
  public onResume?: () => void;
  public onRestart?: () => void;

  private onKeyDownBound = (e: KeyboardEvent): void => {
    if (e.code === 'Space' || e.code === 'Enter') {
      if (this.startModal?.classList.contains('visible')) {
        this.onStart?.();
      } else if (this.pauseModal?.classList.contains('visible')) {
        this.onResume?.();
      } else if (this.gameoverModal?.classList.contains('visible')) {
        this.onRestart?.();
      }
    }
  };

  private onStartClickBound = (): void => {
    this.onStart?.();
  };

  private onResumeClickBound = (): void => {
    this.onResume?.();
  };

  private onRestartClickBound = (): void => {
    this.onRestart?.();
  };

  constructor() {
    this.distElement = document.getElementById('hud-distance');
    this.speedElement = document.getElementById('hud-speed');
    this.highScoreElement = document.getElementById('hud-high-score');

    this.startModal = document.getElementById('start-modal');
    this.startBtn = document.getElementById('start-btn');

    this.pauseModal = document.getElementById('pause-modal');
    this.resumeBtn = document.getElementById('resume-btn');

    this.gameoverModal = document.getElementById('gameover-modal');
    this.finalStatsElement = document.getElementById('final-stats');
    this.restartBtn = document.getElementById('restart-btn');
    this.newRecordBadge = document.getElementById('new-record-badge');

    if (this.startBtn) {
      this.startBtn.addEventListener('click', this.onStartClickBound);
    }
    if (this.resumeBtn) {
      this.resumeBtn.addEventListener('click', this.onResumeClickBound);
    }
    if (this.restartBtn) {
      this.restartBtn.addEventListener('click', this.onRestartClickBound);
    }

    window.addEventListener('keydown', this.onKeyDownBound);
  }

  public update(distance: number, speed: number): void {
    const validDist = isNaN(distance) ? 0 : Math.max(0, distance);
    const validSpeed = isNaN(speed) ? 18.0 : speed;

    const intDist = Math.floor(validDist);
    if (intDist !== this.lastDisplayedDist) {
      this.lastDisplayedDist = intDist;
      if (this.distElement) {
        this.distElement.textContent = `${intDist} m`;
      }
    }

    const speedTenths = Math.round(validSpeed * 10);
    if (speedTenths !== this.lastDisplayedSpeedTenths) {
      this.lastDisplayedSpeedTenths = speedTenths;
      if (this.speedElement) {
        this.speedElement.textContent = `${(speedTenths / 10).toFixed(1)} m/s`;
      }
    }
  }

  public updateHighScore(highScore: number): void {
    const validHigh = isNaN(highScore) ? 0 : Math.max(0, highScore);
    const intHigh = Math.floor(validHigh);
    if (intHigh !== this.lastDisplayedHighScore) {
      this.lastDisplayedHighScore = intHigh;
      if (this.highScoreElement) {
        this.highScoreElement.textContent = `${intHigh} m`;
      }
    }
  }

  public showStart(): void {
    if (this.startModal) {
      this.startModal.classList.add('visible');
    }
  }

  public hideStart(): void {
    if (this.startModal) {
      this.startModal.classList.remove('visible');
    }
  }

  public showPause(): void {
    if (this.pauseModal) {
      this.pauseModal.classList.add('visible');
    }
  }

  public hidePause(): void {
    if (this.pauseModal) {
      this.pauseModal.classList.remove('visible');
    }
  }

  public showGameOver(distance: number, highScore: number, isNewRecord: boolean): void {
    const validDist = isNaN(distance) ? 0 : Math.max(0, distance);
    const validHigh = isNaN(highScore) ? 0 : Math.max(0, highScore);

    if (this.finalStatsElement) {
      this.finalStatsElement.textContent = `You covered ${Math.floor(validDist)} meters! (Best: ${Math.floor(validHigh)} m)`;
    }

    if (this.newRecordBadge) {
      this.newRecordBadge.style.display = isNewRecord ? 'block' : 'none';
    }

    if (this.gameoverModal) {
      this.gameoverModal.classList.add('visible');
    }
  }

  public hideGameOver(): void {
    if (this.gameoverModal) {
      this.gameoverModal.classList.remove('visible');
    }
    if (this.newRecordBadge) {
      this.newRecordBadge.style.display = 'none';
    }
  }

  public dispose(): void {
    if (this.startBtn) {
      this.startBtn.removeEventListener('click', this.onStartClickBound);
    }
    if (this.resumeBtn) {
      this.resumeBtn.removeEventListener('click', this.onResumeClickBound);
    }
    if (this.restartBtn) {
      this.restartBtn.removeEventListener('click', this.onRestartClickBound);
    }
    window.removeEventListener('keydown', this.onKeyDownBound);
  }
}
