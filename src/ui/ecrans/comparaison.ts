/**
 * Comparaison côte à côte de plusieurs ménages (doublons de téléphone, de nom, de pièce d'identité…).
 * Champs en lignes, ménages en colonnes, différences surlignées. On corrige ou on propose
 * une exclusion directement depuis le tableau, et l'on décide de l'alerte d'origine.
 */
import { cellule, corriger, deciderAlerte } from '../../model/journal.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, MOTIFS_EXCLUSION, MOTIFS_REINTEGRATION, type Motif } from '../../model/types.ts';
import { badge, bouton, encadre } from '../composants.ts';
import { h, remplacer } from '../dom.ts';
import { alertesCourantes, aller, apresModification, nomAuteur, notifier, occupe, peut, session } from '../session.ts';
import { formatDistance } from '../../controles/geo.ts';
import { COULEURS, distancesDeuxADeux, plan } from '../plan.ts';
import { peutDecider, pointMenage } from './alertes.ts';
import { formulaireCorrection } from './correction.ts';

let seulementDifferences = false;

/**
 * Décision par ménage dans la comparaison : « conserver », « à vérifier », « exclure:<motif> »
 * ou « reintegrer:<motif> ». Gardée tant que l'on compare les mêmes ménages.
 */
let choix = { cle: '', parMenage: new Map<string, string>() };

/** Décision d'alerte déduite des choix par ménage (modifiable avant de signer). */
function decisionDeduite(menages: string[], parMenage: Map<string, string>, exclus: (m: string) => boolean): string {
  const valeurs = menages.map((m) => parMenage.get(m) ?? '');
  if (valeurs.includes('verifier')) return 'verification_terrain';
  if (valeurs.some((v) => v.startsWith('exclure:'))) return 'confirmee';
  if (menages.every((m, i) => valeurs[i] === 'conserver' || (exclus(m) && !valeurs[i]))) return 'faux_positif';
  return '';
}

