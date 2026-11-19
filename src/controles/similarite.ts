/** Comparaison de noms : normalisation (casse, accents, ordre des mots) et distance d'édition. */

export function normaliserNom(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Distance de Levenshtein, interrompue dès qu'elle dépasse `max`. */
export function distance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const courante = [i];
    let minLigne = i;
    for (let j = 1; j <= b.length; j++) {
      courante[j] = Math.min(precedente[j] + 1, courante[j - 1] + 1, precedente[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      minLigne = Math.min(minLigne, courante[j]);
    }
    if (minLigne > max) return max + 1;
    precedente = courante;
  }
  return precedente[b.length];
}

/** Deux noms sont proches si leurs formes normalisées sont à une distance d'au plus `max`. */
export function nomsProches(a: string, b: string, max: number): boolean {
  const na = normaliserNom(a);
  const nb = normaliserNom(b);
  if (!na || !nb) return false;
  return distance(na, nb, max) <= max;
}

export function normaliserTelephone(tel: string): string {
  const chiffres = tel.replace(/\D/g, '');
  return chiffres.length >= 9 ? chiffres.slice(-9) : '';
}
