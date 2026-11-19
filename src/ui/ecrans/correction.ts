import { cellule, corriger, type CorrectionSuivie } from '../../model/journal.ts';
import { LIBELLES_CONTROLES } from '../../controles/controles.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, MOTIFS, type Motif } from '../../model/types.ts';
import { badge, bouton, encadre } from '../composants.ts';
import { dateLisible, h, remplacer } from '../dom.ts';
import { alertesCourantes, aller, apresModification, nomAuteur, notifier, occupe, peut, session } from '../session.ts';

const PAR_PAGE = 50;
const COLONNES_TECHNIQUES = /^(_|start$|end$|today$|deviceid$|meta\/|formhub\/|donnees_fictives$)/;

// État de l'écran conservé entre deux rendus.
const vue = { recherche: '', filtre: 'tous' as 'tous' | 'modifies' | 'attente' | 'exclus' | 'alertes', page: 0 };

function statutMenage(menage: string): 'attente' | 'modifie' | undefined {
  const etat = session.etat!;
  for (const c of etat.enAttente()) if (c.entree.contenu.menage === menage) return 'attente';
  return etat.modifications.has(menage) ? 'modifie' : undefined;
}

export function historiqueMenage(menage: string): CorrectionSuivie[] {
  return [...session.etat!.corrections.values()].filter((c) => c.entree.contenu.menage === menage).reverse();
}

export function statutCorrection(c: CorrectionSuivie) {
  return c.statut === 'en_attente' ? badge('en attente', 'attente') : c.statut === 'acceptee' ? badge('acceptée', 'ok') : badge('refusée', 'refus');
}

export function ligneHistorique(c: CorrectionSuivie) {
  const e = c.entree;
  return h(
    'li',
    { class: 'historique' },
    h('div', { class: 'entete-historique' }, h('strong', null, e.contenu.champ === CHAMP_STATUT ? 'Statut du ménage' : e.contenu.champ), statutCorrection(c), h('span', { class: 'discret' }, `n° ${e.n}`)),
    h('div', { class: 'diff' }, h('del', null, e.contenu.ancienne || '(vide)'), ' → ', h('ins', null, e.contenu.nouvelle || '(vide)')),
    h('div', { class: 'discret' }, `${e.contenu.motif} · ${nomAuteur(e.auteur)} · ${dateLisible(e.le)}`),
    e.contenu.commentaire && h('div', { class: 'commentaire' }, `« ${e.contenu.commentaire} »`),
    c.decision &&
      h(
        'div',
        { class: 'discret' },
        `${c.statut === 'acceptee' ? 'Acceptée' : 'Refusée'} par ${nomAuteur(c.decision.auteur)} · ${dateLisible(c.decision.le)}`,
        c.decision.contenu.commentaire && ` · « ${c.decision.contenu.commentaire} »`,
      ),
  );
}

