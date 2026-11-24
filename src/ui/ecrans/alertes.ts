/**
 * Briques communes aux alertes : décision individuelle (fiche ménage),
 * enquêteur d'un ménage et carte des règles de contrôle (écran Validation).
 */
import { calculerAlertes, type Alerte } from '../../controles/controles.ts';
import { exporterRegles, importerRegles, type FormatRegles, type ReglesImportees } from '../../controles/fichier-regles.ts';
import { detecterColonneGps, pointDepuis, type Point } from '../../controles/geo.ts';
import { detecterColonnes } from '../../controles/parametres.ts';
import { aideType, detecterColonneLien, detecterColonneLienRetour, libelleType, reglesParDefaut, TYPES_REGLES, type Regle } from '../../controles/regles.ts';
import { cellule, corriger, deciderAlerte, signerRegles } from '../../model/journal.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, MOTIFS_CORRECTION, MOTIFS_EXCLUSION, libelleMotif, type ContenuRegles, type Motif } from '../../model/types.ts';
import { badge, bouton, encadre } from '../composants.ts';
import { dateLisible, h } from '../dom.ts';
import { choisirFichier, telecharger } from '../fichiers.ts';
import { apresModification, nomAuteur, notifier, occupe, peut, rafraichir, session } from '../session.ts';
import { t } from '../../i18n/index.ts';

/** Colonne de l'enquêteur : celle de la règle part_enqueteur active, sinon détection automatique. */
let colonneEnqueteurCache: { cle: unknown[]; colonne: string } | null = null;
export function colonneEnqueteur(): string {
  const etat = session.etat!;
  const cle = [etat, etat.regles, etat.parametres];
  if (colonneEnqueteurCache?.cle.every((x, i) => x === cle[i])) return colonneEnqueteurCache.colonne;
  colonneEnqueteurCache = { cle, colonne: calculerColonneEnqueteur() };
  return colonneEnqueteurCache.colonne;
}

function calculerColonneEnqueteur(): string {
  const etat = session.etat!;
  const regle = etat.reglesCourantes().find((r) => r.type === 'part_enqueteur' && r.actif && r.colonne);
  return regle?.colonne ?? detecterColonnes(etat.original.colonnes).enqueteur ?? '';
}

/**
 * Colonne de la date de l'entretien : « start », sinon « today », sinon la colonne de début
 * de la première règle de durée active, sinon la détection automatique.
 */
let colonneDateCache: { cle: unknown[]; colonne: string } | null = null;
export function colonneDate(): string {
  const etat = session.etat!;
  const cle = [etat, etat.regles, etat.parametres];
  if (colonneDateCache?.cle.every((x, i) => x === cle[i])) return colonneDateCache.colonne;
  const cols = etat.original.colonnes;
  const regle = etat.reglesCourantes().find((r) => r.type === 'duree' && r.actif && r.colonne);
  const colonne = cols.includes('start') ? 'start' : cols.includes('today') ? 'today' : (regle?.colonne ?? detecterColonnes(cols).debut ?? '');
  colonneDateCache = { cle, colonne };
  return colonne;
}

/**
 * Jour de l'entretien (AAAA-MM-JJ), tel qu'écrit dans la donnée : heure locale du terrain,
 * sans conversion en UTC (un entretien commencé à 00 h 30 reste sur son jour).
 */
export function jourDe(texte: string): string {
  const t = texte.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
  return '';
}

/** Date et heure brutes de l'entretien (pour trier dans la journée). */
export function horodatageDe(menage: string): string {
  const col = colonneDate();
  return col ? (session.etat!.valeur(menage, col) ?? '').trim() : '';
}

export function jourEntretien(menage: string): string {
  return jourDe(horodatageDe(menage));
}

/** Colonne GPS : celle d'une règle GPS active, sinon la détection automatique. */
export function colonneGps(): string {
  const etat = session.etat!;
  const regle = etat.reglesCourantes().find((r) => (r.type === 'proximite_gps' || r.type === 'gps_groupes' || r.type === 'gps_hors_zone') && r.actif);
  return regle?.colonne ?? detecterColonneGps(etat.original.colonnes) ?? '';
}

