import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { Game as MainGame } from './scenes/Game';
import { MainMenu } from './scenes/MainMenu';
import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { Preloader } from './scenes/Preloader';

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#0b0b10',
  scale: {
    // Keep a fixed game resolution but automatically scale it to fit within the available
    // web-view / device while maintaining aspect ratio.
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1024,
    height: 768,
  },
  scene: [Boot, Preloader, MainMenu, MainGame, GameOver],
};

const StartGame = (parent: string) => {
  return new Game({ ...config, parent });
};

// Self-hosted fonts are declared `font-display: block` in game.css and only start
// loading once we request them. Phaser rasterises text into a canvas at creation
// time, so if the scene draws before Fraunces / IBM Plex Mono are decoded, the
// numeral and every system line flash a system-sans fallback and never recover
// (Phaser doesn't re-render text on a late font load). We therefore force each face
// to load, wait on document.fonts.ready, and only then boot the game. A short
// timeout guards against a font that never resolves so we never hang the webview.
async function bootWhenFontsReady(parent: string) {
  const fonts = [
    '900 64px "Fraunces"',
    '400 24px "IBM Plex Mono"',
    '700 24px "IBM Plex Mono"',
  ];
  try {
    if (document.fonts && typeof document.fonts.load === 'function') {
      await Promise.race([
        Promise.all([
          ...fonts.map((f) => document.fonts.load(f)),
          document.fonts.ready,
        ]),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    }
  } catch (err) {
    console.error('font preload failed, booting with fallbacks', err);
  }
  StartGame(parent);
}

document.addEventListener('DOMContentLoaded', () => {
  void bootWhenFontsReady('game-container');
});
