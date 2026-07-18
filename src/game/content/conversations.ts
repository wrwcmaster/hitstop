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
    { label: 'Show me your wares.', action: 'shop' },
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
    { speaker: 'VOICE', text: 'The seal on the east road is broken. The town is waking up.' },
  ],
});

/* ---------------- the town ---------------- */

defineConversation('town-entry', {
  lines: [
    { speaker: 'VOICE', text: 'The town. It slept while the king sat fat below.' },
    { speaker: 'VOICE', text: 'A healer, a smith, an elder with troubles - and a portal, humming east.' },
  ],
});

defineConversation('healer-greet', {
  lines: [
    { speaker: 'HEALER', text: 'Sit. You are more wound than knight.' },
    { speaker: 'HEALER', text: 'Ten gold and I will close all of it.' },
  ],
  choices: [
    { label: 'Heal me. (10g)', action: 'heal' },
    { label: 'Not now.' },
  ],
});

defineConversation('blacksmith-greet', {
  lines: [
    { speaker: 'BLACKSMITH', text: 'That edge would bounce off warm bread.' },
    { speaker: 'BLACKSMITH', text: 'Gold and fire fix most things. Swords especially.' },
  ],
  choices: [
    { label: 'Upgrade my weapon.', action: 'forge' },
    { label: 'Maybe later.' },
  ],
});

/* Elder quest states: offer → in progress → complete → done. The
 * `questGiver` role picks the conversation by quest state, and reacts to
 * the choices' `action` ids (see actors/npc-roles.ts). */
defineConversation('elder-offer', {
  lines: [
    { speaker: 'ELDER', text: 'Knight. The king is dead, but his spawn still choke the arena.' },
    { speaker: 'ELDER', text: 'Cull five slimes and the town will not forget it.' },
  ],
  choices: [
    { label: 'I will help.', action: 'quest:accept' },
    { label: 'Not my problem.' },
  ],
});

defineConversation('elder-progress', {
  lines: [
    { speaker: 'ELDER', text: 'The slimes still squelch out there. The portal will take you to the arena.' },
  ],
});

defineConversation('elder-complete', {
  lines: [
    { speaker: 'ELDER', text: 'The squelching has stopped. The town breathes easier.' },
    { speaker: 'ELDER', text: 'Take this - and our thanks.' },
  ],
  choices: [{ label: 'Claim reward.', action: 'quest:claim' }],
});

defineConversation('elder-done', {
  lines: [
    { speaker: 'ELDER', text: 'Rest, knight. The town owes you its quiet.' },
  ],
});

defineConversation('grotto-entry', {
  lines: [
    { speaker: 'VOICE', text: 'The grotto drowned long before the king grew fat.' },
    { speaker: 'VOICE', text: 'Breathe at the surface. Dive with down. And watch your bubbles, knight.' },
  ],
});

/** Importing this module registers the conversations. */
export function registerConversations(): void {}
