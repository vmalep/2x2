/**
 * Moteur de contrôle : applique les règles (données, voir regles.ts) aux valeurs actuelles
 * de la liste (après corrections acceptées) et produit des alertes.
 * L'outil signale ; la décision revient toujours à une personne.
 */
import type { Etat } from '../model/journal.ts';
import type { CategorieAlerte } from '../model/types.ts';
import { lireCondition, lireNombre, type Regle } from './regles.ts';
import { centre, detecterColonneGps, distance, formatDistance, groupesProches, pointDepuis, type Point } from './geo.ts';
import { normaliserTelephone, nomsProches } from './similarite.ts';

export interface Alerte {
  /** Identifiant stable « règle:ménage(s) » : il relie l'alerte aux décisions du journal. */
  id: string;
  /** Nom de la règle qui a produit l'alerte. */
  controle: string;
  libelle: string;
  categorie: CategorieAlerte;
  menages: string[];
  message: string;
}

/** Nombre minimal d'entretiens pour juger un enquêteur (règle part_enqueteur). */
const MIN_ENTRETIENS_ENQUETEUR = 5;

/** Date ISO ; sans fuseau, elle est lue en UTC (cas de _submission_time chez Kobo). */
export function lireDate(texte: string | undefined): number | undefined {
  if (!texte?.trim()) return undefined;
  const t = texte.trim();
  const avecFuseau = /([zZ]|[+-]\d{2}:?\d{2})$/.test(t) || !/T\d{2}:/.test(t) ? t : `${t}Z`;
  const ms = Date.parse(avecFuseau);
  return Number.isNaN(ms) ? undefined : ms;
}

function formatDuree(minutes: number): string {
  if (Math.abs(minutes) < 120) return `${Math.round(minutes * 10) / 10} min`;
  return `${Math.round((minutes / 60) * 10) / 10} h`;
}

const normaliserValeur = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface RelationsLien {
  /** Ménage rattaché (hébergé) → ménage(s) de référence (hôte). */
  hotesDe: Map<string, Set<string>>;
  /** Ménage de référence (hôte) → ménages qui lui sont rattachés. */
  hebergesDe: Map<string, Set<string>>;
  /** Problèmes de saisie, par ménage qui a saisi le code. */
  problemes: Map<string, string[]>;
}

/** Code comparé sans casse, espaces ni tirets : « k7m34fqa » retrouve « K7M3-4FQA ». */
const cleCode = (x: string) => x.toUpperCase().replace(/[\s-]+/g, '');

/**
 * Liens entre ménages, saisis d'un côté ou de l'autre :
 * - colonne « aller » : le ménage rattaché indique le code de son ménage de référence (ex. id_menage_hote) ;
 * - colonne « retour » (facultative) : le ménage de référence indique les codes des ménages rattachés,
 *   séparés par des espaces (ex. ids_menages_heberges).
 * Le lien existe dès qu'il est saisi d'un côté ; les deux saisies se complètent.
 */
export function relationsLien(etat: Etat, aller: string, retour?: string): RelationsLien {
  const o = etat.original;
  const ids = o.lignes.map((l) => l[o.colonnes.indexOf(o.colonneId)]);
  const index = new Map(ids.map((id) => [cleCode(id), id]));
  const rel: RelationsLien = { hotesDe: new Map(), hebergesDe: new Map(), problemes: new Map() };
  const probleme = (id: string, texte: string) => rel.problemes.set(id, [...(rel.problemes.get(id) ?? []), texte]);
  const lier = (heberge: string, hote: string) => {
    rel.hotesDe.set(heberge, (rel.hotesDe.get(heberge) ?? new Set()).add(hote));
    rel.hebergesDe.set(hote, (rel.hebergesDe.get(hote) ?? new Set()).add(heberge));
  };
  for (const id of ids) {
    const code = (etat.valeur(id, aller) ?? '').trim();
    if (code) {
      const cible = index.get(cleCode(code));
      if (!cible) probleme(id, `« ${code} » (${aller}) est introuvable dans la liste`);
      else if (cible === id) probleme(id, `le ménage se désigne lui-même (${aller})`);
      else lier(id, cible);
    }
    if (retour) {
      for (const c of (etat.valeur(id, retour) ?? '').split(/[\s,;]+/).filter(Boolean)) {
        const cible = index.get(cleCode(c));
        if (!cible) probleme(id, `« ${c} » (${retour}) est introuvable dans la liste`);
        else if (cible === id) probleme(id, `le ménage se désigne lui-même (${retour})`);
        else lier(cible, id);
      }
    }
  }
  return rel;
}

