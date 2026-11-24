/**
 * Plan des ménages (SVG), sans connexion : points GPS en projection Web Mercator, cercle de
 * précision, échelle, nord, zoom à la molette et déplacement à la souris. Si un fond de carte
 * hors ligne est chargé (fond.ts), ses tuiles s'affichent sous les points.
 */
import { distance, formatDistance, type Point } from '../controles/geo.ts';
import type { ElementFond, FondVectoriel } from '../io/geojson.ts';
import { fondCarte, surChangementFond } from './fond.ts';

export interface PointPlan {
  id: string;
  point: Point;
  couleur: string;
  /** Texte affiché à côté du point (petits plans) ; l'infobulle montre toujours l'identifiant. */
  etiquette?: string;
  infobulle?: string;
  enAvant?: boolean;
  /** Ménages liés (ex. ménage hôte) : un trait relie chacun à ce point. */
  liens?: Point[];
}

export interface OptionsPlan {
  hauteur?: number;
  surClic?: (id: string) => void;
  /** Afficher l'identifiant à côté de chaque point (comparaison). */
  etiquettes?: boolean;
  /** Vue à reprendre (zoom et centre), pour ne pas la perdre quand le plan est redessiné. */
  vue?: VuePlan;
  surVue?: (v: VuePlan) => void;
}

export interface VuePlan {
  cx: number;
  cy: number;
  s: number;
}

const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributs: Record<string, string | number> = {}, ...enfants: (Node | string)[]) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attributs)) el.setAttribute(k, String(v));
  for (const e of enfants) el.append(e);
  return el;
}

/** Ordre de dessin du fond vectoriel : surfaces d'abord, puis lignes, des plus fines aux plus larges. */
const ORDRE_FOND = ['foret', 'eau', 'batiment', 'limite', 'ruisseau', 'riviere', 'piste', 'route', 'route-principale'] as const;

const empriseCache = new WeakMap<ElementFond, [number, number, number, number]>();
function emprise(e: ElementFond): [number, number, number, number] {
  let b = empriseCache.get(e);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of e.parties) for (const [x, y] of p) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    empriseCache.set(e, b);
  }
  return b;
}

/** Projection Web Mercator normalisée (0..1). */
const versX = (lon: number) => (lon + 180) / 360;
const versY = (lat: number) => {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};
const versLat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
/** Mètres par unité normalisée à une latitude donnée. */
const metresParUnite = (lat: number) => 40_075_016.686 * Math.cos((lat * Math.PI) / 180);

function echelleRonde(metres: number): number {
  const p = 10 ** Math.floor(Math.log10(metres));
  for (const m of [5, 2, 1]) if (m * p <= metres) return m * p;
  return p;
}