export function ecranCorrection() {
  const { liste, etat } = session;
  const o = liste!.original;
  const iId = o.colonnes.indexOf(o.colonneId);
  const visibles = [o.colonneId, ...o.colonnes.filter((c) => c !== o.colonneId && !COLONNES_TECHNIQUES.test(c)).slice(0, 6)];
  const peutCorriger = peut('correction');

  const zoneTable = h('div', { class: 'zone-table' });
  const zoneFiche = h('aside', { class: 'fiche' });

  const alertes = alertesCourantes();
  const alertesParMenage = new Map<string, typeof alertes>();
  for (const a of alertes) for (const m of a.menages) alertesParMenage.set(m, [...(alertesParMenage.get(m) ?? []), a]);

  function menagesFiltres(): string[] {
    const q = vue.recherche.trim().toLowerCase();
    return o.lignes
      .map((l) => l[iId])
      .filter((id) => {
        const s = statutMenage(id);
        if (vue.filtre === 'modifies' && s !== 'modifie') return false;
        if (vue.filtre === 'attente' && s !== 'attente') return false;
        if (vue.filtre === 'exclus' && !etat!.estExclu(id)) return false;
        if (vue.filtre === 'alertes' && !alertesParMenage.has(id)) return false;
        if (!q) return true;
        return visibles.some((c) => (etat!.valeur(id, c) ?? '').toLowerCase().includes(q));
      });
  }

  function dessinerTable() {
    const ids = menagesFiltres();
    const pages = Math.max(1, Math.ceil(ids.length / PAR_PAGE));
    vue.page = Math.min(vue.page, pages - 1);
    const page = ids.slice(vue.page * PAR_PAGE, (vue.page + 1) * PAR_PAGE);
    remplacer(
      zoneTable,
      h(
        'div',
        { class: 'defilement' },
        h(
          'table',
          { class: 'tableau cliquable' },
          h('thead', null, h('tr', null, visibles.map((c) => h('th', null, c)), h('th', null, 'État'))),
          h(
            'tbody',
            null,
            page.map((id) => {
              const s = statutMenage(id);
              return h(
                'tr',
                {
                  class: id === session.menageSelectionne ? 'selection' : '',
                  tabindex: 0,
                  onclick: () => selectionner(id),
                  onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && selectionner(id),
                },
                visibles.map((c) => {
                  const modifie = etat!.modifications.get(id)?.has(c);
                  return h('td', { class: modifie ? 'modifie' : '' }, etat!.valeur(id, c) ?? '');
                }),
                h(
                  'td',
                  { class: 'badges' },
                  etat!.estExclu(id) && badge('exclu', 'refus'),
                  s === 'attente' ? badge('en attente', 'attente') : s === 'modifie' ? badge('corrigé', 'ok') : '',
                  alertesParMenage.has(id) &&
                    badge(
                      alertesParMenage.get(id)!.some((a) => a.categorie === 'protection') ? 'protection' : 'alerte',
                      alertesParMenage.get(id)!.some((a) => a.categorie === 'protection') ? 'protection' : 'alerte',
                    ),
                ),
              );
            }),
          ),
        ),
      ),
      h(
        'div',
        { class: 'pagination' },
        h('span', { class: 'discret' }, `${ids.length} ménage(s)`),
        bouton('‹', () => {
          vue.page--;
          dessinerTable();
        }, 'secondaire', vue.page === 0),
        h('span', null, `Page ${vue.page + 1} / ${pages}`),
        bouton('›', () => {
          vue.page++;
          dessinerTable();
        }, 'secondaire', vue.page >= pages - 1),
      ),
    );
  }

  function selectionner(id: string) {
    session.menageSelectionne = id;
    dessinerTable();
    dessinerFiche();
  }

  function formulaire(id: string, champ: string, ligne: HTMLElement) {
    const ancienne = etat!.valeur(id, champ) ?? '';
    const statut = champ === CHAMP_STATUT;
    const nouvelle = statut
      ? h('input', { type: 'hidden', value: ancienne === 'exclu' ? 'inclus' : 'exclu' })
      : h('input', { type: 'text', value: ancienne, 'aria-label': 'Nouvelle valeur' });
    const protection = statut && ancienne === 'inclus' && (alertesParMenage.get(id) ?? []).some((a) => a.categorie === 'protection');
    const engagement = h('input', { type: 'checkbox', id: `engagement-${id}` });
    const motif = h(
      'select',
      { 'aria-label': 'Motif', required: true },
      h('option', { value: '' }, '— Motif (obligatoire) —'),
      MOTIFS.map((m) => h('option', { value: m }, m)),
    );
    const commentaire = h('textarea', { rows: 2, placeholder: 'Commentaire', 'aria-label': 'Commentaire' });
    const form = h(
      'form',
      {
        class: 'form-correction',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (!motif.value) return notifier('Choisissez un motif.', 'erreur');
          if (statut && !commentaire.value.trim()) return notifier('Expliquez la raison en commentaire.', 'erreur');
          if (protection && !engagement.checked) return notifier('Confirmez que l’exclusion ne repose pas sur le repérage protection.', 'erreur');
          occupe('Signature de la correction…', async () => {
            await corriger(liste!, etat!, session.identite!, {
              menage: id,
              champ,
              ancienne,
              nouvelle: nouvelle.value,
              motif: motif.value as Motif,
              commentaire: commentaire.value.trim(),
            });
            notifier('Correction signée. Elle attend la validation d’une autre personne.', 'succes');
            await apresModification();
          });
        },
      },
      statut
        ? h('div', null, h('strong', null, ancienne === 'exclu' ? 'Proposer la réintégration du ménage' : 'Proposer l’exclusion du ménage'), h('div', { class: 'discret' }, 'La proposition devra être validée par une autre personne.'))
        : h('div', { class: 'discret' }, 'Valeur actuelle : ', h('strong', null, ancienne || '(vide)')),
      protection &&
        encadre(
          'alerte',
          h('strong', null, 'Repérage protection sur ce ménage. '),
          'La règle : orienter, jamais exclure pour ce motif.',
          h('label', { class: 'case', for: `engagement-${id}` }, engagement, ' L’exclusion repose sur un autre motif, précisé en commentaire.'),
        ),
      nouvelle,
      motif,
      commentaire,
      h(
        'div',
        { class: 'ligne' },
        h('button', { type: 'submit', class: 'bouton principal' }, 'Signer la correction'),
        bouton('Annuler', () => dessinerFiche()),
      ),
    );
    ligne.after(form);
    ligne.querySelector('button')?.setAttribute('disabled', '');
    if (statut) motif.focus();
    else {
      nouvelle.focus();
      nouvelle.select();
    }
  }

  function ligneStatut(id: string) {
    const exclu = etat!.estExclu(id);
    const attente = etat!.enAttenteParCellule.has(cellule(id, CHAMP_STATUT));
    const ligne = h(
      'div',
      { class: `statut-menage${exclu ? ' exclu' : ''}` },
      h('span', null, 'Statut : ', h('strong', null, exclu ? 'exclu de la liste finale' : 'inclus')),
      attente && badge('changement en attente', 'attente'),
      peutCorriger && !attente && bouton(exclu ? 'Proposer la réintégration' : 'Proposer l’exclusion', () => formulaire(id, CHAMP_STATUT, ligne), exclu ? 'secondaire' : 'danger'),
    );
    return ligne;
  }

  function blocAlertes(id: string) {
    const liste = alertesParMenage.get(id);
    if (!liste?.length) return null;
    return h(
      'ul',
      { class: 'alertes-menage' },
      liste.map((a) => {
        const d = etat!.decisionsAlertes.get(a.id);
        return h(
          'li',
          { class: a.categorie },
          h('strong', null, LIBELLES_CONTROLES[a.controle]),
          ' — ',
          a.message,
          ' ',
          d ? badge(DECISIONS_ALERTE[d.contenu.categorie][d.contenu.decision], 'neutre') : badge('sans décision', 'attente'),
        );
      }),
      h('li', { class: 'lien-alertes' }, h('button', { type: 'button', class: 'lien', onclick: () => aller('alertes') }, 'Voir l’écran Alertes')),
    );
  }

  function dessinerFiche() {
    const id = session.menageSelectionne;
    if (!id || !etat!.indexMenages.has(id)) {
      remplacer(zoneFiche, h('p', { class: 'vide' }, 'Choisissez un ménage dans la liste pour voir sa fiche.'));
      return;
    }
    const historique = historiqueMenage(id);
    remplacer(
      zoneFiche,
      h('h2', null, `Ménage ${id}`),
      !peutCorriger && encadre('info', 'Lecture seule : vous n’avez pas le rôle « Correction » dans cette liste.'),
      ligneStatut(id),
      blocAlertes(id),
      h(
        'dl',
        { class: 'champs-menage' },
        o.colonnes.map((c) => {
          const valeur = etat!.valeur(id, c) ?? '';
          const iLigne = etat!.indexMenages.get(id)!;
          const origine = o.lignes[iLigne][o.colonnes.indexOf(c)];
          const attente = etat!.enAttenteParCellule.has(cellule(id, c));
          const ligne = h(
            'div',
            { class: 'champ-menage' },
            h('dt', null, c),
            h(
              'dd',
              null,
              h('span', { class: 'valeur' }, valeur || h('span', { class: 'discret' }, '(vide)')),
              valeur !== origine && h('del', { class: 'origine', title: 'Valeur de l’original' }, origine || '(vide)'),
              attente && badge('en attente', 'attente'),
              peutCorriger && c !== o.colonneId && !attente && bouton('Corriger', () => formulaire(id, c, ligne)),
            ),
          );
          return ligne;
        }),
      ),
      h('h3', null, 'Historique des corrections'),
      historique.length ? h('ul', { class: 'liste-historique' }, historique.map(ligneHistorique)) : h('p', { class: 'discret' }, 'Aucune correction.'),
    );
  }

  const recherche = h('input', {
    type: 'search',
    placeholder: 'Rechercher (identifiant, nom, village…)',
    value: vue.recherche,
    'aria-label': 'Rechercher',
    oninput: (e: Event) => {
      vue.recherche = (e.target as HTMLInputElement).value;
      vue.page = 0;
      dessinerTable();
    },
  });
  const filtre = h(
    'select',
    {
      'aria-label': 'Filtrer',
      onchange: (e: Event) => {
        vue.filtre = (e.target as HTMLSelectElement).value as typeof vue.filtre;
        vue.page = 0;
        dessinerTable();
      },
    },
    h('option', { value: 'tous', selected: vue.filtre === 'tous' }, 'Tous les ménages'),
    h('option', { value: 'attente', selected: vue.filtre === 'attente' }, 'Corrections en attente'),
    h('option', { value: 'modifies', selected: vue.filtre === 'modifies' }, 'Ménages corrigés'),
    h('option', { value: 'alertes', selected: vue.filtre === 'alertes' }, 'Ménages avec alerte'),
    h('option', { value: 'exclus', selected: vue.filtre === 'exclus' }, 'Ménages exclus'),
  );

  dessinerTable();
  dessinerFiche();
  return [
    h('h1', null, 'Correction'),
    h('div', { class: 'barre-outils' }, recherche, filtre),
    h('div', { class: 'deux-panneaux' }, zoneTable, zoneFiche),
  ];
}
