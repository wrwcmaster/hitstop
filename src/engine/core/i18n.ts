/**
 * Localization, gettext-style: the source (English) string IS the key.
 * `t('New game')` looks the string up in the active locale's table and
 * returns it unchanged when there's no entry — so untranslated content
 * degrades to English instead of to key soup, and authoring stays
 * "write the English inline, translate later".
 *
 * Templates carry their variables through translation:
 *   t('Wave {n}', { n: 3 })  →  zh table maps 'Wave {n}' → '第{n}波'
 *
 * Engine UI (menus, dialogue) translates at render time, so switching
 * locale mid-game repaints everything live — no rebuild step. Dynamic
 * pre-formatted strings simply miss the table and pass through.
 */
export interface LocaleDef {
  /** Native-script display name for pickers ('English', '中文'). */
  name: string;
  /** source string (or template) → translation. */
  strings: Record<string, string>;
}

const locales = new Map<string, LocaleDef>();
let current = 'en';

/** The source language: implicit, always available, empty table. */
locales.set('en', { name: 'English', strings: {} });

export function defineLocale(id: string, def: LocaleDef): void {
  locales.set(id, def);
}

export function localeIds(): string[] {
  return [...locales.keys()];
}

export function localeName(id: string): string {
  return locales.get(id)?.name ?? id;
}

export function locale(): string {
  return current;
}

export function setLocale(id: string): void {
  if (locales.has(id)) current = id;
}

/** Translate + interpolate. Unknown strings pass through untouched. */
export function t(source: string, vars?: Record<string, string | number>): string {
  let out = locales.get(current)?.strings[source] ?? source;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}
