/**
 * Choix des colonnes affichées dans un tableau (Correction, Validation). Simple confort d'affichage :
 * le choix est gardé dans ce navigateur, pour chaque liste ; il ne change rien aux données.
 */
import { bouton } from './composants.ts';
import { h } from './dom.ts';

export interface OptionColonne {
  cle: string;
  libelle: string;
  groupe: string;
  /** Toujours affichée (nécessaire au fonctionnement du tableau). */
  obligatoire?: boolean;
}

function lire(cle: string): string[] | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(cle) ?? 'null');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : undefined;
  } catch {
    return undefined;
  }
}

function ecrire(cle: string, valeur: string[] | undefined) {
  try {
    if (valeur) localStorage.setItem(cle, JSON.stringify(valeur));
    else localStorage.removeItem(cle);
  } catch {
    /* stockage indisponible : le choix vaudra pour cette séance seulement */
  }
}

const memoire = new Map<string, string[]>();
const ouverts = new Set<string>();

/**
 * Colonnes visibles (dans l'ordre choisi, réglable par ↑ ↓) et le bouton + panneau pour les choisir.
 * `surChangement` est appelé après chaque modification (redessiner l'écran).
 */
export function choixColonnes(cleStockage: string, options: OptionColonne[], defaut: string[], surChangement: () => void) {
  const connues = new Set(options.map((o) => o.cle));
  const libelle = new Map(options.map((o) => [o.cle, o.libelle]));
  /** Colonnes visibles, DANS L'ORDRE choisi ; les colonnes obligatoires manquantes sont ajoutées. */
  const ordre = (): string[] => {
    const brut = (memoire.get(cleStockage) ?? lire(cleStockage) ?? defaut).filter((c, i, t) => connues.has(c) && t.indexOf(c) === i);
    for (const o of options) if (o.obligatoire && !brut.includes(o.cle)) brut.unshift(o.cle);
    return brut;
  };
  const choisies = () => new Set(ordre());
  const visibles = () => ordre();
  const enregistrer = (liste: string[] | Set<string> | undefined) => {
    const valeur = liste ? [...liste] : undefined;
    if (valeur) memoire.set(cleStockage, valeur);
    else memoire.delete(cleStockage);
    ecrire(cleStockage, valeur);
    surChangement();
  };

  const groupes = [...new Set(options.map((o) => o.groupe))];
  const set = choisies();
  const panneau = h(
    'div',
    { class: 'carte panneau-colonnes', hidden: !ouverts.has(cleStockage) },
    h('div', { class: 'ligne' }, h('span', { class: 'titre-barre neutre' }, 'Colonnes affichées'), h('span', { class: 'discret' }, 'Le choix est gardé dans ce navigateur, pour cette liste.')),
    groupes.map((g) =>
      h(
        'fieldset',
        { class: 'groupe-colonnes' },
        h('legend', null, g),
        options
          .filter((o) => o.groupe === g)
          .map((o) =>
            h(
              'label',
              { class: 'case' },
              h('input', {
                type: 'checkbox',
                checked: set.has(o.cle),
                disabled: !!o.obligatoire,
                'aria-label': `Afficher la colonne ${o.libelle}`,
                onchange: (e: Event) => {
                  const l = ordre().filter((c) => c !== o.cle);
                  // Une colonne ajoutée se place à la fin ; on la déplace ensuite avec ↑ ↓.
                  if ((e.target as HTMLInputElement).checked) l.push(o.cle);
                  enregistrer(l);
                },
              }),
              o.libelle,
            ),
          ),
      ),
    ),
    h('h3', { class: 'titre-ordre' }, 'Ordre des colonnes'),
    h(
      'ol',
      { class: 'ordre-colonnes' },
      ordre().map((cle, i, t) =>
        h(
          'li',
          null,
          h('span', null, libelle.get(cle) ?? cle),
          h(
            'button',
            {
              type: 'button',
              class: 'bouton petit',
              'aria-label': `Monter la colonne ${libelle.get(cle) ?? cle}`,
              disabled: i === 0,
              onclick: () => {
                const l = [...t];
                [l[i - 1], l[i]] = [l[i], l[i - 1]];
                enregistrer(l);
              },
            },
            '↑',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'bouton petit',
              'aria-label': `Descendre la colonne ${libelle.get(cle) ?? cle}`,
              disabled: i === t.length - 1,
              onclick: () => {
                const l = [...t];
                [l[i + 1], l[i]] = [l[i], l[i + 1]];
                enregistrer(l);
              },
            },
            '↓',
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'ligne' },
      bouton('Colonnes par défaut', () => enregistrer(undefined)),
      bouton('Fermer', () => {
        ouverts.delete(cleStockage);
        panneau.hidden = true;
      }),
    ),
  );
  const ouvrir = bouton('Colonnes…', () => {
    ouverts.has(cleStockage) ? ouverts.delete(cleStockage) : ouverts.add(cleStockage);
    panneau.hidden = !ouverts.has(cleStockage);
  });
  ouvrir.title = 'Choisir les colonnes affichées dans le tableau';
  return { visibles, ouvrir, panneau };
}
