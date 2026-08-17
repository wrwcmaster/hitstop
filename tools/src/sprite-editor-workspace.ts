export interface WorkspaceRenderTag {
  id: string;
  label: string;
}

export function validateRenderTagDefs(candidate: unknown): asserts candidate is WorkspaceRenderTag[] {
  if (!Array.isArray(candidate) || !candidate.length) throw new Error('render tags need a non-empty array');
  const ids = new Set<string>();
  for (const raw of candidate) {
    const tag = raw as Partial<WorkspaceRenderTag>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || typeof tag.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(tag.id)
      || typeof tag.label !== 'string' || !tag.label.trim() || ids.has(tag.id)) {
      throw new Error('render tags need unique lowercase ids and non-empty labels');
    }
    ids.add(tag.id);
  }
}

export function isValidRenderTagDefs(candidate: unknown): candidate is WorkspaceRenderTag[] {
  try {
    validateRenderTagDefs(candidate);
    return true;
  } catch {
    return false;
  }
}

export function validateWeaponCombatTuning(candidate: unknown): void {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('weapon combat tuning must be an object');
  }
  const movePattern = /^(combo\d+|aerial|plunge|upper|dashAttack)$/;
  for (const [typeId, rawProfile] of Object.entries(candidate)) {
    if (!/^[a-z][a-z0-9-]*$/.test(typeId)
      || !rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
      throw new Error('weapon combat tuning needs lowercase weapon-type ids');
    }
    const profile = rawProfile as { fps?: unknown; moves?: unknown };
    if (typeof profile.fps !== 'number' || !Number.isFinite(profile.fps) || profile.fps <= 0) {
      throw new Error(`weapon combat tuning "${typeId}" needs a positive shared fps`);
    }
    if (!profile.moves || typeof profile.moves !== 'object' || Array.isArray(profile.moves)) {
      throw new Error(`weapon combat tuning "${typeId}" needs a moves object`);
    }
    for (const [moveId, rawEntry] of Object.entries(profile.moves as Record<string, unknown>)) {
      if (!movePattern.test(moveId)
        || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
        throw new Error(`weapon combat tuning has invalid move "${typeId}.${moveId}"`);
      }
      const entry = rawEntry as { frameCount?: unknown; activeFrames?: unknown; hitbox?: unknown };
      if (!Number.isInteger(entry.frameCount) || Number(entry.frameCount) < 1) {
        throw new Error(`weapon combat tuning "${typeId}.${moveId}" needs a positive frameCount`);
      }
      if (!Array.isArray(entry.activeFrames) || entry.activeFrames.length !== 2
        || entry.activeFrames.some((value) => !Number.isInteger(value))) {
        throw new Error(`weapon combat tuning "${typeId}.${moveId}" needs activeFrames [start, end]`);
      }
      const [start, end] = entry.activeFrames as number[];
      if (start < 1 || start > end || end > Number(entry.frameCount)) {
        throw new Error(`weapon combat tuning "${typeId}.${moveId}" needs 1 <= active start <= active end <= frameCount`);
      }
      if (!entry.hitbox || typeof entry.hitbox !== 'object' || Array.isArray(entry.hitbox)) {
        throw new Error(`weapon combat tuning "${typeId}.${moveId}" needs a hitbox`);
      }
      const hitbox = entry.hitbox as Record<string, unknown>;
      for (const field of ['forward', 'y', 'w', 'h']) {
        if (typeof hitbox[field] !== 'number' || !Number.isFinite(hitbox[field])) {
          throw new Error(`weapon combat tuning "${typeId}.${moveId}" hitbox.${field} must be finite`);
        }
      }
      if ((hitbox.w as number) <= 0 || (hitbox.h as number) <= 0) {
        throw new Error(`weapon combat tuning "${typeId}.${moveId}" hitbox size must be positive`);
      }
    }
  }
}

export function isValidWeaponCombatTuning(candidate: unknown): boolean {
  try {
    validateWeaponCombatTuning(candidate);
    return true;
  } catch {
    return false;
  }
}