export function ecranComparaison() {
  const { etat, liste } = session;
  const { menages, alerte: idAlerte } = session.comparaison!;
  const o = liste!.original;
  const peutCorriger = peut('correction');
  const alerte = alertesCourantes().find((a) => a.id === idAlerte);
  const decision = idAlerte ? etat!.decisionsAlertes.get(idAlerte) : undefined;
  const zone = h('div', { class: 'defilement comparaison' });

  const retour = () => {
    session.comparaison = undefined;
    aller('correction');
  };

  function dessiner() {
    const champs = o.colonnes.filter((c) => {
      if (!seulementDifferences || c === o.colonneId) return true;
      return new Set(menages.map((m) => etat!.valeur(m, c) ?? '')).size > 1;
    });
    remplacer(
      zone,
      h(
        'table',
        { class: 'tableau' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', null, 'Champ'),
            menages.map((m) =>
              h(
                'th',
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'lien',
                    title: 'Ouvrir la fiche de ce ménage',
                    onclick: () => {
                      session.comparaison = undefined;
                      session.menageSelectionne = m;
                      aller('correction');
                    },
                  },
                  m,
                ),
              ),
            ),
          ),
        ),
        h(
          'tbody',
          null,
          // Ligne de statut : exclusion ou réintégration, à quatre yeux.
          h(
            'tr',
            { class: 'ligne-statut' },
            h('th', { scope: 'row' }, 'Statut'),
            menages.map((m) => {
              const exclu = etat!.estExclu(m);
              const attente = etat!.enAttenteParCellule.has(cellule(m, CHAMP_STATUT));
              const td: HTMLElement = h(
                'td',
                null,
                h('div', { class: 'cellule' }, exclu ? badge('exclu', 'refus') : badge('inclus', 'ok'), attente && badge('changement en attente', 'attente')),
              );
              if (!attente) td.appendChild(selecteurMenage(m, exclu));
              return td;
            }),
          ),
          champs.map((c) => {
            const valeurs = menages.map((m) => etat!.valeur(m, c) ?? '');
            const different = new Set(valeurs).size > 1;
            return h(
              'tr',
              { class: different ? 'difference' : '' },
              h('th', { scope: 'row' }, c),
              menages.map((m, k) => {
                const attente = etat!.enAttenteParCellule.has(cellule(m, c));
                const ancre = h(
                  'div',
                  { class: 'cellule' },
                  h('span', { class: 'valeur' }, valeurs[k] || h('span', { class: 'discret' }, '(vide)')),
                  attente && badge('en attente', 'attente'),
                );
                if (peutCorriger && c !== o.colonneId && !attente) {
                  ancre.appendChild(bouton('Corriger', () => formulaireCorrection(m, c, ancre, dessiner)));
                }
                return h('td', null, ancre);
              }),
            );
          }),
        ),
      ),
    );
  }

  // ---- Décision du groupe : un choix par ménage (ligne Statut), puis une seule signature.
  const cleChoix = `${idAlerte ?? ''}|${menages.join(',')}`;
  if (choix.cle !== cleChoix) choix = { cle: cleChoix, parMenage: new Map() };
  const resume = h('div', { class: 'resume-groupe' });
  const choixAlerte = h(
    'select',
    { 'aria-label': 'Décision sur l’alerte', onchange: () => (alerteForcee = true) },
    h('option', { value: '' }, '— pas de décision d’alerte —'),
    Object.entries(DECISIONS_ALERTE.integrite).map(([v, l]) => h('option', { value: v }, l)),
  );
  let alerteForcee = false;
  const commentaire = h('input', { type: 'text', placeholder: 'Commentaire (obligatoire) : sur quoi reposent ces décisions ?', 'aria-label': 'Commentaire de la décision du groupe' });
  const boutonSigner = bouton('Signer', () => signerGroupe(), 'principal');

  function majGroupe() {
    const p = choix.parMenage;
    const changements = menages.filter((m) => /^(exclure|reintegrer):/.test(p.get(m) ?? ''));
    if (alerte && !alerteForcee) choixAlerte.value = decisionDeduite(menages, p, (m) => etat!.estExclu(m));
    const parts: string[] = [];
    for (const m of changements) {
      const [quoi, motif] = p.get(m)!.split(':');
      parts.push(`${quoi === 'exclure' ? 'exclure' : 'réintégrer'} ${m} (${motif})`);
    }
    const conserves = menages.filter((m) => p.get(m) === 'conserver');
    if (conserves.length) parts.push(`conserver ${conserves.join(', ')}`);
    const verifies = menages.filter((m) => p.get(m) === 'verifier');
    if (verifies.length) parts.push(`faire vérifier ${verifies.join(', ')} sur le terrain`);
    remplacer(resume, parts.length ? `À signer : ${parts.join(' · ')}.` : 'Choisissez une décision pour chaque ménage dans la ligne « Statut » du tableau.');
    const rien = !changements.length && !choixAlerte.value;
    boutonSigner.toggleAttribute('disabled', rien);
    boutonSigner.textContent = changements.length ? `Signer (${changements.length} changement(s) de statut${choixAlerte.value ? ' + décision d’alerte' : ''})` : 'Signer la décision';
  }
  choixAlerte.addEventListener('change', majGroupe);

  function selecteurMenage(m: string, exclu: boolean) {
    const valeur = choix.parMenage.get(m) ?? '';
    const sel = h(
      'select',
      {
        class: 'decision-menage',
        'aria-label': `Décision pour le ménage ${m}`,
        onchange: () => {
          sel.value ? choix.parMenage.set(m, sel.value) : choix.parMenage.delete(m);
          majGroupe();
        },
      },
      h('option', { value: '' }, '— Décision —'),
      h('option', { value: 'conserver', selected: valeur === 'conserver' }, exclu ? 'Laisser exclu' : 'Conserver : ménage valide'),
      h('option', { value: 'verifier', selected: valeur === 'verifier' }, 'À vérifier sur le terrain'),
      exclu
        ? h('optgroup', { label: 'Réintégrer' }, MOTIFS_REINTEGRATION.map((mo) => h('option', { value: `reintegrer:${mo}`, selected: valeur === `reintegrer:${mo}`, disabled: !peutCorriger }, mo)))
        : h('optgroup', { label: 'Exclure' }, MOTIFS_EXCLUSION.map((mo) => h('option', { value: `exclure:${mo}`, selected: valeur === `exclure:${mo}`, disabled: !peutCorriger }, mo))),
    );
    return sel;
  }

  function signerGroupe() {
    const p = choix.parMenage;
    const changements = menages.filter((m) => /^(exclure|reintegrer):/.test(p.get(m) ?? ''));
    const decisionAlerte = alerte ? choixAlerte.value : '';
    if (!changements.length && !decisionAlerte) return notifier('Rien à signer.', 'erreur');
    if (!commentaire.value.trim()) {
      commentaire.focus();
      return notifier('Expliquez ces décisions en commentaire.', 'erreur');
    }
    if (changements.length && !peutCorriger) return notifier('Exclure ou réintégrer demande le rôle « Correction ».', 'erreur');
    if (decisionAlerte && !peutDecider()) return notifier('Décider de l’alerte demande le rôle « Validation » ou « Responsable ».', 'erreur');
    const texte = commentaire.value.trim();
    occupe('Signature…', async () => {
      for (const m of changements) {
        const [quoi, motif] = p.get(m)!.split(/:(.*)/s);
        await corriger(liste!, etat!, session.identite!, {
          menage: m,
          champ: CHAMP_STATUT,
          ancienne: etat!.valeur(m, CHAMP_STATUT) ?? 'inclus',
          nouvelle: quoi === 'exclure' ? 'exclu' : 'inclus',
          motif: motif as Motif,
          commentaire: texte,
        });
      }
      if (alerte && decisionAlerte) {
        await deciderAlerte(liste!, etat!, session.identite!, { alerte: alerte.id, categorie: alerte.categorie, menages: alerte.menages, decision: decisionAlerte, commentaire: texte });
        session.decisionsDepuisRecu++;
      }
      choix = { cle: '', parMenage: new Map() };
      notifier(
        `${changements.length ? `${changements.length} changement(s) de statut proposé(s) (à valider par une autre personne)` : ''}${changements.length && decisionAlerte ? ' et ' : ''}${decisionAlerte ? 'décision d’alerte signée' : ''}.`,
        'succes',
      );
      await apresModification();
    });
  }

  const barreGroupe = h(
    'div',
    { class: 'barre-groupe statique decision-groupe' },
    h('strong', null, 'Décision sur ce groupe'),
    resume,
    h('div', { class: 'actions' }, alerte && h('label', { class: 'discret' }, 'Alerte : ', choixAlerte), commentaire, boutonSigner),
  );

  dessiner();
  majGroupe();
  // Position GPS des ménages comparés : plan et distances deux à deux.
  const avecPoint = menages.map((m, i) => ({ id: m, point: pointMenage(m), couleur: COULEURS[i % COULEURS.length] })).filter((x) => x.point) as {
    id: string;
    point: NonNullable<ReturnType<typeof pointMenage>>;
    couleur: string;
  }[];
  const carteGps =
    avecPoint.length > 0 &&
    h(
      'details',
      { class: 'carte carte-gps', open: true },
      h('summary', null, h('strong', null, 'Position GPS'), ` · ${avecPoint.length} ménage(s) sur ${menages.length} avec des coordonnées`),
      h(
        'div',
        { class: 'gps-comparaison' },
        plan(
          avecPoint.map((x) => ({
            ...x,
            etiquette: x.id,
            infobulle: `${x.id}${x.point.precision ? ` (précision ±${Math.round(x.point.precision)} m)` : ''}`,
          })),
          { hauteur: 300, etiquettes: true },
        ),
        h(
          'table',
          { class: 'tableau distances' },
          h('thead', null, h('tr', null, h('th', null, 'Entre'), h('th', null, 'Distance'), h('th', null, 'Précision GPS'))),
          h(
            'tbody',
            null,
            distancesDeuxADeux(avecPoint)
              .sort((a, b) => a[2] - b[2])
              .slice(0, 30)
              .map(([a, b, d]) => {
                const pa = avecPoint.find((x) => x.id === a)!.point.precision;
                const pb = avecPoint.find((x) => x.id === b)!.point.precision;
                const marge = (pa ?? 0) + (pb ?? 0);
                return h(
                  'tr',
                  { class: marge && d <= marge ? 'confondus' : '' },
                  h('td', null, `${a} ↔ ${b}`),
                  h('td', null, formatDistance(d)),
                  h('td', null, pa || pb ? `±${Math.round(pa ?? 0)} m / ±${Math.round(pb ?? 0)} m` : '—', marge && d <= marge ? h('div', { class: 'discret' }, 'même endroit, aux erreurs de mesure près') : ''),
                );
              }),
          ),
        ),
      ),
      avecPoint.length < menages.length && h('p', { class: 'aide' }, `Sans coordonnées : ${menages.filter((m) => !avecPoint.some((x) => x.id === m)).join(', ')}.`),
    );

  return [
    h('div', { class: 'barre-retour' }, bouton('← Retour à la liste', retour)),
    h('h1', null, `Comparaison de ${menages.length} ménages`),
    alerte &&
      encadre(
        'alerte',
        h('strong', null, alerte.libelle),
        ' — ',
        alerte.message,
        ' ',
        decision ? badge(DECISIONS_ALERTE[decision.contenu.categorie][decision.contenu.decision], 'ok') : badge('sans décision', 'attente'),
        decision && h('span', { class: 'discret' }, ` ${nomAuteur(decision.auteur)}`),
      ),
    carteGps,
    h(
      'p',
      { class: 'aide' },
      'Les lignes surlignées sont celles où les ménages diffèrent. « Corriger » propose une nouvelle valeur. ',
      'Dans la ligne « Statut », choisissez une décision pour chaque ménage (conserver, faire vérifier, exclure avec son motif), puis signez le tout en une fois : ',
      'la décision sur l’alerte est proposée d’après vos choix. Les exclusions attendent la validation d’une autre personne.',
    ),
    h(
      'label',
      { class: 'case' },
      h('input', {
        type: 'checkbox',
        checked: seulementDifferences,
        onchange: (e: Event) => {
          seulementDifferences = (e.target as HTMLInputElement).checked;
          dessiner();
        },
      }),
      ' Afficher seulement les champs qui diffèrent',
    ),
    barreGroupe,
    zone,
  ];
}
