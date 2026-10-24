import type { DifficultyPreset } from '../config';
import type { LeaderboardEntry } from '../input/InputManager';

export class HUD {
  // Top HUD elements
  private playerBadgeElement: HTMLElement | null;
  private distElement: HTMLElement | null;
  private speedElement: HTMLElement | null;
  private highScoreElement: HTMLElement | null;
  private scoreElement: HTMLElement | null;
  private multiplierElement: HTMLElement | null;
  private multiplierBarElement: HTMLElement | null;
  private collectiblesElement: HTMLElement | null;
  private pickupToastElement: HTMLElement | null;

  // 3-2-1 Countdown overlay elements
  private countdownOverlay: HTMLElement | null;
  private countdownNumber: HTMLElement | null;
  private countdownSubtitle: HTMLElement | null;
  private countdownDetails: HTMLElement | null;

  // Hands-free balance board hold bars
  private startBoardHoldBar: HTMLElement | null;
  private gameoverBoardHoldBar: HTMLElement | null;

  // Modals & action buttons
  private startModal: HTMLElement | null;
  private startBtn: HTMLElement | null;
  private pauseModal: HTMLElement | null;
  private resumeBtn: HTMLElement | null;
  private gameoverModal: HTMLElement | null;
  private finalStatsElement: HTMLElement | null;
  private restartBtn: HTMLElement | null;
  private newRecordBadge: HTMLElement | null;

  // Player & Difficulty controls
  private playerNameInput: HTMLInputElement | null;
  private playerPills: NodeListOf<HTMLButtonElement>;
  private diffPills: NodeListOf<HTMLButtonElement>;
  private leaderboardList: HTMLElement | null;
  private gameoverLeaderboardList: HTMLElement | null;
  private remoteUrlText: HTMLElement | null;

  // Cached display values to avoid layout thrashing and DOM writes every frame
  private lastDisplayedDist = -1;
  private lastDisplayedSpeedTenths = -1;
  private lastDisplayedHighScore = -1;
  private lastDisplayedScore = -1;
  private lastDisplayedMultiplierTenths = -1;
  private lastDisplayedApples = -1;
  private lastDisplayedHorseshoes = -1;
  private lastDisplayedBarPct = -1;
  private lastDisplayedBoardHoldPct = -1;
  private lastDisplayedCountdownSec = -1;

  private toastTimeoutId: number | null = null;

  // Callbacks
  public onStart?: () => void;
  public onResume?: () => void;
  public onRestart?: () => void;
  public onSelectPlayer?: (name: string) => void;
  public onSelectDifficulty?: (diff: DifficultyPreset) => void;

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
    this.playerBadgeElement = document.getElementById('hud-player');
    this.distElement = document.getElementById('hud-distance');
    this.speedElement = document.getElementById('hud-speed');
    this.highScoreElement = document.getElementById('hud-high-score');
    this.scoreElement = document.getElementById('hud-score');
    this.multiplierElement = document.getElementById('hud-multiplier');
    this.multiplierBarElement = document.getElementById('hud-multiplier-bar');
    this.collectiblesElement = document.getElementById('hud-collectibles');
    this.pickupToastElement = document.getElementById('hud-pickup-toast');

    this.countdownOverlay = document.getElementById('countdown-overlay');
    this.countdownNumber = document.getElementById('countdown-number');
    this.countdownSubtitle = document.getElementById('countdown-subtitle');
    this.countdownDetails = document.getElementById('countdown-details');

    this.startBoardHoldBar = document.getElementById('start-board-hold-bar');
    this.gameoverBoardHoldBar = document.getElementById('gameover-board-hold-bar');

    this.startModal = document.getElementById('start-modal');
    this.startBtn = document.getElementById('start-btn');

    this.pauseModal = document.getElementById('pause-modal');
    this.resumeBtn = document.getElementById('resume-btn');

    this.gameoverModal = document.getElementById('gameover-modal');
    this.finalStatsElement = document.getElementById('final-stats');
    this.restartBtn = document.getElementById('restart-btn');
    this.newRecordBadge = document.getElementById('new-record-badge');

    this.playerNameInput = document.getElementById('player-name-input') as HTMLInputElement | null;
    this.playerPills = document.querySelectorAll('.player-pill');
    this.diffPills = document.querySelectorAll('.diff-pill');
    this.leaderboardList = document.getElementById('leaderboard-list');
    this.gameoverLeaderboardList = document.getElementById('gameover-leaderboard-list');
    this.remoteUrlText = document.getElementById('remote-url-text');