/** Colonnes de lien entre ménages (aller : code de l'hôte ; retour : codes des hébergés), d'après les règles actives ou la détection. */
export function colonnesLien(): { aller: string; retour: string } {
  const etat = session.etat!;
  const regle = etat.reglesCourantes().find((r) => (r.type === 'lien' || r.type === 'lien_requis') && r.actif && r.colonne);
  if (regle) return { aller: regle.colonne, retour: regle.colonne2 };
  return { aller: detecterColonneLien(etat.original.colonnes) ?? '', retour: detecterColonneLienRetour(etat.original.colonnes) ?? '' };
}

/** Point GPS d'un ménage (valeurs corrigées), s'il en a un. */
export function pointMenage(menage: string, colonne = colonneGps()): Point | undefined {
  if (!colonne) return undefined;
  return pointDepuis((c) => session.etat!.valeur(menage, c), colonne);
}

export function enqueteurDe(menage: string): string {
  const col = colonneEnqueteur();
  return col ? (session.etat!.valeur(menage, col) ?? '').trim() : '';
}

export function peutDecider(): boolean {
  return peut('validation') || peut('responsable');
}

/**
 * Décision sur une alerte, depuis la fiche d'un ménage. En plus des trois décisions, on peut
 * « confirmer et exclure ce ménage » ou « confirmer et corriger une valeur » : une seule signature
 * enregistre la décision d'alerte ET la proposition d'exclusion ou de correction, qui attend
 * ensuite la validation d'une autre personne (quatre yeux).
 */
