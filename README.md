# hitstop

Hitstop is a 2D action game engine built on one belief: game feel isn't polish you add at the end, it's the foundation you build on. Frame-freeze hitstop, trauma-based screenshake, directional camera kicks, hit-flash, particle bursts, and synthesized SFX are all first-class, composable primitives — available to every entity from day one.
Right now it's a single zero-dependency HTML file with a fixed-timestep loop, an event bus, pluggable systems, and an entity registry. The included wave-survival game is built entirely on the public primitives, and new enemies take about 20 lines. That's deliberate: the long-term goal is a full Metroidvania-scale action game in the spirit of Hollow Knight, and every layer added along the way has to keep combat feeling this good.
