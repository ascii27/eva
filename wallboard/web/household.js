// Who lives here. From DESIGN.md: always shown with name or initials, never
// colour alone. `id` is what chores and schedule entries carry in `who`.

export const PEOPLE = {
  mariko: { name: 'Mariko', ini: 'Ma', bg: 'var(--ma-bg)', fg: 'var(--ma-fg)', kid: true },
  sarina: { name: 'Sarina', ini: 'Sa', bg: 'var(--sa-bg)', fg: 'var(--sa-fg)', kid: true },
  nozomi: { name: 'Nozomi', ini: 'No', bg: 'var(--warm)', fg: 'var(--on-warm)', kid: false },
  michael: { name: 'Michael', ini: 'Mi', bg: 'var(--cool)', fg: 'var(--on-cool)', kid: false },
};

export const ORDER = ['mariko', 'sarina', 'nozomi', 'michael'];

/** Someone the board doesn't know yet still gets a readable chip. */
export function person(id) {
  if (id && PEOPLE[id]) return PEOPLE[id];
  const name = id ? id[0].toUpperCase() + id.slice(1) : 'Anyone';
  return { name, ini: name.slice(0, 2), bg: 'var(--surface-300)', fg: 'var(--ink)', kid: false };
}
