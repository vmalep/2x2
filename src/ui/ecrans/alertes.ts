import { LIBELLES_CONTROLES, type Alerte, type Controle } from '../../controles/controles.ts';
import { LIBELLES_COLONNES, parametresParDefaut } from '../../controles/parametres.ts';
import { deciderAlerte, fixerParametres } from '../../model/journal.ts';
import { DECISIONS_ALERTE, type ColonnesControles, type Parametres } from '../../model/types.ts';
import { badge, bouton, champ, encadre } from '../composants.ts';
import { dateLisible, h } from '../dom.ts';
import { alertesCourantes, aller, apresModification, moi, nomAuteur, notifier, occupe, parametresCourants, peut, rafraichir, session } from '../session.ts';

const vue = { categorie: 'toutes' as 'toutes' | 'integrite' | 'protection', statut: 'sans_decision' as 'sans_decision' | 'decidees' | 'toutes' };

function peutDecider(): boolean {
  return peut('validation') || peut('responsable');
}

function carteAlerte(a: Alerte) {
  const etat = session.etat!;
  const d = etat.decisionsAlertes.get(a.id);
  const options = DECISIONS_ALERTE[a.categorie];
  const choix = h(
    'select',
    { 'aria-label': 'Décision' },
    h('option', { value: '' }, '— Décision —'),
    Object.entries(options).map(([v, l]) => h('option', { value: v }, l)),
  );
  const commentaire = h('input', { type: 'text', placeholder: 'Commentaire', 'aria-label': 'Commentaire' });
  const signer = () => {
    if (!choix.value) return notifier('Choisissez une décision.', 'erreur');
    occupe('Signature de la décision…', async () => {
      await deciderAlerte(session.liste!, etat, session.identite!, {
        alerte: a.id,
        categorie: a.categorie,
        menages: a.menages,
        decision: choix.value,
        commentaire: commentaire.value.trim(),
      });
      notifier('Décision signée et journalisée.', 'succes');
      await apresModification();
    });
  };
  return h(
    'article',
    { class: `carte-alerte ${a.categorie}${d ? ' decidee' : ''}` },
    h(
      'header',
      null,
      badge(a.categorie === 'protection' ? 'Protection' : 'Intégrité', a.categorie === 'protection' ? 'protection' : 'alerte'),
      h('strong', null, LIBELLES_CONTROLES[a.controle]),
    ),
    h('p', null, a.message),
    h(
      'div',
      { class: 'menages' },
      a.menages.map((m) =>
        h(
          'button',
          {
            type: 'button',
            class: 'lien',
            onclick: () => {
              session.menageSelectionne = m;
              aller('correction');
            },
          },
          m,
        ),
      ),
    ),
    a.categorie === 'protection' && h('p', { class: 'aide' }, 'Orienter, jamais exclure un ménage pour ce motif.'),
    d &&
      h(
        'div',
        { class: 'decision' },
        badge(options[d.contenu.decision] ?? d.contenu.decision, 'ok'),
        h('span', { class: 'discret' }, ` ${nomAuteur(d.auteur)}, ${dateLisible(d.le)}`),
        d.contenu.commentaire && h('div', { class: 'commentaire' }, `« ${d.contenu.commentaire} »`),
      ),
    peutDecider() &&
      h(
        'div',
        { class: 'actions' },
        choix,
        commentaire,
        bouton(d ? 'Réviser la décision' : 'Signer la décision', signer, d ? 'secondaire' : 'principal'),
      ),
  );
}

/** Brouillon de paramètres conservé entre deux rendus, tant que le journal n'a pas changé. */
let brouillonGarde: { cle: string; parametres: Parametres } | undefined;

