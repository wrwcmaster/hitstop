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
    { speaker: 'VOICE', text: 'FIGHT WELL, KNIGHT. THE GATE EAST OPENS TO THE CAVERN, IF THE WAVES BORE YOU.' },
  ],
});

defineConversation('cavern-entry', {
  lines: [
    { speaker: 'VOICE', text: 'THE CAVERN. QUIETER THAN THE ARENA. NOT SAFER.' },
    { speaker: 'VOICE', text: 'SOMETHING OLD AND GREEN SITS ON A THRONE PAST THE EAST GATE.' },
  ],
});

defineConversation('boss-intro', {
  lines: [
    { speaker: 'VOICE', text: 'BOW, OR DO NOT. HE CANNOT TELL.' },
    { speaker: 'SLIME KING', text: '...BLORP.' },
    { speaker: 'VOICE', text: 'WHEN HE SHIVERS, MOVE. WHEN HE BURNS RED, PRAY.' },
  ],
});

defineConversation('merchant-greet', {
  lines: [
    { speaker: 'MERCHANT', text: 'AH. A CUSTOMER WITH A PULSE. RARE, DOWN HERE.' },
    { speaker: 'MERCHANT', text: 'COINS FOR GOODS. GOODS FOR SURVIVING. EVERYONE WINS.' },
  ],
  choices: [
    { label: 'SHOW ME YOUR WARES.' },
    { label: 'WHERE AM I?', then: 'merchant-lore' },
    { label: 'JUST PASSING.' },
  ],
});

defineConversation('merchant-lore', {
  lines: [
    { speaker: 'MERCHANT', text: 'THE CAVERN UNDER THE ARENA. THE KING SITS PAST THE EAST GATE.' },
    { speaker: 'MERCHANT', text: 'HE EATS SWORDS, YOU KNOW. AND THE KNIGHTS HOLDING THEM.' },
    { speaker: 'MERCHANT', text: 'THE LITTLE ONES SPIT NOW TOO. STICKY BUSINESS. BUY A DRAUGHT.' },
  ],
});

defineConversation('victory', {
  lines: [
    { speaker: 'VOICE', text: 'THE CROWN ROLLS. THE THRONE SITS EMPTY.' },
    { speaker: 'VOICE', text: 'YOU ARE WHAT THE ARENA REMEMBERS NOW, KNIGHT.' },
  ],
});

/** Importing this module registers the conversations. */
export function registerConversations(): void {}
