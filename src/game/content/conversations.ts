import { defineConversation } from '@engine/index';

/**
 * Conversations are pure data (see engine/ui/dialogue.ts). Choices can
 * chain into other conversations via `then`.
 */
defineConversation('intro', {
  lines: [
    { speaker: 'VOICE', text: 'ANOTHER KNIGHT. THE ARENA REMEMBERS THEM ALL.' },
    { speaker: 'VOICE', text: 'THE SLIMES COME IN WAVES. THE BATS COME FOR YOUR HEAD.' },
    { speaker: 'VOICE', text: 'STRIKE THRICE FOR THE HEAVY BLOW. DASH THROUGH WHAT YOU CANNOT BLOCK.' },
    { speaker: 'VOICE', text: 'AND WHEN YOUR HANDS BURN... PRESS C. YOU WILL UNDERSTAND.' },
  ],
  choices: [
    { label: 'I AM READY.' },
    { label: 'WHO ARE YOU?', then: 'intro-who' },
  ],
});

defineConversation('intro-who', {
  lines: [
    { speaker: 'VOICE', text: 'THE LAST ONE WHO ASKED IS WAVE SEVEN NOW.' },
    { speaker: 'VOICE', text: 'FIGHT WELL, KNIGHT.' },
  ],
});

/** Importing this module registers the conversations. */
export function registerConversations(): void {}
