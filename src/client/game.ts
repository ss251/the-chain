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
// time, so if the scene draws before Baloo 2 / Nunito are decoded, the Day numeral
// and every label flash a system-sans fallback and never recover (Phaser doesn't
// re-render text on a late font load). We therefore force each face to load, wait on
// document.fonts.ready, and only then boot the game. A short timeout guards against a
// font that never resolves so we never hang the webview. Baloo 2 (800) = display,
// Nunito (700/900) = all labels; Fraunces/Plex Mono are retained in the bundle but
// no longer requested.
async function bootWhenFontsReady(parent: string) {
  const fonts = [
    '800 50px "Baloo 2"',
    '700 13px "Nunito"',
    '900 11px "Nunito"',
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
  // hand off from the kindling screen once the scene is painting
  const kindling = document.getElementById('kindling');
  if (kindling) {
    window.setTimeout(() => {
      kindling.classList.add('done');
      window.setTimeout(() => kindling.remove(), 500);
    }, 350);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void bootWhenFontsReady('game-container');
});
