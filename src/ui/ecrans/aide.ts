/** Écran Aide : le mode d'emploi, étape par étape, accessible à tout moment (même sans clé ni liste). */
import { modele, t, type Cle } from '../../i18n/index.ts';
import { h, riche, tr, type Enfant } from '../dom.ts';

/**
 * Contenu d'une section : des paragraphes (p) et des listes (ol, ul). Le texte vient des
 * dictionnaires ; dans une liste, chaque ligne du texte est un élément.
 */
type Bloc = ['p' | 'ol' | 'ul', Cle];

interface Section {
  id: string;
  contenu: Bloc[];
}

const SECTIONS: Section[] = [
  { id: 'principe', contenu: [['p', 'aide.principe.p1'], ['ul', 'aide.principe.ul1']] },
  { id: 'roles', contenu: [['ul', 'aide.roles.ul1'], ['p', 'aide.roles.p1']] },
  { id: 'cles', contenu: [['ol', 'aide.cles.ol1'], ['p', 'aide.cles.p1']] },
  { id: 'creer', contenu: [['ol', 'aide.creer.ol1'], ['p', 'aide.creer.p1']] },
  { id: 'corriger', contenu: [['ol', 'aide.corriger.ol1']] },
  { id: 'regles', contenu: [['p', 'aide.regles.p1'], ['p', 'aide.regles.p2'], ['ol', 'aide.regles.ol1'], ['p', 'aide.regles.p3']] },
  { id: 'valider', contenu: [['p', 'aide.valider.p1'], ['ol', 'aide.valider.ol1'], ['ul', 'aide.valider.ul1'], ['p', 'aide.valider.p2']] },
  { id: 'terrain', contenu: [['p', 'aide.terrain.p1'], ['ol', 'aide.terrain.ol1'], ['p', 'aide.terrain.p2'], ['ol', 'aide.terrain.ol2']] },
  { id: 'gps', contenu: [['ul', 'aide.gps.ul1']] },
  { id: 'circuler', contenu: [['ol', 'aide.circuler.ol1'], ['ul', 'aide.circuler.ul1']] },
  { id: 'exporter', contenu: [['p', 'aide.exporter.p1'], ['ul', 'aide.exporter.ul1']] },
  { id: 'journal', contenu: [['ul', 'aide.journal.ul1']] },
  { id: 'problemes', contenu: [['ul', 'aide.problemes.ul1']] },
];

function bloc([type, cle]: Bloc): Enfant {
  if (type === 'p') return h('p', null, tr(cle));
  return h(type, null, modele(cle).split('\n').map((ligne) => h('li', null, riche(ligne))));
}

const titre = (s: Section) => t(`aide.${s.id}.titre` as Cle);

export function ecranAide() {
  return [
    h('h1', null, t('aide.titre')),
    h('p', { class: 'intro' }, t('aide.intro')),
    h(
      'nav',
      { class: 'sommaire-aide', 'aria-label': t('aide.sommaire') },
      h(
        'ul',
        null,
        SECTIONS.map((s) =>
          h(
            'li',
            null,
            h('button', { type: 'button', class: 'lien', onclick: () => document.getElementById(`aide-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }) }, titre(s)),
          ),
        ),
      ),
    ),
    SECTIONS.map((s) => h('section', { class: 'carte aide-section', id: `aide-${s.id}` }, h('h2', null, titre(s)), s.contenu.map(bloc))),
  ];
}
