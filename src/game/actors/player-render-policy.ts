/**
 * An embedded held object replaces the attachment only when the selected
 * body actually supplies that authored move. Custom bodies may legitimately
 * omit attack animations and fall back to locomotion art.
 */
export function shouldSuppressHeldWeapon(
  embeddedHeldObject: boolean | undefined,
  bodyHasAuthoredAttack: boolean,
): boolean {
  return Boolean(embeddedHeldObject && bodyHasAuthoredAttack);
}

/** Resolve an authored right-facing hitbox offset for the rendered facing. */
export function facingHitboxX(
  spriteWidth: number,
  hitboxX: number,
  hitboxWidth: number,
  facing: 1 | -1,
): number {
  return facing === 1 ? hitboxX : spriteWidth - hitboxX - hitboxWidth;
}
