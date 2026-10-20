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

/**
 * Keep an attached sprite on the same authored-pixel lattice as its body.
 *
 * Anchors may be fractional because they describe a landmark inside a pixel
 * cluster. Their difference must not become a fractional draw origin: doing
 * so shifts every texel in the attachment relative to the body's texels and
 * produces the recurring half-pixel seam seen in composite previews.
 */
export function snapAttachmentOriginToBodyGrid(
  desired: { x: number; y: number },
  bodyOrigin: { x: number; y: number },
  pixelsPerLogicalUnit = 1,
): { x: number; y: number } {
  if (!Number.isFinite(pixelsPerLogicalUnit) || pixelsPerLogicalUnit <= 0) {
    throw new Error('attachment grid density must be a positive finite number');
  }
  const snap = (value: number, origin: number): number => {
    const scaled = (value - origin) * pixelsPerLogicalUnit;
    // Math.round() is asymmetric at negative half steps (`-0.5 -> -0`).
    // Round the magnitude so mirrored attachments choose mirrored texels.
    const cell = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
    return origin + cell / pixelsPerLogicalUnit;
  };
  return {
    x: snap(desired.x, bodyOrigin.x),
    y: snap(desired.y, bodyOrigin.y),
  };
}

/** Place a reference body over an attachment exactly as runtime places it. */
export function snappedBodyOffsetForAttachment(
  bodyAnchor: { x: number; y: number },
  attachmentAnchor: { x: number; y: number },
  pixelsPerLogicalUnit = 1,
): { x: number; y: number } {
  const attachmentOrigin = snapAttachmentOriginToBodyGrid({
    x: bodyAnchor.x - attachmentAnchor.x,
    y: bodyAnchor.y - attachmentAnchor.y,
  }, { x: 0, y: 0 }, pixelsPerLogicalUnit);
  return {
    x: attachmentOrigin.x === 0 ? 0 : -attachmentOrigin.x,
    y: attachmentOrigin.y === 0 ? 0 : -attachmentOrigin.y,
  };
}

/** Resolve a logical body state through a weapon family's authored profile. */
export function resolveWeaponBodyAnimation(
  type: { bodyAnimations?: Readonly<Record<string, string | { animation: string }>> },
  logicalAnimation: string,
  hasAnimation: (name: string) => boolean,
): string {
  const entry = type.bodyAnimations?.[logicalAnimation];
  const mapped = typeof entry === 'string' ? entry : entry?.animation;
  return mapped && hasAnimation(mapped) ? mapped : logicalAnimation;
}

/** Recover the logical state that selected an authored body-profile animation. */
export function logicalAnimationForResolvedBodyAnimation(
  type: { bodyAnimations?: Readonly<Record<string, string | { animation: string }>> },
  resolvedAnimation: string,
): string {
  for (const [logical, entry] of Object.entries(type.bodyAnimations ?? {})) {
    const mapped = typeof entry === 'string' ? entry : entry.animation;
    if (mapped === resolvedAnimation) return logical;
  }
  return resolvedAnimation;
}

export function bodyAnimationEmbedsHeldObject(
  type: { bodyAnimations?: Readonly<Record<string, string | { animation: string; embeddedHeldObject?: boolean }>> },
  logicalAnimation: string,
  resolvedAnimation: string,
): boolean {
  const entry = type.bodyAnimations?.[logicalAnimation];
  return typeof entry === 'object'
    && entry.animation === resolvedAnimation
    && entry.embeddedHeldObject === true;
}
