import { defineConversation } from '@engine/index';

/**
 * Conversations are pure data (see engine/ui/dialogue.ts). Choices can
 * chain into other conversations via `then`. Dialogue is written in
 * sentence case; speaker names stay uppercase as headers.
 */
defineConversation('intro', {
  lines: [
    { speaker: 'VOICE', text: 'Another knight. The arena remembers them all.' },
    { speaker: 'VOICE', text: 'The slimes come in waves. The bats come for your head.' },
    { speaker: 'VOICE', text: 'Strike thrice for the heavy blow. Dash through what you cannot block.' },
    { speaker: 'VOICE', text: 'And when your hands burn... press C. You will understand.' },
  ],
  choices: [
    { label: 'I am ready.' },
    { label: 'Who are you?', then: 'intro-who' },
  ],
});

defineConversation('intro-who', {
  lines: [
    { speaker: 'VOICE', text: 'The last one who asked is wave seven now.' },
    { speaker: 'VOICE', text: 'Fight well, knight. The gate east opens to the cavern, if the waves bore you.' },
  ],
});

defineConversation('cavern-entry', {
  lines: [
    { speaker: 'VOICE', text: 'The cavern. Quieter than the arena. Not safer.' },
    { speaker: 'VOICE', text: 'Something old and green sits on a throne past the east gate.' },
  ],
});

defineConversation('boss-intro', {
  lines: [
    { speaker: 'VOICE', text: 'Bow, or do not. He cannot tell.' },
    { speaker: 'SLIME KING', text: '...Blorp.' },
    { speaker: 'VOICE', text: 'When he shivers, move. When he burns red, pray.' },
  ],
});

defineConversation('merchant-greet', {
  lines: [
    { speaker: 'MERCHANT', text: 'Ah. A customer with a pulse. Rare, down here.' },
    { speaker: 'MERCHANT', text: 'Coins for goods. Goods for surviving. Everyone wins.' },
  ],
  choices: [
    { label: 'Show me your wares.' },
    { label: 'Where am I?', then: 'merchant-lore' },
    { label: 'Just passing.' },
  ],
});

defineConversation('merchant-lore', {
  lines: [
    { speaker: 'MERCHANT', text: 'The cavern under the arena. The king sits past the east gate.' },
    { speaker: 'MERCHANT', text: 'He eats swords, you know. And the knights holding them.' },
    { speaker: 'MERCHANT', text: 'And he spits. Sticky business, that. A draught burns it right off.' },
  ],
});

defineConversation('victory', {
  lines: [
    { speaker: 'VOICE', text: 'The crown rolls. The throne sits empty.' },
    { speaker: 'VOICE', text: 'You are what the arena remembers now, knight.' },
  ],
});

/** Importing this module registers the conversations. */
export function registerConversations(): void {}
