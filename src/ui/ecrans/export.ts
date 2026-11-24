import { LIBELLES_NATURE, blocages, exporter, exportPossible, verifierFichierExporte, type FormatExport, type Nature } from '../../model/export.ts';
import { allerValidation } from './validation.ts';
import { badge, bouton, carte, encadre } from '../composants.ts';
import { dateLisible, h, remplacer, tr } from '../dom.ts';
import { choisirFichier, telecharger } from '../fichiers.ts';
import { alertesCourantes, apresModification, nomAuteur, notifier, occupe, peut, session } from '../session.ts';
import { t } from '../../i18n/index.ts';

function exporterVers(nature: Nature, format: FormatExport) {
  occupe(t('export.preparation'), async () => {
    const f = await exporter(session.liste!, session.etat!, alertesCourantes(), session.identite!, nature, format);
    telecharger(f.nomFichier, f.octets, f.type);
    notifier(t('export.inscrit', { fichier: f.nomFichier }), 'succes');
    await apresModification();
  });
}

function carteVerification() {
  const resultat = h('div');
  return carte(
    t('export.verifier'),
    h('p', null, t('export.verifier_texte')),
    bouton(t('export.choisir'), async () => {
      const f = await choisirFichier('.csv,.xlsx,.ods');
      if (!f) return;
      occupe(t('export.calcul'), async () => {
        const { empreinte, entree } = await verifierFichierExporte(session.etat!, f.octets);
        remplacer(
          resultat,
          entree
            ? encadre(
                'ok',
                tr('export.authentique', { fichier: f.nom, n: entree.n, nom: nomAuteur(entree.auteur), date: dateLisible(entree.le), lignes: entree.contenu.lignesJournal }),
              )
            : encadre(
                'erreur',
                tr('export.inconnu'),
                ' ',
                h('code', null, empreinte.slice(0, 16) + '…'),
              ),
        );
      });
    }),
    resultat,
  );
}

export function ecranExport() {
  const etat = session.etat!;
  const alertes = alertesCourantes();
  const b = blocages(etat, alertes);
  const possible = exportPossible(b) && peut('responsable');
  const o = session.liste!.original;
  const iId = o.colonnes.indexOf(o.colonneId);
  const exclus = o.lignes.filter((l) => etat.estExclu(l[iId])).length;
  const etape = (ok: boolean, texte: string, cible?: 'correction' | 'alerte') =>
    h(
      'li',
      { class: ok ? 'ok' : 'ko' },
      h('span', { class: 'marque', 'aria-hidden': 'true' }, ok ? '✓' : '✗'),
      texte,
      !ok && cible && h('button', { type: 'button', class: 'lien', onclick: () => allerValidation(cible) }, t('export.y_aller')),
    );
  return [
    h('h1', null, t('nav.export')),
    h(
      'p',
      { class: 'intro' },
      t('export.intro'),
    ),
    carte(
      t('export.conditions'),
      h(
        'ul',
        { class: 'conditions' },
        etape(b.correctionsEnAttente === 0, b.correctionsEnAttente ? t('export.corrections_attente', { n: b.correctionsEnAttente }) : t('export.aucune_attente'), 'correction'),
        etape(b.alertesSansDecision === 0, b.alertesSansDecision ? t('export.alertes_sans', { n: b.alertesSansDecision }) : t('export.alertes_ok'), 'alerte'),
        etape(peut('responsable'), peut('responsable') ? t('export.responsable') : t('verif.exporter')),
      ),
      h('p', null, t('export.bilan', { total: o.lignes.length, inclus: o.lignes.length - exclus, n: exclus })),
    ),
    h(
      'div',
      { class: 'grille-2' },
      carte(
        t('export.liste_finale'),
        h('p', null, t('export.liste_texte')),
        possible ? null : encadre('alerte', tr('export.verrouille')),
        h(
          'div',
          { class: 'ligne' },
          bouton(t('export.csv'), () => exporterVers('liste', 'csv'), 'principal', !possible),
          bouton('XLSX', () => exporterVers('liste', 'xlsx'), 'secondaire', !possible),
          bouton(t('export.ods'), () => exporterVers('liste', 'ods'), 'secondaire', !possible),
        ),
      ),
      carte(
        t('export.rapport'),
        h('p', null, t('export.rapport_texte')),
        h(
          'div',
          { class: 'ligne' },
          bouton('XLSX', () => exporterVers('rapport', 'xlsx'), 'principal', !peut('responsable')),
          bouton(t('export.ods'), () => exporterVers('rapport', 'ods'), 'secondaire', !peut('responsable')),
        ),
      ),
    ),
    etat.exports.length > 0 &&
      carte(
        t('export.deja'),
        h(
          'table',
          { class: 'tableau' },
          h('thead', null, h('tr', null, h('th', null, t('commun.numero')), h('th', null, t('commun.date')), h('th', null, t('export.par')), h('th', null, t('import.fichier')), h('th', null, t('commun.empreinte')))),
          h(
            'tbody',
            null,
            [...etat.exports].reverse().map((e) =>
              h(
                'tr',
                null,
                h('td', null, String(e.n)),
                h('td', { class: 'nowrap' }, dateLisible(e.le)),
                h('td', null, nomAuteur(e.auteur)),
                h('td', null, e.contenu.nomFichier, ' ', badge(LIBELLES_NATURE[e.contenu.nature].toLowerCase())),
                h('td', null, h('code', { title: e.contenu.empreinteFichier }, e.contenu.empreinteFichier.slice(0, 12) + '…')),
              ),
            ),
          ),
        ),
      ),
    carteVerification(),
  ];
}
