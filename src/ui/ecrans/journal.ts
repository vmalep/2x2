import { LIBELLES_NATURE } from '../../model/export.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, type Entree } from '../../model/types.ts';
import { encadre } from '../composants.ts';
import { carteConfronterRecu } from './recus.ts';
import { dateLisible, h } from '../dom.ts';
import { nomAuteur, session } from '../session.ts';

function resume(e: Entree): string {
  switch (e.type) {
    case 'ouverture':
      return `Ouverture : ${e.contenu.original.nomFichier}, ${e.contenu.original.nombreLignes} ménages, ${e.contenu.utilisateurs.length} utilisateur(s)`;
    case 'utilisateur':
      return `Déclaration de ${e.contenu.utilisateur.nom} (${e.contenu.utilisateur.roles.join(', ')})`;
    case 'correction':
      return e.contenu.champ === CHAMP_STATUT
        ? `${e.contenu.menage} · statut : ${e.contenu.ancienne} → ${e.contenu.nouvelle} (${e.contenu.motif})`
        : `${e.contenu.menage} · ${e.contenu.champ} : « ${e.contenu.ancienne} » → « ${e.contenu.nouvelle} » (${e.contenu.motif})`;
    case 'decision':
      return `Correction n° ${e.contenu.correction} ${e.contenu.decision === 'acceptee' ? 'acceptée' : 'refusée'}${e.contenu.commentaire ? ` : « ${e.contenu.commentaire} »` : ''}`;
    case 'parametres':
      return `Paramètres des contrôles : seuil de durée ${e.contenu.parametres.seuilDureeMinutes} min, durée max. ${e.contenu.parametres.dureeMaxHeures} h`;
    case 'regles': {
      const actives = e.contenu.regles.filter((r) => r.actif).length;
      return `Règles de contrôle : ${actives} active(s) sur ${e.contenu.regles.length}${e.contenu.source ? `, fichier ${e.contenu.source.nomFichier}` : ''}`;
    }
    case 'decision_alerte': {
      const controle = e.contenu.alerte.split(':')[0];
      const regle = session.etat?.reglesCourantes().find((r) => r.nom === controle);
      return `${regle?.libelle ?? controle} (${e.contenu.menages.join(', ')}) : ${DECISIONS_ALERTE[e.contenu.categorie]?.[e.contenu.decision] ?? e.contenu.decision}${e.contenu.commentaire ? ` · « ${e.contenu.commentaire} »` : ''}`;
    }
    case 'export':
      return `Export : ${LIBELLES_NATURE[e.contenu.nature].toLowerCase()} (${e.contenu.format.toUpperCase()}, ${e.contenu.menages} ligne(s)) : ${e.contenu.nomFichier}${e.contenu.colonnes?.length ? ` · données sorties : ${e.contenu.colonnes.join(', ')}` : ''}`;
  }
}

const TYPES: Record<Entree['type'], string> = {
  ouverture: 'Ouverture',
  utilisateur: 'Utilisateur',
  correction: 'Correction',
  decision: 'Validation',
  parametres: 'Paramètres',
  regles: 'Règles',
  decision_alerte: 'Alerte',
  export: 'Export',
};

export function ecranJournal() {
  const v = session.verification!;
  const journal = session.liste!.journal;
  const erreursParLigne = new Map<number, string[]>();
  for (const e of v.erreurs) if (e.n !== null) erreursParLigne.set(e.n, [...(erreursParLigne.get(e.n) ?? []), e.message]);
  const derniere = journal.at(-1)!;
  return [
    h('h1', null, 'Journal'),
    v.valide
      ? encadre(
          'ok',
          h('strong', null, `Journal intègre : ${journal.length} lignes vérifiées.`),
          ' Chaîne d’empreintes continue, signatures valides, règles respectées.',
          h('p', { class: 'aide' }, 'Dernière empreinte : ', h('code', null, derniere.empreinte)),
        )
      : encadre(
          'erreur',
          h('strong', null, `Altérations détectées (${v.erreurs.length}). Le fichier est en lecture seule.`),
          h('ul', null, v.erreurs.map((e) => h('li', null, e.n === null ? e.message : `Ligne ${e.n} : ${e.message}`))),
          h('p', null, 'Ne poursuivez pas le travail sur ce fichier. Signalez-le au responsable et repartez de la dernière version saine.'),
        ),
    carteConfronterRecu(),
    v.avertissements.length > 0 && encadre('alerte', h('ul', null, v.avertissements.map((e) => h('li', null, `Ligne ${e.n} : ${e.message}`)))),
    h(
      'div',
      { class: 'defilement' },
      h(
        'table',
        { class: 'tableau journal' },
        h('thead', null, h('tr', null, h('th', null, 'N°'), h('th', null, 'Date'), h('th', null, 'Auteur'), h('th', null, 'Type'), h('th', null, 'Contenu'), h('th', null, 'Empreinte'))),
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
              h('td', null, h('code', { title: `Empreinte : ${e.empreinte}\nPrécédente : ${e.precedente}` }, e.empreinte.slice(0, 12) + '…')),
            );
          }),
        ),
      ),
    ),
  ];
}
