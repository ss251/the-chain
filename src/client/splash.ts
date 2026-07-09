import { requestExpandedMode } from '@devvit/web/client';

// The splash is a single invitation: the night, one lit lantern, Enter.
// (No docs/discord template chrome — judges see only the game.)
const startButton = document.getElementById('start-button') as HTMLButtonElement;

startButton.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});