export function formulaireDecision(a: Alerte, menage?: string) {
  const etat = session.etat!;
  const d = etat.decisionsAlertes.get(a.id);
  const options = DECISIONS_ALERTE[a.categorie];
  const peutCorriger = peut('correction');
  const statutBloque = menage ? etat.estExclu(menage) || etat.enAttenteParCellule.has(cellule(menage, CHAMP_STATUT)) : true;
  const colonnes = menage ? etat.original.colonnes.filter((c) => c !== etat.original.colonneId && !etat.enAttenteParCellule.has(cellule(menage, c))) : [];

  const commentaire = h('input', { type: 'text', placeholder: t('commun.commentaire'), 'aria-label': t('commun.commentaire') });
  // Sous-formulaire « corriger une valeur » : champ, nouvelle valeur, motif.
  const champ = h('select', { 'aria-label': t('alertes.champ_a_corriger') }, h('option', { value: '' }, t('alertes.choix_champ')), colonnes.map((c) => h('option', { value: c }, c)));
  const valeur = h('input', { type: 'text', placeholder: t('commun.nouvelle_valeur'), 'aria-label': t('commun.nouvelle_valeur') });
  const motifCorrection = h('select', { 'aria-label': t('alertes.motif_correction') }, MOTIFS_CORRECTION.map((m) => h('option', { value: m }, libelleMotif(m))));
  champ.addEventListener('change', () => {
    valeur.value = champ.value && menage ? (etat.valeur(menage, champ.value) ?? '') : '';
    valeur.focus();
  });
  const zoneCorrection = h('div', { class: 'ligne sous-decision', hidden: true }, champ, valeur, motifCorrection);

  const choix = h(
    'select',
    { 'aria-label': t('alertes.decision') },
    h('option', { value: '' }, t('commun.choix_decision')),
    Object.entries(options).map(([v, l]) => h('option', { value: v }, l)),
    menage &&
      peutCorriger &&
      [
        !statutBloque &&
          h(
            'optgroup',
            { label: t('alertes.et_exclure', { decision: options.confirmee }) },
            MOTIFS_EXCLUSION.map((m) => h('option', { value: `exclure:${m}` }, t('alertes.exclure_motif', { motif: libelleMotif(m) }))),
          ),
        colonnes.length > 0 && h('optgroup', { label: t('alertes.et_corriger', { decision: options.confirmee }) }, h('option', { value: 'corriger' }, t('alertes.corriger_valeur'))),
      ],
  );
  const majChoix = () => {
    zoneCorrection.hidden = choix.value !== 'corriger';
    const motive = choix.value !== 'verification_terrain' && choix.value !== '';
    commentaire.placeholder = motive ? t('commun.commentaire_obligatoire') : t('commun.commentaire');
  };
  choix.addEventListener('change', majChoix);

  const signer = () => {
    const v = choix.value;
    if (!v) return notifier(t('commun.choisir_decision'), 'erreur');
    if (v !== 'verification_terrain' && !commentaire.value.trim()) {
      commentaire.focus();
      return notifier(t('commun.decision_motivee'), 'erreur');
    }
    const exclusion = v.startsWith('exclure:') ? v.slice('exclure:'.length) : '';
    if (v === 'corriger') {
      if (!champ.value) return notifier(t('alertes.choisir_champ'), 'erreur');
      if (valeur.value === (etat.valeur(menage!, champ.value) ?? '')) return notifier(t('alertes.identique'), 'erreur');
    }
    const decision = exclusion || v === 'corriger' ? 'confirmee' : v;
    const texte = commentaire.value.trim();
    occupe(t('commun.signature'), async () => {
      await deciderAlerte(session.liste!, etat, session.identite!, { alerte: a.id, categorie: a.categorie, menages: a.menages, decision, commentaire: texte });
      session.decisionsDepuisRecu++;
      if (exclusion) {
        await corriger(session.liste!, etat, session.identite!, {
          menage: menage!,
          champ: CHAMP_STATUT,
          ancienne: etat.valeur(menage!, CHAMP_STATUT) ?? 'inclus',
          nouvelle: 'exclu',
          motif: exclusion as Motif,
          commentaire: texte,
        });
      } else if (v === 'corriger') {
        await corriger(session.liste!, etat, session.identite!, {
          menage: menage!,
          champ: champ.value,
          ancienne: etat.valeur(menage!, champ.value) ?? '',
          nouvelle: valeur.value,
          motif: motifCorrection.value as Motif,
          commentaire: texte,
        });
      }
      notifier(
        exclusion
          ? t('alertes.signee_exclusion')
          : v === 'corriger'
            ? t('alertes.signee_correction')
            : t('alertes.signee'),
        'succes',
      );
      await apresModification();
    });
  };
  return h(
    'div',
    { class: 'formulaire-decision' },
    h('div', { class: 'actions' }, choix, commentaire, bouton(d ? t('alertes.reviser') : t('alertes.signer_decision'), signer, d ? 'secondaire' : 'principal')),
    zoneCorrection,
  );
}

/** Fichier de règles importé, en attente de signature (aperçu). */
let apercu: ReglesImportees | undefined;
let regleOuverte = false;

function tableauRegles(regles: Regle[], alertes?: Alerte[]) {
  const compte = (nom: string) => alertes?.filter((a) => a.controle === nom).length;
  return h(
    'div',
    { class: 'defilement' },
    h(
      'table',
      { class: 'tableau regles' },
      h(
        'thead',
        null,
        h('tr', null, [t('regles.col_actif'), t('import.col_nom'), t('regles.col_libelle'), t('journal.type'), t('regles.col_colonnes'), 'Min', 'Max', t('regles.col_liste'), alertes ? t('regles.col_alertes') : ''].map((t) => h('th', null, t))),
      ),
      h(
        'tbody',
        null,
        regles.map((r) =>
          h(
            'tr',
            { class: r.actif ? '' : 'inactive' },
            h('td', null, r.actif ? '✓' : '—'),
            h('td', null, h('code', null, r.nom)),
            h('td', null, r.libelle),
            h('td', { title: r.type in TYPES_REGLES ? aideType(r.type) : '' }, r.type in TYPES_REGLES ? libelleType(r.type) : r.type),
            h('td', null, [r.colonne, r.colonne2].filter(Boolean).join(' → ')),
            h('td', null, r.min),
            h('td', null, r.max),
            h('td', null, r.liste),
            h('td', null, alertes && r.actif ? String(compte(r.nom) ?? 0) : ''),
          ),
        ),
      ),
    ),
  );
}

