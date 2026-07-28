/**
 * Every number that decides how the knight FEELS, in one file — so a
 * tuning pass is a diff of constants, never a hunt through the state
 * machine that consumes them. Mechanics live in player.ts; only values
 * live here.
 */

/**
 * Water feel. Buoyancy beats gravity once you're deep, so the knight
 * bobs to the surface on her own; strokes (jump) kick upward, holding
 * down dives, and a stroke near the surface breaches into a real jump.
 * Armor doesn't rust, but lungs are lungs: `airSeconds` underwater,
 * then `drownDamage` per `drownEvery` until you surface.
 */
export const SWIM = {
  buoyancy: 0.82, // < 1× gravity: slightly heavy, so you sink slowly by default
  dragY: 0.1, // per-second velocity keep factors (heavy water)
  dragX: 0.5,
  swimUp: 520, // px/s² upward while holding jump (ascend)
  dive: 340, // px/s² downward while holding down (dive faster)
  maxRise: 95, // ascent cap while holding jump
  driftSink: 30, // gentle sink cap when not diving — "slowly sinking"
  maxSink: 100, // faster sink cap while holding down
  swimSpeed: 66, // horizontal cap in water (slower than the land runSpeed)
  breachDepth: 0.55, // shallower than this, a jump press launches you out
  airSeconds: 8,
  refillSeconds: 2,
  drownEvery: 1,
  drownDamage: 20, // per drownEvery tick with empty lungs
};

/**
 * The most of any single blow armor may soak. Armor is a flat absorb
 * rating, so without a cap a well-armored knight would be immune to
 * everything small — chip damage would vanish and the damage spread
 * (a bat's 10 vs a boss's 30) would stop mattering. Capping the soak at
 * a fraction of the incoming hit keeps every attack meaningful: heavy
 * blows still land heavier, and no amount of plate makes you untouchable.
 */
export const ARMOR_MAX_SOAK = 0.5;

export const PLAYER_TUNING = {
  runSpeed: 110,
  runAccel: 1400,
  groundFriction: 0.0001,
  airFriction: 0.1,
  // 400 px/s ≈ 53px of rise (v²/2g): enough to reach the 48-50px arena
  // platforms with a little margin. (At the POC's 350 they were 41px —
  // decoratively unreachable.)
  jumpSpeed: 400,
  jumpCutSpeed: 130, // vy clamp when jump is released early
  doubleJumpSpeed: 370, // SKY DANCER's air jump
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  /** How long a down+jump keeps you falling past one-way platforms. */
  dropThroughTime: 0.14,
  attackBufferTime: 0.16,
  dashSpeed: 300,
  dashTime: 0.16,
  dashCooldown: 0.45,
  dashInvuln: 0.2,
  castTime: 0.2, // brief commit while a spell leaves the hand
  castRecoil: 40, // backward brace when a spell fires
  drawMoveMult: 0.45, // drawing a bow you can creep, not sprint
  // Parry: a short deflect window; land a hit inside it and the blow is
  // turned aside, the attacker staggered, and a riposte opened.
  parryWindow: 0.16, // the active guard (hits inside are deflected)
  parryRecovery: 0.22, // committed lag after the window
  parryCooldown: 0.4, // wait after the stance ends before guarding again
  parryIFrames: 0.4, // grace granted on a successful parry
  parryStagger: 0.55, // how long a parried melee attacker is stunned
  riposteTime: 1.3, // window to cash in the empowered counter
  riposteBonus: 60, // extra damage on the riposte swing
  /* ---- Wall Grip ---- */
  // A slow slide rather than a full stop: the knight is holding on, not
  // parked, and the drift tells you the grip is a moment you spend
  // rather than a place you live. No stamina meter — the design brief
  // asks for forgiving, and gravity already sets the clock.
  //
  // Slow enough now that the clock is generous: at 34 a grip bled 34px a
  // second, so hesitating between kicks gave back most of what the last
  // one won. 16 lets you hold a position and pick your moment, which is
  // what makes a climb feel like a decision rather than a scramble.
  clingSlide: 0,
  // Two kicks, chosen by what you are holding at the moment you press.
  //
  // LEAP (neutral, or away from the wall): the old single kick, thrown
  // wide enough to clear a shaft and land the grab on the far side.
  wallJumpX: 190,
  wallJumpY: 300,
  // CLIMB (still holding into the wall): barely any push, most of it up.
  // A wide kick cannot climb one wall — the rise is spent drifting out
  // and steering back, so every grab lands lower than the last. Holding
  // INTO the stone says you mean to go up it, so the kick obliges and
  // only unsticks her. Same verb, two readings, no mode to toggle.
  wallClimbX: 35,
  wallClimbY: 620,
  // Long enough to leave the wall behind while still holding toward it,
  // short enough that the grab on the FAR side still lands. A narrow
  // shaft is the binding case: 32px crossed at wallJumpX takes about
  // 0.17s, so a lock near that swallows the arrival and the climb stalls.
  regripLock: 0.09,
  // How long a touched wall is remembered. Long enough to bridge the
  // frames where resting flush produces no overlap, short enough that
  // leaving one really does end the grip.
  wallStick: 0.12,
  /* ---- Shockwave ---- */
  // Long enough to read as a commitment (you are planting your feet, not
  // flicking a wrist), short enough that it opens a fight rather than
  // ending your turn in one.
  shockwaveTime: 0.3,

  hurtInvuln: 1.1,
  // Health and mana are point pools, not icon counts — 100/60 rather
  // than 5/3 hearts. Big enough that a light graze and a heavy slam can
  // be different numbers (see the damage spread in actors/enemies.ts).
  maxHp: 100,
  maxMp: 60,
};
