import { LIBELLES_NATURE } from '../../model/export.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, LIBELLES_ROLES, libelleMotif, type Entree } from '../../model/types.ts';
import { encadre } from '../composants.ts';
import { carteConfronterRecu } from './recus.ts';
import { dateLisible, h, tr } from '../dom.ts';
import { nomAuteur, session } from '../session.ts';
import { libelles, t } from '../../i18n/index.ts';

function resume(e: Entree): string {
  switch (e.type) {
    case 'ouverture':
      return t('journal.r_ouverture', { fichier: e.contenu.original.nomFichier, menages: e.contenu.original.nombreLignes, n: e.contenu.utilisateurs.length });
    case 'utilisateur':
      return t('journal.r_utilisateur', { nom: e.contenu.utilisateur.nom, roles: e.contenu.utilisateur.roles.map((r) => LIBELLES_ROLES[r] ?? r).join(', ') });
    case 'correction':
      return e.contenu.champ === CHAMP_STATUT
        ? t('journal.r_statut', { menage: e.contenu.menage, ancienne: libelleStatut(e.contenu.ancienne), nouvelle: libelleStatut(e.contenu.nouvelle), motif: libelleMotif(e.contenu.motif) })
        : t('journal.r_correction', { menage: e.contenu.menage, champ: e.contenu.champ, ancienne: e.contenu.ancienne, nouvelle: e.contenu.nouvelle, motif: libelleMotif(e.contenu.motif) });
    case 'decision':
      return t(e.contenu.decision === 'acceptee' ? 'journal.r_acceptee' : 'journal.r_refusee', { n: e.contenu.correction }) + (e.contenu.commentaire ? t('journal.r_commentaire', { texte: e.contenu.commentaire }) : '');
    case 'parametres':
      return t('journal.r_parametres', { min: e.contenu.parametres.seuilDureeMinutes, max: e.contenu.parametres.dureeMaxHeures });
    case 'regles': {
      const actives = e.contenu.regles.filter((r) => r.actif).length;
      return t('journal.r_regles', { n: actives, total: e.contenu.regles.length }) + (e.contenu.source ? t('journal.r_regles_fichier', { fichier: e.contenu.source.nomFichier }) : '');
    }
    case 'decision_alerte': {
      const controle = e.contenu.alerte.split(':')[0];
      const regle = session.etat?.reglesCourantes().find((r) => r.nom === controle);
      return t('journal.r_decision_alerte', { regle: regle?.libelle ?? controle, menages: e.contenu.menages.join(', '), decision: DECISIONS_ALERTE[e.contenu.categorie]?.[e.contenu.decision] ?? e.contenu.decision }) + (e.contenu.commentaire ? t('journal.r_commentaire_alerte', { texte: e.contenu.commentaire }) : '');
    }
    case 'export':
      return t('journal.r_export', { nature: LIBELLES_NATURE[e.contenu.nature].toLowerCase(), format: e.contenu.format.toUpperCase(), n: e.contenu.menages, fichier: e.contenu.nomFichier }) + (e.contenu.colonnes?.length ? t('journal.r_export_colonnes', { colonnes: e.contenu.colonnes.join(', ') }) : '');
  }
}

/** Statut d'un ménage (code inclus / exclu du journal), tel qu'affiché. */
const libelleStatut = (s: string) => (s === 'exclu' ? t('statut.exclu') : s === 'inclus' ? t('statut.inclus') : s);

const TYPES: Record<Entree['type'], string> = libelles({
  ouverture: 'journal.t_ouverture',
  utilisateur: 'journal.t_utilisateur',
  correction: 'journal.t_correction',
  decision: 'journal.t_decision',
  parametres: 'journal.t_parametres',
  regles: 'journal.t_regles',
  decision_alerte: 'journal.t_decision_alerte',
  export: 'journal.t_export',
});

export function ecranJournal() {
  const v = session.verification!;
  const journal = session.liste!.journal;
  const erreursParLigne = new Map<number, string[]>();
  for (const e of v.erreurs) if (e.n !== null) erreursParLigne.set(e.n, [...(erreursParLigne.get(e.n) ?? []), e.message]);
  const derniere = journal.at(-1)!;
  return [
    h('h1', null, t('nav.journal')),
    v.valide
      ? encadre(
          'ok',
          tr('journal.integre', { n: journal.length }),
          h('p', { class: 'aide' }, tr('journal.derniere', { empreinte: derniere.empreinte })),
        )
      : encadre(
          'erreur',
          h('strong', null, t('journal.alterations', { n: v.erreurs.length })),
          h('ul', null, v.erreurs.map((e) => h('li', null, e.n === null ? e.message : t('journal.ligne_message', { n: e.n ?? '', message: e.message })))),
          h('p', null, t('journal.ne_pas_poursuivre')),
        ),
    carteConfronterRecu(),
    v.avertissements.length > 0 && encadre('alerte', h('ul', null, v.avertissements.map((e) => h('li', null, t('journal.ligne_message', { n: e.n ?? '', message: e.message }))))),
    h(
      'div',
      { class: 'defilement' },
      h(
        'table',
        { class: 'tableau journal' },
        h('thead', null, h('tr', null, h('th', null, t('commun.numero')), h('th', null, t('commun.date')), h('th', null, t('journal.auteur')), h('th', null, t('journal.type')), h('th', null, t('import.contenu')), h('th', null, t('commun.empreinte')))),
        h(
          'tbody',
          null,
          [...journal].reverse().map((e) => {
            const erreurs = erreursParLigne.get(e.n);
            return h(
              'tr',
              { class: erreurs ? 'en-erreur' : '' },
              h('td', null, String(e.n)),
              h('td', { class: 'nowrap' }, dateLisible(e.le)),
              h('td', null, e.type === 'ouverture' ? e.contenu.utilisateurs.find((u) => u.empreinte === e.auteur)?.nom ?? '?' : nomAuteur(e.auteur)),
              h('td', null, TYPES[e.type] ?? e.type),
              h('td', null, resume(e), erreurs && h('div', { class: 'erreur-ligne' }, erreurs.join(' '))),
              h('td', null, h('code', { title: t('journal.empreintes', { empreinte: e.empreinte, precedente: e.precedente }) }, e.empreinte.slice(0, 12) + '…')),
            );
          }),
        ),
      ),
    ),
  ];
}