export function carteRegles(alertes: Alerte[]) {
  const etat = session.etat!;
  const colonnes = session.liste!.original.colonnes;
  const regles = etat.reglesCourantes();
  const responsable = peut('responsable');
  const signe = etat.regles;
  const exporter = (format: FormatRegles) =>
    occupe(t('regles.preparation'), async () => {
      const f = await exporterRegles(regles, colonnes, format);
      telecharger(`regles_2x2.${format}`, f.octets, f.type);
    });
  const importer = async () => {
    const f = await choisirFichier('.xlsx,.ods,.csv');
    if (!f) return;
    await occupe(t('regles.lecture'), async () => {
      apercu = await importerRegles(f.octets, f.nom, colonnes);
      regleOuverte = true;
      rafraichir();
    });
  };
  const signer = (nouvelles: Regle[], source: ContenuRegles['source'], message: string) =>
    occupe(t('regles.signature'), async () => {
      await signerRegles(session.liste!, etat, session.identite!, { regles: nouvelles, source });
      apercu = undefined;
      notifier(message, 'succes');
      await apresModification();
    });

  return h(
    'details',
    { class: 'carte regles-controle', open: regleOuverte || !!apercu },
    h(
      'summary',
      { onclick: () => (regleOuverte = !regleOuverte) },
      h('strong', null, t('regles.titre')),
      badge(t('regles.actives', { n: regles.filter((r) => r.actif).length }), 'neutre'),
      signe ? badge(t('regles.signees'), 'ok') : etat.parametres ? badge(t('regles.anciens'), 'neutre') : badge(t('regles.defaut'), 'neutre'),
    ),
    h(
      'p',
      { class: 'aide' },
      signe
        ? t(signe.contenu.source ? 'regles.signe_fichier' : 'regles.signe', { nom: nomAuteur(signe.auteur), date: dateLisible(signe.le), fichier: signe.contenu.source?.nomFichier ?? '' })
        : t('regles.auto'),
      ' ' + t('regles.modifier'),
    ),
    tableauRegles(regles, alertes),
    h(
      'div',
      { class: 'ligne' },
      bouton(t('regles.exporter_xlsx'), () => exporter('xlsx')),
      bouton(t('regles.exporter_ods'), () => exporter('ods')),
      bouton(t('regles.exporter_csv'), () => exporter('csv')),
      responsable && bouton(t('regles.importer'), importer, 'principal'),
    ),
    !responsable && h('p', { class: 'aide' }, t('regles.seul_responsable')),
    apercu &&
      h(
        'div',
        { class: 'apercu-regles' },
        h('h3', null, t('regles.apercu', { fichier: apercu.nomFichier })),
        apercu.erreurs.length
          ? encadre(
              'erreur',
              h('strong', null, t('regles.refuse', { n: apercu.erreurs.length })),
              h('ul', null, apercu.erreurs.map((e) => h('li', null, e))),
            )
          : [
              tableauRegles(apercu.regles),
              (() => {
                const nouvellesAlertes = calculerAlertes(etat, apercu.regles);
                return encadre(
                  'info',
                  t('regles.effet', { n: nouvellesAlertes.length, actuel: alertes.length }),
                );
              })(),
            ],
        h(
          'div',
          { class: 'ligne' },
          !apercu.erreurs.length &&
            bouton(t('regles.signer'), () => {
              const a = apercu!;
              signer(a.regles, { nomFichier: a.nomFichier, empreinteFichier: a.empreinteFichier }, t('regles.signees_notif', { n: a.regles.length }));
            }, 'principal'),
          bouton(t('commun.annuler'), () => {
            apercu = undefined;
            rafraichir();
          }),
        ),
      ),
    responsable &&
      signe &&
      h(
        'div',
        { class: 'ligne' },
        bouton(t('regles.revenir'), () => {
          if (!confirm(t('regles.revenir_confirmer'))) return;
          signer(reglesParDefaut(colonnes, session.liste!.original.lignes), null, t('regles.defaut_signees'));
        }),
      ),
  );
}
