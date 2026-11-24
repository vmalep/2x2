/**
 * Comparaison côte à côte de plusieurs ménages (doublons de téléphone, de nom, de pièce d'identité…).
 * Champs en lignes, ménages en colonnes, différences surlignées. On corrige ou on propose
 * une exclusion directement depuis le tableau, et l'on décide de l'alerte d'origine.
 */
import { cellule, corriger, deciderAlerte } from '../../model/journal.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, MOTIFS_EXCLUSION, MOTIFS_REINTEGRATION, libelleMotif, type Motif } from '../../model/types.ts';
import { badge, bouton, encadre } from '../composants.ts';
import { h, remplacer } from '../dom.ts';
import { alertesCourantes, aller, apresModification, nomAuteur, notifier, occupe, peut, session } from '../session.ts';
import { formatDistance } from '../../controles/geo.ts';
import { COULEURS, distancesDeuxADeux, plan } from '../plan.ts';
import { peutDecider, pointMenage } from './alertes.ts';
import { formulaireCorrection } from './correction.ts';
import { t } from '../../i18n/index.ts';

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
            h('th', null, t('comparaison.champ')),
            menages.map((m) =>
              h(
                'th',
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'lien',
                    title: t('comparaison.ouvrir_fiche'),
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
            h('th', { scope: 'row' }, t('validation.col_statut')),
            menages.map((m) => {
              const exclu = etat!.estExclu(m);
              const attente = etat!.enAttenteParCellule.has(cellule(m, CHAMP_STATUT));
              const td: HTMLElement = h(
                'td',
                null,
                h('div', { class: 'cellule' }, exclu ? badge(t('statut.exclu'), 'refus') : badge(t('statut.inclus'), 'ok'), attente && badge(t('correction.changement_attente'), 'attente')),
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
                  h('span', { class: 'valeur' }, valeurs[k] || h('span', { class: 'discret' }, t('commun.vide'))),
                  attente && badge(t('correction.en_attente'), 'attente'),
                );
                if (peutCorriger && c !== o.colonneId && !attente) {
                  ancre.appendChild(bouton(t('commun.corriger'), () => formulaireCorrection(m, c, ancre, dessiner)));
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
    { 'aria-label': t('comparaison.decision_alerte'), onchange: () => (alerteForcee = true) },
    h('option', { value: '' }, t('comparaison.pas_decision')),
    Object.entries(DECISIONS_ALERTE.integrite).map(([v, l]) => h('option', { value: v }, l)),
  );
  let alerteForcee = false;
  const commentaire = h('input', { type: 'text', placeholder: t('comparaison.commentaire'), 'aria-label': t('comparaison.commentaire_label') });
  const boutonSigner = bouton(t('commun.signer'), () => signerGroupe(), 'principal');

  function majGroupe() {
    const p = choix.parMenage;
    const changements = menages.filter((m) => /^(exclure|reintegrer):/.test(p.get(m) ?? ''));
    // Seule une personne qui peut décider des alertes se voit proposer une décision d'alerte.
    if (alerte && peutDecider() && !alerteForcee) choixAlerte.value = decisionDeduite(menages, p, (m) => etat!.estExclu(m));
    const parts: string[] = [];
    for (const m of changements) {
      const [quoi, motif] = p.get(m)!.split(':');
      parts.push(t(quoi === 'exclure' ? 'comparaison.part_exclure' : 'comparaison.part_reintegrer', { menage: m, motif: libelleMotif(motif) }));
    }
    const conserves = menages.filter((m) => p.get(m) === 'conserver');
    if (conserves.length) parts.push(t('comparaison.part_conserver', { menages: conserves.join(', ') }));
    const verifies = menages.filter((m) => p.get(m) === 'verifier');
    if (verifies.length) parts.push(t('comparaison.part_verifier', { menages: verifies.join(', ') }));
    remplacer(resume, parts.length ? t('comparaison.a_signer', { parts: parts.join(' · ') }) : t('comparaison.choisissez'));
    const rien = !changements.length && !choixAlerte.value;
    boutonSigner.toggleAttribute('disabled', rien);
    boutonSigner.textContent = changements.length ? t(choixAlerte.value ? 'comparaison.signer_changements_alerte' : 'comparaison.signer_changements', { n: changements.length }) : t('alertes.signer_decision');
  }
  choixAlerte.addEventListener('change', majGroupe);

  function selecteurMenage(m: string, exclu: boolean) {
    const valeur = choix.parMenage.get(m) ?? '';
    const sel = h(
      'select',
      {
        class: 'decision-menage',
        'aria-label': t('comparaison.decision_menage', { menage: m }),
        onchange: () => {
          sel.value ? choix.parMenage.set(m, sel.value) : choix.parMenage.delete(m);
          majGroupe();
        },
      },
      h('option', { value: '' }, t('commun.choix_decision')),
      h('option', { value: 'conserver', selected: valeur === 'conserver' }, exclu ? t('comparaison.laisser_exclu') : t('comparaison.conserver')),
      h('option', { value: 'verifier', selected: valeur === 'verifier' }, t('decision.verification_terrain')),
      exclu
        ? h('optgroup', { label: t('comparaison.reintegrer') }, MOTIFS_REINTEGRATION.map((mo) => h('option', { value: `reintegrer:${mo}`, selected: valeur === `reintegrer:${mo}`, disabled: !peutCorriger }, libelleMotif(mo))))
        : h('optgroup', { label: t('comparaison.exclure') }, MOTIFS_EXCLUSION.map((mo) => h('option', { value: `exclure:${mo}`, selected: valeur === `exclure:${mo}`, disabled: !peutCorriger }, libelleMotif(mo)))),
    );
    return sel;
  }

  function signerGroupe() {
    const p = choix.parMenage;
    const changements = menages.filter((m) => /^(exclure|reintegrer):/.test(p.get(m) ?? ''));
    const decisionAlerte = alerte ? choixAlerte.value : '';
    if (!changements.length && !decisionAlerte) return notifier(t('comparaison.rien'), 'erreur');
    if (!commentaire.value.trim()) {
      commentaire.focus();
      return notifier(t('comparaison.expliquer'), 'erreur');
    }
    if (changements.length && !peutCorriger) return notifier(t('comparaison.role_correction'), 'erreur');
    if (decisionAlerte && !peutDecider()) return notifier(t('comparaison.role_decider'), 'erreur');
    const texte = commentaire.value.trim();
    occupe(t('commun.signature'), async () => {
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
        changements.length && decisionAlerte
          ? t('comparaison.signe_tout', { n: changements.length })
          : changements.length
            ? t('comparaison.signe_changements', { n: changements.length })
            : t('comparaison.signe_alerte'),
        'succes',
      );
      await apresModification();
    });
  }

  const barreGroupe = h(
    'div',
    { class: 'barre-groupe statique decision-groupe' },
    h('strong', null, t('comparaison.decision_groupe')),
    resume,
    h('div', { class: 'actions' }, alerte && peutDecider() && h('label', { class: 'discret' }, t('comparaison.alerte'), choixAlerte), commentaire, boutonSigner),
    alerte && !peutDecider() && h('p', { class: 'aide' }, t('comparaison.decision_revient')),
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
      h('summary', null, h('strong', null, t('comparaison.position')), t('comparaison.avec_coordonnees', { n: avecPoint.length, total: menages.length })),
      h(
        'div',
        { class: 'gps-comparaison' },
        plan(
          avecPoint.map((x) => ({
            ...x,
            etiquette: x.id,
            infobulle: `${x.id}${x.point.precision ? t('comparaison.precision', { m: Math.round(x.point.precision) }) : ''}`,
          })),
          { hauteur: 300, etiquettes: true },
        ),
        h(
          'table',
          { class: 'tableau distances' },
          h('thead', null, h('tr', null, h('th', null, t('comparaison.entre')), h('th', null, t('comparaison.distance')), h('th', null, t('comparaison.precision_gps')))),
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
                  h('td', null, pa || pb ? `±${Math.round(pa ?? 0)} m / ±${Math.round(pb ?? 0)} m` : '—', marge && d <= marge ? h('div', { class: 'discret' }, t('comparaison.meme_endroit')) : ''),
                );
              }),
          ),
        ),
      ),
      avecPoint.length < menages.length && h('p', { class: 'aide' }, t('comparaison.sans_coordonnees', { menages: menages.filter((m) => !avecPoint.some((x) => x.id === m)).join(', ') })),
    );

  return [
    h('div', { class: 'barre-retour' }, bouton(t('comparaison.retour'), retour)),
    h('h1', null, t('comparaison.titre', { n: menages.length })),
    alerte &&
      encadre(
        'alerte',
        h('strong', null, alerte.libelle),
        ' — ',
        alerte.message,
        ' ',
        decision ? badge(DECISIONS_ALERTE[decision.contenu.categorie][decision.contenu.decision], 'ok') : badge(t('commun.sans_decision'), 'attente'),
        decision && h('span', { class: 'discret' }, ` ${nomAuteur(decision.auteur)}`),
      ),
    carteGps,
    h(
      'p',
      { class: 'aide' },
      t('comparaison.aide'),
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
      t('comparaison.differences'),
    ),
    barreGroupe,
    zone,
  ];
}
