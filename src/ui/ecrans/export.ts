import { LIBELLES_NATURE, blocages, exporter, exportPossible, verifierFichierExporte, type FormatExport, type Nature } from '../../model/export.ts';
import { allerValidation } from './validation.ts';
import { badge, bouton, carte, encadre } from '../composants.ts';
import { dateLisible, h, remplacer } from '../dom.ts';
import { choisirFichier, telecharger } from '../fichiers.ts';
import { alertesCourantes, apresModification, nomAuteur, notifier, occupe, peut, session } from '../session.ts';

function exporterVers(nature: Nature, format: FormatExport) {
  occupe('Préparation de l’export…', async () => {
    const f = await exporter(session.liste!, session.etat!, alertesCourantes(), session.identite!, nature, format);
    telecharger(f.nomFichier, f.octets, f.type);
    notifier(`Export inscrit au journal : ${f.nomFichier}. Enregistrez aussi la liste chiffrée.`, 'succes');
    await apresModification();
  });
}

function carteVerification() {
  const resultat = h('div');
  return carte(
    'Vérifier un fichier exporté',
    h('p', null, 'Retrouve dans le journal l’export qui correspond exactement à un fichier. Toute retouche du fichier le rend méconnaissable.'),
    bouton('Choisir un fichier exporté…', async () => {
      const f = await choisirFichier('.csv,.xlsx,.ods');
      if (!f) return;
      occupe('Calcul de l’empreinte…', async () => {
        const { empreinte, entree } = await verifierFichierExporte(session.etat!, f.octets);
        remplacer(
          resultat,
          entree
            ? encadre(
                'ok',
                h('strong', null, 'Export authentique. '),
                `${f.nom} correspond à l’export n° ${entree.n}, produit par ${nomAuteur(entree.auteur)} le ${dateLisible(entree.le)}, `,
                `sur un journal de ${entree.contenu.lignesJournal} lignes.`,
              )
            : encadre(
                'erreur',
                h('strong', null, 'Fichier inconnu du journal. '),
                'Il a été modifié après l’export, ou il provient d’une autre liste. ',
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
      !ok && cible && h('button', { type: 'button', class: 'lien', onclick: () => allerValidation(cible) }, ' Y aller'),
    );
  return [
    h('h1', null, 'Export'),
    h(
      'p',
      { class: 'intro' },
      'Chaque export porte l’empreinte du journal et s’inscrit lui-même au journal avec l’empreinte du fichier produit : on peut vérifier plus tard qu’un fichier n’a pas été retouché.',
    ),
    carte(
      'Conditions de la liste finale',
      h(
        'ul',
        { class: 'conditions' },
        etape(b.correctionsEnAttente === 0, b.correctionsEnAttente ? `${b.correctionsEnAttente} correction(s) en attente de validation` : 'Aucune correction en attente', 'correction'),
        etape(b.alertesSansDecision === 0, b.alertesSansDecision ? `${b.alertesSansDecision} alerte(s) sans décision` : 'Toutes les alertes ont une décision', 'alerte'),
        etape(peut('responsable'), peut('responsable') ? 'Vous êtes responsable de la liste' : 'Seul un responsable peut exporter'),
      ),
      h('p', null, `${o.lignes.length} ménages dans l’original, ${o.lignes.length - exclus} inclus, ${exclus} exclu(s).`),
    ),
    h(
      'div',
      { class: 'grille-2' },
      carte(
        'Liste finale',
        h('p', null, 'Ménages inclus, avec les valeurs corrigées et validées. Le CSV est destiné à l’import dans la plateforme de paiement.'),
        possible ? null : encadre('alerte', h('strong', null, 'Export verrouillé'), ' tant que les conditions ne sont pas remplies.'),
        h(
          'div',
          { class: 'ligne' },
          bouton('CSV (paiement)', () => exporterVers('liste', 'csv'), 'principal', !possible),
          bouton('XLSX', () => exporterVers('liste', 'xlsx'), 'secondaire', !possible),
          bouton('ODS (LibreOffice)', () => exporterVers('liste', 'ods'), 'secondaire', !possible),
        ),
      ),
      carte(
        'Rapport des alertes',
        h('p', null, 'Alertes, décisions et corrections, avec une colonne de décision à remplir pour les équipes qui travaillent dans un tableur. Disponible à tout moment.'),
        h(
          'div',
          { class: 'ligne' },
          bouton('XLSX', () => exporterVers('rapport', 'xlsx'), 'principal', !peut('responsable')),
          bouton('ODS (LibreOffice)', () => exporterVers('rapport', 'ods'), 'secondaire', !peut('responsable')),
        ),
      ),
    ),
    etat.exports.length > 0 &&
      carte(
        'Exports déjà produits',
        h(
          'table',
          { class: 'tableau' },
          h('thead', null, h('tr', null, h('th', null, 'N°'), h('th', null, 'Date'), h('th', null, 'Par'), h('th', null, 'Fichier'), h('th', null, 'Empreinte'))),
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