    // Display actual remote companion URL based on current host
    if (this.remoteUrlText && typeof window !== 'undefined') {
      const host = window.location.hostname || 'localhost';
      const port = window.location.port ? `:${window.location.port}` : '';
      this.remoteUrlText.textContent = `http://${host}${port}/remote.html`;
    }

    if (this.startBtn) {
      this.startBtn.addEventListener('click', this.onStartClickBound);
    }
    if (this.resumeBtn) {
      this.resumeBtn.addEventListener('click', this.onResumeClickBound);
    }
    if (this.restartBtn) {
      this.restartBtn.addEventListener('click', this.onRestartClickBound);
    }

    // Wire player selector pills
    this.playerPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const name = pill.getAttribute('data-player');
        if (name) {
          this.setPlayerName(name);
          this.onSelectPlayer?.(name);
        }
      });
    });

    // Wire player name text input
    if (this.playerNameInput) {
      this.playerNameInput.addEventListener('input', () => {
        const name = this.playerNameInput?.value.trim() || 'Rider 1';
        this.playerPills.forEach((p) => {
          p.classList.toggle('active', p.getAttribute('data-player') === name);
        });
        this.onSelectPlayer?.(name);
      });
    }

    // Wire difficulty selector pills
    this.diffPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const diff = pill.getAttribute('data-diff') as DifficultyPreset | null;
        if (diff) {
          this.setDifficulty(diff);
          this.onSelectDifficulty?.(diff);
        }
      });
    });

    window.addEventListener('keydown', this.onKeyDownBound);
  }

  public setPlayerName(name: string): void {
    if (this.playerNameInput && this.playerNameInput.value !== name) {
      this.playerNameInput.value = name;
    }
    this.playerPills.forEach((p) => {
      p.classList.toggle('active', p.getAttribute('data-player') === name);
    });
  }

  public setDifficulty(diff: DifficultyPreset): void {
    this.diffPills.forEach((p) => {
      p.classList.toggle('active', p.getAttribute('data-diff') === diff);
    });
  }

  public updatePlayerBadge(playerName: string, difficulty: string): void {
    if (this.playerBadgeElement) {
      const formattedDiff = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
      this.playerBadgeElement.textContent = `🏇 ${playerName} · ${formattedDiff}`;
    }
  }

  public showCountdown(seconds: number, playerName: string, diff: string): void {
    if (this.countdownOverlay) {
      this.countdownOverlay.classList.add('visible');
    }
    this.updateCountdown(seconds, playerName, diff);
  }

  public updateCountdown(seconds: number, playerName: string, diff: string): void {
    const formattedDiff = diff.charAt(0).toUpperCase() + diff.slice(1);
    const roundedCeil = Math.ceil(seconds);

    if (roundedCeil !== this.lastDisplayedCountdownSec) {
      this.lastDisplayedCountdownSec = roundedCeil;
      if (this.countdownNumber) {
        if (seconds <= 0.4) {
          this.countdownNumber.textContent = 'RIDE!';
          this.countdownNumber.style.color = '#34d399';
        } else {
          this.countdownNumber.textContent = roundedCeil.toString();
          this.countdownNumber.style.color = '#38bdf8';
        }
      }
    }

    if (this.countdownSubtitle) {
      this.countdownSubtitle.textContent = `Get Ready, ${playerName}! · Step onto the Balance Board`;
    }
    if (this.countdownDetails) {
      this.countdownDetails.textContent = `${formattedDiff.toUpperCase()} DIFFICULTY`;
    }
  }

  public hideCountdown(): void {
    if (this.countdownOverlay) {
      this.countdownOverlay.classList.remove('visible');
    }
    this.lastDisplayedCountdownSec = -1;
  }

  public updateBoardHoldProgress(progress: number): void {
    const validProgress = Math.max(0, Math.min(1.0, progress));
    const pct = Math.round(validProgress * 100);

    if (pct !== this.lastDisplayedBoardHoldPct) {
      this.lastDisplayedBoardHoldPct = pct;
      if (this.startBoardHoldBar) {
        this.startBoardHoldBar.style.width = `${pct}%`;
      }
      if (this.gameoverBoardHoldBar) {
        this.gameoverBoardHoldBar.style.width = `${pct}%`;
      }
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  public updateLeaderboard(entries: LeaderboardEntry[]): void {
    const topEntries = entries.slice(0, 5);
    const html = topEntries
      .map((entry, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const safeName = this.escapeHtml(entry.name || 'Rider');
        const diffBadge = entry.difficulty ? ` (${this.escapeHtml(entry.difficulty)})` : '';
        return `
          <div class="leaderboard-row">
            <span class="lb-rank">${medal}</span>
            <span class="lb-name">${safeName}${diffBadge}</span>
            <span class="lb-score">${entry.score.toLocaleString()} pts</span>
            <span class="lb-dist">${entry.distance.toLocaleString()}m</span>
          </div>
        `;
      })
      .join('');

    if (this.leaderboardList) {
      this.leaderboardList.innerHTML = html;
    }
    if (this.gameoverLeaderboardList) {
      this.gameoverLeaderboardList.innerHTML = html;
    }
  }

  public update(
    distance: number,
    speed: number,
    score?: number,
    multiplier?: number,
    multiplierProgress?: number,
    apples?: number,
    horseshoes?: number
  ): void {
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

    if (score !== undefined) {
      const intScore = Math.floor(Math.max(0, score));
      if (intScore !== this.lastDisplayedScore) {
        this.lastDisplayedScore = intScore;
        if (this.scoreElement) {
          this.scoreElement.textContent = `${intScore.toLocaleString()} pts`;
        }
      }
    }

    if (multiplier !== undefined) {
      const multTenths = Math.round(multiplier * 10);
      if (multTenths !== this.lastDisplayedMultiplierTenths) {
        this.lastDisplayedMultiplierTenths = multTenths;
        if (this.multiplierElement) {
          this.multiplierElement.textContent = `${(multTenths / 10).toFixed(1)}x`;
        }
      }
    }

    if (multiplierProgress !== undefined) {
      const barPct = Math.round(Math.max(0, Math.min(1, multiplierProgress)) * 100);
      if (barPct !== this.lastDisplayedBarPct) {
        this.lastDisplayedBarPct = barPct;
        if (this.multiplierBarElement) {
          this.multiplierBarElement.style.width = `${barPct}%`;
        }
      }
    }

    if (apples !== undefined && horseshoes !== undefined) {
      if (apples !== this.lastDisplayedApples || horseshoes !== this.lastDisplayedHorseshoes) {
        this.lastDisplayedApples = apples;
        this.lastDisplayedHorseshoes = horseshoes;
        if (this.collectiblesElement) {
          this.collectiblesElement.textContent = `🍎 ${apples}  🧲 ${horseshoes}`;
        }
      }
    }
  }

  public triggerPickupFeedback(type: 'apple' | 'horseshoe', multiplier: number, bonusPoints: number): void {
    if (!this.pickupToastElement) return;

    if (this.toastTimeoutId !== null) {
      window.clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }

    const icon = type === 'apple' ? '🍎' : '🧲';
    const multStep = type === 'apple' ? '+0.2x' : '+0.5x';
    this.pickupToastElement.textContent = `${icon} ${multStep} (${multiplier.toFixed(1)}x · +${bonusPoints} pts)`;
    this.pickupToastElement.classList.add('show');

    this.toastTimeoutId = window.setTimeout(() => {
      this.pickupToastElement?.classList.remove('show');
      this.toastTimeoutId = null;
    }, 1200);
  }

  public updateHighScore(highScore: number): void {
    const validHigh = isNaN(highScore) ? 0 : Math.max(0, highScore);
    const intHigh = Math.floor(validHigh);
    if (intHigh !== this.lastDisplayedHighScore) {
      this.lastDisplayedHighScore = intHigh;
      if (this.highScoreElement) {
        this.highScoreElement.textContent = `${intHigh.toLocaleString()} pts`;
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

  public showGameOver(
    distance: number,
    highScore: number,
    isNewRecord: boolean,
    score?: number,
    apples?: number,
    horseshoes?: number
  ): void {
    const validDist = isNaN(distance) ? 0 : Math.max(0, distance);
    const validHigh = isNaN(highScore) ? 0 : Math.max(0, highScore);

    if (this.finalStatsElement) {
      if (score !== undefined) {
        const validScore = isNaN(score) ? 0 : Math.max(0, score);
        this.finalStatsElement.textContent = `Score: ${Math.floor(validScore).toLocaleString()} pts · Distance: ${Math.floor(validDist)} m · 🍎 ${apples ?? 0} · 🧲 ${horseshoes ?? 0} (Best: ${Math.floor(validHigh).toLocaleString()} pts)`;
      } else {
        this.finalStatsElement.textContent = `You covered ${Math.floor(validDist)} meters! (Best: ${Math.floor(validHigh)} pts)`;
      }
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
    if (this.toastTimeoutId !== null) {
      window.clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = null;
    }
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