function carteParametres() {
  const cle = session.liste!.journal.at(-1)!.empreinte;
  const colonnes = session.liste!.original.colonnes;
  const responsable = peut('responsable');
  const enCours = brouillonGarde?.cle === cle;
  const brouillon: Parametres = enCours ? brouillonGarde!.parametres : structuredClone(parametresCourants());
  brouillonGarde = { cle, parametres: brouillon };
  const nombre = (cle: keyof Omit<Parametres, 'colonnes'>, libelle: string, aide: string, pas = '1') =>
    champ(
      libelle,
      h('input', {
        type: 'number',
        min: '0',
        step: pas,
        value: String(brouillon[cle]),
        disabled: !responsable,
        onchange: (e: Event) => (brouillon[cle] = Number((e.target as HTMLInputElement).value)),
      }),
      aide,
    );
  return h(
    'details',
    { class: 'carte parametres' },
    h('summary', null, h('strong', null, 'Paramètres des contrôles'), session.etat!.parametres ? badge('fixés au journal', 'ok') : badge('détection automatique', 'neutre')),
    h('p', { class: 'aide' }, 'Toute modification est signée et journalisée : un changement de seuil reste traçable.'),
    h(
      'div',
      { class: 'grille-params' },
      nombre('seuilDureeMinutes', 'Durée minimale d’un entretien (minutes)', 'Sous ce seuil, l’entretien est signalé.', '0.5'),
      nombre('dureeMaxHeures', 'Durée maximale plausible (heures)', 'Au-delà, l’horodatage est jugé incohérent.', '0.5'),
      nombre('partCourtsEnqueteur', 'Part d’entretiens courts signalant un enquêteur', 'Entre 0 et 1 (0,2 = 20 %).', '0.05'),
      nombre('minEntretiensEnqueteur', 'Nombre minimal d’entretiens par enquêteur', 'En dessous, l’enquêteur n’est pas évalué.'),
      nombre('distanceNoms', 'Écart maximal entre deux noms proches', 'Nombre de lettres différentes (2 conseillé).'),
    ),
    h('h3', null, 'Colonnes utilisées'),
    h(
      'div',
      { class: 'grille-params' },
      (Object.keys(LIBELLES_COLONNES) as (keyof ColonnesControles)[]).map((cle) =>
        champ(
          LIBELLES_COLONNES[cle],
          h(
            'select',
            {
              disabled: !responsable,
              onchange: (e: Event) => {
                const v = (e.target as HTMLSelectElement).value;
                if (v) brouillon.colonnes[cle] = v;
                else delete brouillon.colonnes[cle];
              },
            },
            h('option', { value: '' }, '— aucune (contrôle désactivé) —'),
            colonnes.map((c) => h('option', { value: c, selected: brouillon.colonnes[cle] === c }, c)),
          ),
        ),
      ),
    ),
    responsable
      ? h(
          'div',
          { class: 'ligne' },
          bouton('Signer ces paramètres', () =>
            occupe('Signature des paramètres…', async () => {
              await fixerParametres(session.liste!, session.etat!, session.identite!, brouillon);
              notifier('Paramètres signés. Les alertes ont été recalculées.', 'succes');
              await apresModification();
            }),
          'principal'),
          bouton('Revenir à la détection automatique', () => {
            brouillonGarde = { cle, parametres: parametresParDefaut(colonnes) };
            rafraichir();
            document.querySelector('details.parametres')?.setAttribute('open', '');
          }),
        )
      : h('p', { class: 'aide' }, 'Seul un responsable peut modifier ces paramètres.'),
  );
}

export function ecranAlertes() {
  const alertes = alertesCourantes();
  const etat = session.etat!;
  const sansDecision = alertes.filter((a) => !etat.decisionsAlertes.has(a.id));
  const parControle = new Map<Controle, number>();
  for (const a of alertes) parControle.set(a.controle, (parControle.get(a.controle) ?? 0) + 1);
  const filtrees = alertes.filter(
    (a) =>
      (vue.categorie === 'toutes' || a.categorie === vue.categorie) &&
      (vue.statut === 'toutes' || (vue.statut === 'decidees') === etat.decisionsAlertes.has(a.id)),
  );
  const selecteur = <T extends string>(valeur: T, options: [T, string][], change: (v: T) => void, libelle: string) =>
    h(
      'select',
      { 'aria-label': libelle, onchange: (e: Event) => change((e.target as HTMLSelectElement).value as T) },
      options.map(([v, l]) => h('option', { value: v, selected: v === valeur }, l)),
    );
  return [
    h('h1', null, 'Alertes'),
    h('p', { class: 'intro' }, 'L’outil signale, il ne décide jamais. Chaque alerte appelle une décision humaine, signée et journalisée.'),
    h(
      'div',
      { class: 'compteurs' },
      h('div', { class: 'compteur attente' }, h('span', { class: 'nombre' }, String(sansDecision.length)), 'sans décision'),
      h('div', { class: 'compteur ok' }, h('span', { class: 'nombre' }, String(alertes.length - sansDecision.length)), 'décidées'),
      h('div', { class: 'compteur protection' }, h('span', { class: 'nombre' }, String(alertes.filter((a) => a.categorie === 'protection').length)), 'protection'),
    ),
    h(
      'p',
      { class: 'discret' },
      [...parControle].map(([c, n]) => `${LIBELLES_CONTROLES[c]} : ${n}`).join(' · ') || 'Aucune alerte.',
    ),
    !moi() || !(peut('validation') || peut('responsable'))
      ? encadre('info', 'Lecture seule : seules les personnes en validation ou responsables décident des alertes.')
      : null,
    carteParametres(),
    h(
      'div',
      { class: 'barre-outils' },
      selecteur(vue.categorie, [['toutes', 'Toutes catégories'], ['integrite', 'Intégrité'], ['protection', 'Protection']], (v) => {
        vue.categorie = v;
        rafraichir();
      }, 'Catégorie'),
      selecteur(vue.statut, [['sans_decision', 'Sans décision'], ['decidees', 'Décidées'], ['toutes', 'Toutes']], (v) => {
        vue.statut = v;
        rafraichir();
      }, 'Statut'),
    ),
    filtrees.length ? h('div', { class: 'pile' }, filtrees.map(carteAlerte)) : encadre('ok', 'Aucune alerte dans cette sélection.'),
  ];
}