export function calculerAlertes(etat: Etat, regles: Regle[]): Alerte[] {
  const o = etat.original;
  const ids = o.lignes.map((l) => l[o.colonnes.indexOf(o.colonneId)]);
  const v = (id: string, col: string) => (col ? (etat.valeur(id, col) ?? '') : '');
  const actives = regles.filter((r) => r.actif);
  const alertes: Alerte[] = [];
  /** Ménages signalés par chaque règle (pour part_enqueteur). */
  const signales = new Map<string, Set<string>>();

  const ajouter = (r: Regle, menages: string[], message: string, cle?: string) => {
    alertes.push({ id: `${r.nom}:${cle ?? menages.join('+')}`, controle: r.nom, libelle: r.libelle, categorie: 'integrite', menages, message });
    const s = signales.get(r.nom) ?? new Set<string>();
    menages.forEach((m) => s.add(m));
    signales.set(r.nom, s);
  };

  /** Points GPS des ménages (ceux qui en ont un), pour une colonne donnée. */
  const pointsMenages = (colonne: string) => {
    const m = new Map<string, Point>();
    for (const id of ids) {
      const p = pointDepuis((c) => etat.valeur(id, c), colonne);
      if (p) m.set(id, p);
    }
    return m;
  };

  const groupesDoublons = (r: Regle, cle: (id: string) => string, decrire: (membres: string[]) => string) => {
    const groupes = new Map<string, string[]>();
    for (const id of ids) {
      const k = cle(id);
      if (k) groupes.set(k, [...(groupes.get(k) ?? []), id]);
    }
    for (const membres of groupes.values()) if (membres.length > 1) ajouter(r, membres, decrire(membres));
  };

  for (const r of actives.filter((x) => x.type !== 'part_enqueteur')) {
    const min = lireNombre(r.min);
    const max = lireNombre(r.max);
    switch (r.type) {
      case 'duree':
        for (const id of ids) {
          const debut = lireDate(v(id, r.colonne));
          const fin = lireDate(v(id, r.colonne2));
          if (debut === undefined || fin === undefined) continue;
          const minutes = (fin - debut) / 60_000;
          if (minutes < 0) continue; // relève de la règle ordre_dates
          if (min !== undefined && minutes < min) ajouter(r, [id], `Durée de ${formatDuree(minutes)} (minimum : ${formatDuree(min)})`);
          else if (max !== undefined && minutes > max) ajouter(r, [id], `Durée de ${formatDuree(minutes)} (maximum : ${formatDuree(max)})`);
        }
        break;
      case 'ordre_dates':
        for (const id of ids) {
          const a = lireDate(v(id, r.colonne));
          const b = lireDate(v(id, r.colonne2));
          if (a !== undefined && b !== undefined && a > b) {
            ajouter(r, [id], `« ${r.colonne} » (${v(id, r.colonne)}) est postérieure à « ${r.colonne2} » (${v(id, r.colonne2)})`);
          }
        }
        break;
      case 'periode': {
        const debut = r.min.trim() ? Date.parse(r.min.trim()) : undefined;
        // La borne max couvre toute la journée indiquée.
        const fin = r.max.trim() ? Date.parse(r.max.trim()) + (/T/.test(r.max) ? 0 : 86_400_000 - 1) : undefined;
        for (const id of ids) {
          const d = lireDate(v(id, r.colonne));
          if (d === undefined) continue;
          if ((debut !== undefined && d < debut) || (fin !== undefined && d > fin)) {
            ajouter(r, [id], `Date ${v(id, r.colonne)} hors de la période ${r.min || '…'} – ${r.max || '…'}`);
          }
        }
        break;
      }
      case 'seuil':
        for (const id of ids) {
          const brut = v(id, r.colonne).trim();
          if (!brut) continue;
          const n = lireNombre(brut);
          if (n === undefined) ajouter(r, [id], `« ${brut} » n’est pas un nombre`);
          else if (min !== undefined && n < min) ajouter(r, [id], `${r.colonne} = ${brut} (minimum : ${r.min})`);
          else if (max !== undefined && n > max) ajouter(r, [id], `${r.colonne} = ${brut} (maximum : ${r.max})`);
        }
        break;
      case 'obligatoire':
        for (const id of ids) if (!v(id, r.colonne).trim()) ajouter(r, [id], `« ${r.colonne} » est vide`);
        break;
      case 'valeurs': {
        const admises = new Set(r.liste.split(';').map((x) => x.trim().toLowerCase()).filter(Boolean));
        for (const id of ids) {
          const val = v(id, r.colonne).trim();
          if (val && !admises.has(val.toLowerCase())) ajouter(r, [id], `Valeur « ${val} » hors liste (${[...admises].join(', ')})`);
        }
        break;
      }
      case 'format': {
        let motif: RegExp;
        try {
          motif = new RegExp(r.liste);
        } catch {
          break;
        }
        for (const id of ids) {
          const val = v(id, r.colonne).trim();
          if (val && !motif.test(val)) ajouter(r, [id], `« ${val} » ne respecte pas le format attendu`);
        }
        break;
      }
      case 'doublon':
        groupesDoublons(
          r,
          (id) => {
            const k = normaliserValeur(v(id, r.colonne));
            return k && r.colonne2 ? `${k}|${normaliserValeur(v(id, r.colonne2))}` : k;
          },
          (m) => `${m.length} ménages partagent la même valeur de « ${r.colonne} » (${v(m[0], r.colonne)})`,
        );
        break;
      case 'doublon_telephone':
        groupesDoublons(
          r,
          (id) => normaliserTelephone(v(id, r.colonne)),
          (m) => `${m.length} ménages partagent le numéro ${v(m[0], r.colonne)}`,
        );
        break;
      case 'noms_proches': {
        const distanceMax = max ?? 2;
        const parGroupe = new Map<string, string[]>();
        for (const id of ids) {
          const g = r.colonne2 ? v(id, r.colonne2).trim().toLowerCase() : '';
          parGroupe.set(g, [...(parGroupe.get(g) ?? []), id]);
        }
        for (const membres of parGroupe.values()) {
          const parent = new Map(membres.map((m) => [m, m]));
          const racine = (m: string): string => (parent.get(m) === m ? m : racine(parent.get(m)!));
          for (let i = 0; i < membres.length; i++) {
            for (let j = i + 1; j < membres.length; j++) {
              if (nomsProches(v(membres[i], r.colonne), v(membres[j], r.colonne), distanceMax)) parent.set(racine(membres[j]), racine(membres[i]));
            }
          }
          const groupes = new Map<string, string[]>();
          for (const m of membres) groupes.set(racine(m), [...(groupes.get(racine(m)) ?? []), m]);
          for (const g of groupes.values()) {
            if (g.length < 2) continue;
            ajouter(r, g, `Noms proches${r.colonne2 ? ` (${v(g[0], r.colonne2)})` : ''} : ${g.map((m) => `« ${v(m, r.colonne)} »`).join(', ')}`);
          }
        }
        break;
      }
      case 'proximite_gps': {
        const seuil = max ?? 5;
        const points = pointsMenages(r.colonne);
        for (const g of groupesProches(points, seuil)) {
          const d = distance(points.get(g[0])!, points.get(g[1])!);
          ajouter(r, g, `${g.length} ménages à moins de ${formatDistance(seuil)} les uns des autres (${formatDistance(d)} entre ${g[0]} et ${g[1]})`);
        }
        break;
      }
      case 'gps_groupes': {
        const rayon = max ?? 20;
        const minimum = min ?? 5;
        const points = pointsMenages(r.colonne);
        const parEnqueteur = new Map<string, Map<string, Point>>();
        for (const [id, p] of points) {
          const e = v(id, r.colonne2).trim();
          if (!e) continue;
          parEnqueteur.set(e, (parEnqueteur.get(e) ?? new Map()).set(id, p));
        }
        for (const [e, pts] of [...parEnqueteur].sort(([a], [b]) => a.localeCompare(b))) {
          for (const g of groupesProches(pts, rayon)) {
            if (g.length < minimum) continue;
            ajouter(r, g, `${e} : ${g.length} entretiens enregistrés dans un rayon d’environ ${formatDistance(rayon)}`, `${e}:${g[0]}`);
          }
        }
        break;
      }
      case 'obligatoire_si': {
        const c = lireCondition(r.liste);
        if (!c) break;
        for (const id of ids) {
          if (etat.estExclu(id)) continue;
          if (c.valeurs.has(v(id, c.colonne).trim().toLowerCase()) && !v(id, r.colonne).trim()) {
            ajouter(r, [id], `« ${r.colonne} » est vide alors que ${c.colonne} = ${v(id, c.colonne)}`);
          }
        }
        break;
      }
      case 'lien': {
        const rel = relationsLien(etat, r.colonne, r.colonne2);
        const c = r.liste.trim() ? lireCondition(r.liste) : undefined;
        const gps = detecterColonneGps(etat.original.colonnes);
        const point = (id: string) => (gps ? pointDepuis((col) => etat.valeur(id, col), gps) : undefined);
        // Problèmes de saisie : code introuvable, ménage qui se désigne lui-même (de l'un ou l'autre côté).
        for (const [id, problemes] of rel.problemes) {
          if (!etat.estExclu(id)) ajouter(r, [id], `Lien : ${problemes.join(' ; ')}`, `saisie:${id}`);
        }
        for (const [heberge, hotes] of rel.hotesDe) {
          if (etat.estExclu(heberge)) continue;
          const problemes: string[] = [];
          if (hotes.size > 1) problemes.push(`rattaché à plusieurs ménages hôtes (${[...hotes].join(', ')})`);
          for (const hote of hotes) {
            if (etat.estExclu(hote)) problemes.push(`${hote} est exclu de la liste`);
            if (c && !c.valeurs.has(v(hote, c.colonne).trim().toLowerCase())) {
              problemes.push(`${hote} a ${c.colonne} = ${v(hote, c.colonne) || '(vide)'} (attendu : ${[...c.valeurs].join(' ou ')})`);
            }
            const pa = point(heberge);
            const pb = point(hote);
            if (max !== undefined && pa && pb) {
              const d = distance(pa, pb);
              if (d > max) problemes.push(`${heberge} et ${hote} sont à ${formatDistance(d)} l’un de l’autre (maximum : ${formatDistance(max)})`);
            }
          }
          if (problemes.length) ajouter(r, [heberge, ...hotes], `Lien ${heberge} → ${[...hotes].join(', ')} : ${problemes.join(' ; ')}`, heberge);
        }
        if (min !== undefined) {
          for (const [hote, heberges] of rel.hebergesDe) {
            const inclus = [...heberges].filter((m) => !etat.estExclu(m));
            if (inclus.length > min && !etat.estExclu(hote)) {
              ajouter(r, [hote, ...inclus], `${hote} est rattaché à ${inclus.length} ménages (maximum : ${min})`, `trop:${hote}`);
            }
          }
        }
        break;
      }
      case 'lien_requis': {
        const c = lireCondition(r.liste);
        if (!c) break;
        const minimum = min ?? 1;
        const rel = relationsLien(etat, r.colonne, r.colonne2);
        for (const id of ids) {
          if (etat.estExclu(id) || !c.valeurs.has(v(id, c.colonne).trim().toLowerCase())) continue;
          // Ménages liés, dans un sens ou dans l'autre (hôte ↔ hébergé).
          const lies = new Set([...(rel.hebergesDe.get(id) ?? []), ...(rel.hotesDe.get(id) ?? [])]);
          const inclus = [...lies].filter((m) => !etat.estExclu(m));
          if (inclus.length >= minimum) continue;
          const exclus = [...lies].filter((m) => etat.estExclu(m));
          ajouter(
            r,
            [id, ...exclus],
            `${c.colonne} = ${v(id, c.colonne)}, mais ${inclus.length === 0 ? 'aucun ménage inclus ne lui est rattaché' : `seulement ${inclus.length} ménage(s) inclus lui sont rattachés (minimum : ${minimum})`}${exclus.length ? ` (${exclus.length} ménage(s) rattaché(s) exclu(s) : ${exclus.join(', ')})` : ''}`,
            id,
          );
        }
        break;
      }
      case 'gps_hors_zone': {
        const seuil = max ?? 3000;
        const points = pointsMenages(r.colonne);
        const parGroupe = new Map<string, string[]>();
        for (const id of points.keys()) {
          const g = v(id, r.colonne2).trim();
          if (g) parGroupe.set(g, [...(parGroupe.get(g) ?? []), id]);
        }
        for (const [g, membres] of parGroupe) {
          if (membres.length < 3) continue;
          const c = centre(membres.map((m) => points.get(m)!));
          for (const m of membres) {
            const d = distance(points.get(m)!, c);
            if (d > seuil) ajouter(r, [m], `À ${formatDistance(d)} du centre des ménages de « ${g} » (maximum : ${formatDistance(seuil)})`);
          }
        }
        break;
      }
    }
  }

  // Enquêteurs atypiques : calculés après les autres règles, dont ils dépendent.
  for (const r of actives.filter((x) => x.type === 'part_enqueteur')) {
    const reference = signales.get(r.liste) ?? new Set<string>();
    const seuil = lireNombre(r.min) ?? 0.2;
    const parEnqueteur = new Map<string, string[]>();
    for (const id of ids) {
      const e = v(id, r.colonne).trim();
      if (e) parEnqueteur.set(e, [...(parEnqueteur.get(e) ?? []), id]);
    }
    const total = ids.length;
    const totalSignales = [...reference].length;
    for (const [e, menages] of [...parEnqueteur].sort(([a], [b]) => a.localeCompare(b))) {
      const touches = menages.filter((m) => reference.has(m));
      if (menages.length < MIN_ENTRETIENS_ENQUETEUR || touches.length < 2) continue;
      const part = touches.length / menages.length;
      if (part < seuil) continue;
      const autres = (totalSignales - touches.length) / Math.max(1, total - menages.length);
      ajouter(
        r,
        touches,
        `${e} : ${touches.length} ménages signalés par « ${r.liste} » sur ${menages.length} (${Math.round(part * 100)} %), contre ${Math.round(autres * 100)} % pour les autres enquêteurs`,
        e,
      );
    }
  }

  return alertes;
}