export function plan(points: PointPlan[], options: OptionsPlan = {}): HTMLElement {
  // Taille réelle du cadre (mise à jour quand il change) : le dessin n'est jamais étiré.
  let LARGEUR = 900;
  let H = options.hauteur ?? 360;
  const racine = svg('svg', { viewBox: `0 0 ${LARGEUR} ${H}`, class: 'plan-svg', role: 'img', 'aria-label': `Plan de ${points.length} point(s) GPS` });
  const conteneur = document.createElement('div');
  conteneur.className = 'plan';
  // Hauteur par défaut si le cadre n'en impose pas (CSSOM : autorisé par la politique de sécurité).
  conteneur.style.setProperty('--hauteur-plan', `${H}px`);
  conteneur.append(racine);

  if (!points.length) {
    conteneur.classList.add('vide');
    conteneur.textContent = 'Aucune coordonnée GPS pour ces ménages.';
    return conteneur;
  }

  // Vue initiale : tous les points, avec une marge, au moins ~150 m de large.
  const xs = points.map((p) => versX(p.point.lon));
  const ys = points.map((p) => versY(p.point.lat));
  const latMoy = points.reduce((s, p) => s + p.point.lat, 0) / points.length;
  const minSpan = 150 / metresParUnite(latMoy);
  const spanX = Math.max(Math.max(...xs) - Math.min(...xs), minSpan);
  const spanY = Math.max(Math.max(...ys) - Math.min(...ys), minSpan * (H / LARGEUR));
  const initiale = () => ({
    cx: (Math.max(...xs) + Math.min(...xs)) / 2,
    cy: (Math.max(...ys) + Math.min(...ys)) / 2,
    s: Math.min((LARGEUR * 0.85) / spanX, (H * 0.8) / spanY),
  });
  let vue: VuePlan = options.vue ? { ...options.vue } : initiale();
  let vueTouchee = !!options.vue;
  const ecran = (x: number, y: number) => [(x - vue.cx) * vue.s + LARGEUR / 2, (y - vue.cy) * vue.s + H / 2] as const;

  const coucheTuiles = svg('g', { class: 'tuiles' });
  const couchePoints = svg('g');
  const coucheEchelle = svg('g', { class: 'echelle' });
  racine.append(coucheTuiles, couchePoints, coucheEchelle);

  let generation = 0;
  function dessinerTuiles() {
    const fond = fondCarte();
    coucheTuiles.replaceChildren();
    conteneur.classList.toggle('avec-fond', !!fond);
    if (!fond) return;
    if (fond.vecteur) return dessinerVecteur(fond.vecteur, fond.attribution);
    const gen = ++generation;
    // Niveau de zoom des tuiles le plus proche de l'échelle courante, parmi ceux du paquet.
    const voulu = Math.log2(vue.s / 256);
    const z = fond.zooms.reduce((a, b) => (Math.abs(b - voulu) < Math.abs(a - voulu) ? b : a));
    const n = 2 ** z;
    const taille = vue.s / n;
    const x0 = Math.floor((vue.cx - LARGEUR / 2 / vue.s) * n);
    const x1 = Math.floor((vue.cx + LARGEUR / 2 / vue.s) * n);
    const y0 = Math.floor((vue.cy - H / 2 / vue.s) * n);
    const y1 = Math.floor((vue.cy + H / 2 / vue.s) * n);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return; // trop de tuiles : on attend un zoom plus fort
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (x < 0 || y < 0 || x >= n || y >= n || !fond.existe(z, x, y)) continue;
        const [sx, sy] = ecran(x / n, y / n);
        void fond.tuile(z, x, y).then((url) => {
          if (!url || gen !== generation) return;
          coucheTuiles.append(svg('image', { href: url, x: sx, y: sy, width: taille + 0.5, height: taille + 0.5, preserveAspectRatio: 'none' }));
        });
      }
    }
  }

  /** Fond vectoriel : une seule balise <path> par classe (rapide), éléments hors de la vue ignorés. */
  function dessinerVecteur(f: FondVectoriel, attribution?: string) {
    const [vx0, vy0] = [vue.cx - LARGEUR / 2 / vue.s, vue.cy - H / 2 / vue.s];
    const [vx1, vy1] = [vue.cx + LARGEUR / 2 / vue.s, vue.cy + H / 2 / vue.s];
    const chemins = new Map<string, string[]>();
    const lieux: { x: number; y: number; nom: string }[] = [];
    for (const e of f.elements) {
      const b = emprise(e);
      if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue;
      if (e.classe === 'lieu') {
        const [x, y] = ecran(e.parties[0][0][0], e.parties[0][0][1]);
        if (e.nom) lieux.push({ x, y, nom: e.nom });
        continue;
      }
      const morceaux = chemins.get(e.classe) ?? [];
      for (const partie of e.parties) {
        let d = '';
        let px = NaN;
        let py = NaN;
        for (const [mx, my] of partie) {
          const [x, y] = ecran(mx, my);
          // Points à moins d'un pixel l'un de l'autre : inutiles à l'écran.
          if (d && Math.abs(x - px) < 0.8 && Math.abs(y - py) < 0.8) continue;
          d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
          px = x;
          py = y;
        }
        if (d) morceaux.push(e.surface ? `${d}Z` : d);
      }
      chemins.set(e.classe, morceaux);
    }
    for (const classe of ORDRE_FOND) {
      const m = chemins.get(classe);
      if (m?.length) coucheTuiles.append(svg('path', { d: m.join(''), class: `fond-${classe}` }));
    }
    for (const l of lieux) {
      coucheTuiles.append(svg('circle', { cx: l.x, cy: l.y, r: 3, class: 'fond-lieu' }), svg('text', { x: l.x + 6, y: l.y - 5, class: 'fond-nom-lieu' }, l.nom));
    }
    if (attribution) coucheTuiles.append(svg('text', { x: LARGEUR - 8, y: H - 8, class: 'attribution' }, attribution));
  }

  function dessinerPoints() {
    couchePoints.replaceChildren();
    const mpp = metresParUnite(versLat(vue.cy)) / vue.s; // mètres par pixel
    // Traits des liens entre ménages (sous les points).
    for (const p of points) {
      for (const lien of p.liens ?? []) {
        const [x1, y1] = ecran(versX(p.point.lon), versY(p.point.lat));
        const [x2, y2] = ecran(versX(lien.lon), versY(lien.lat));
        if (Math.max(x1, x2) < 0 || Math.min(x1, x2) > LARGEUR || Math.max(y1, y2) < 0 || Math.min(y1, y2) > H) continue;
        couchePoints.append(svg('line', { x1, y1, x2, y2, class: 'trait-lien' }));
      }
    }
    const ordonnes = [...points].sort((a, b) => Number(!!a.enAvant) - Number(!!b.enAvant));
    for (const p of ordonnes) {
      const [x, y] = ecran(versX(p.point.lon), versY(p.point.lat));
      if (x < -20 || y < -20 || x > LARGEUR + 20 || y > H + 20) continue;
      const g = svg('g', { class: `point${p.enAvant ? ' en-avant' : ''}${options.surClic ? ' cliquable' : ''}` });
      const rayon = p.point.precision ? p.point.precision / mpp : 0;
      if (rayon >= 3) g.append(svg('circle', { cx: x, cy: y, r: rayon, class: 'precision', fill: p.couleur, stroke: p.couleur }));
      g.append(svg('circle', { cx: x, cy: y, r: p.enAvant ? 7 : 5, fill: p.couleur, class: 'marque' }));
      if (options.etiquettes && p.etiquette) g.append(svg('text', { x: x + 9, y: y + 4, class: 'etiquette' }, p.etiquette));
      g.append(svg('title', {}, p.infobulle ?? p.id));
      if (options.surClic) g.addEventListener('click', () => options.surClic!(p.id));
      couchePoints.append(g);
    }
    // Échelle et nord.
    coucheEchelle.replaceChildren();
    const metres = echelleRonde(mpp * 140);
    const px = metres / mpp;
    coucheEchelle.append(
      svg('rect', { x: 10, y: H - 30, width: px + 16, height: 22, rx: 4, class: 'cartouche' }),
      svg('line', { x1: 18, y1: H - 14, x2: 18 + px, y2: H - 14, class: 'barre-echelle' }),
      svg('text', { x: 18, y: H - 18, class: 'texte-echelle' }, formatDistance(metres)),
      svg('text', { x: LARGEUR - 22, y: 24, class: 'nord' }, 'N'),
      svg('path', { d: `M ${LARGEUR - 18} 30 l -5 14 l 5 -4 l 5 4 z`, class: 'fleche-nord' }),
    );
  }

  function dessiner() {
    dessinerTuiles();
    dessinerPoints();
    options.surVue?.({ ...vue });
  }

  // Zoom à la molette autour du curseur, déplacement par glisser.
  const versVue = (e: { clientX: number; clientY: number }) => {
    const r = racine.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * LARGEUR, ((e.clientY - r.top) / r.height) * H] as const;
  };
  const zoomer = (facteur: number, sx = LARGEUR / 2, sy = H / 2) => {
    const wx = vue.cx + (sx - LARGEUR / 2) / vue.s;
    const wy = vue.cy + (sy - H / 2) / vue.s;
    vueTouchee = true;
    vue.s = Math.max(50, Math.min(vue.s * facteur, 2 ** 26));
    vue.cx = wx - (sx - LARGEUR / 2) / vue.s;
    vue.cy = wy - (sy - H / 2) / vue.s;
    dessiner();
  };
  racine.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [sx, sy] = versVue(e);
      zoomer(e.deltaY < 0 ? 1.4 : 1 / 1.4, sx, sy);
    },
    { passive: false },
  );
  racine.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.point.cliquable')) return;
    const depart = versVue(e);
    const v0 = { ...vue };
    racine.setPointerCapture(e.pointerId);
    racine.classList.add('glisse');
    const bouger = (m: PointerEvent) => {
      const [x, y] = versVue(m);
      vueTouchee = true;
      vue.cx = v0.cx - (x - depart[0]) / vue.s;
      vue.cy = v0.cy - (y - depart[1]) / vue.s;
      dessiner();
    };
    const lacher = () => {
      racine.removeEventListener('pointermove', bouger);
      racine.removeEventListener('pointerup', lacher);
      racine.classList.remove('glisse');
    };
    racine.addEventListener('pointermove', bouger);
    racine.addEventListener('pointerup', lacher);
  });

  const commandes = document.createElement('div');
  commandes.className = 'commandes-plan';
  for (const [texte, titre, action] of [
    ['+', 'Zoomer', () => zoomer(1.6)],
    ['−', 'Dézoomer', () => zoomer(1 / 1.6)],
    ['⤢', 'Recentrer sur les points', () => ((vue = initiale()), (vueTouchee = false), dessiner())],
  ] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texte;
    b.title = titre;
    b.setAttribute('aria-label', titre);
    b.addEventListener('click', action);
    commandes.append(b);
  }
  conteneur.append(commandes);

  // Redessine si un fond de carte est chargé ou retiré ; se désabonne quand le plan quitte la page.
  const desabonner = surChangementFond(() => {
    if (!conteneur.isConnected) return desabonner();
    dessiner();
  });
  // Suit la taille du cadre : viewBox = pixels réels, pour que textes et symboles gardent leur taille.
  const ajuster = () => {
    const r = conteneur.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    if (Math.abs(r.width - LARGEUR) < 1 && Math.abs(r.height - H) < 1) return;
    // Garde le même centre ; l'échelle reste celle choisie (ou recadre si l'on n'a pas encore zoomé).
    LARGEUR = r.width;
    H = r.height;
    racine.setAttribute('viewBox', `0 0 ${LARGEUR} ${H}`);
    if (!vueTouchee) vue = initiale();
    dessiner();
  };
  new ResizeObserver(ajuster).observe(conteneur);
  dessiner();
  return conteneur;
}

/** Distances entre tous les ménages d'une liste (comparaison) : [a, b, mètres]. */
export function distancesDeuxADeux(points: { id: string; point: Point }[]): [string, string, number][] {
  const r: [string, string, number][] = [];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) r.push([points[i].id, points[j].id, distance(points[i].point, points[j].point)]);
  return r;
}

/** Palette pour distinguer jusqu'à 12 catégories (enquêteurs, ménages comparés…). */
export const COULEURS = ['#0f5f73', '#c0182b', '#1b7a3d', '#a35a00', '#5b3a8c', '#1f4e79', '#b8336a', '#2f8f83', '#7a5c00', '#455a64', '#8e44ad', '#d35400'];
