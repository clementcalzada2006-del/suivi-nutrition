// Tous les calculs de l'appli, sans DOM : apports, totaux, références, dépense, dates, presse-papiers, pesées.
// Testé en Node par outils/test-calculs.mjs.

// ---------- Apports ----------

// Grammes réellement mangés pour une quantité choisie (unité "g" : grammes pesés ; sinon nombre de pièces).
export function grammesManges(aliment, quantite) {
  const pese = aliment.unite === "g" ? quantite : quantite * aliment.poids_unite_g;
  return pese * aliment.part_comestible;
}

// Apport d'un nutriment pour une quantité : grammes mangés × teneur / 100. null si la teneur manque.
export function apport(aliment, quantite, cle) {
  const v = aliment.valeurs[cle]?.v;
  if (v === null || v === undefined) return null;
  return (grammesManges(aliment, quantite) * v) / 100;
}

// Nutriment absent des 74 constituants de la table (ex. biotine, « ciqual »: []) : aucun total possible.
export const absentDeLaTable = (n) => Array.isArray(n.ciqual) && n.ciqual.length === 0;

// Totaux du jour : { cle: { total, incomplet, manquants: [noms d'aliments sans donnée] } }.
// Valeurs complètes, jamais arrondies ici. Un nutriment absent de la table a total null et n'est jamais « incomplet ».
export function totaux(journal, foods) {
  const parId = indexAliments(foods);
  const res = {};
  for (const n of foods.nutriments) res[n.cle] = { total: absentDeLaTable(n) ? null : 0, incomplet: false, manquants: [], absent: absentDeLaTable(n) };
  for (const e of journal) {
    const al = parId[e.alimentId];
    if (!al) continue;
    for (const n of foods.nutriments) {
      if (absentDeLaTable(n)) continue;
      const a = apport(al, e.quantite, n.cle);
      const t = res[n.cle];
      if (a === null) {
        t.incomplet = true;
        if (!t.manquants.includes(al.nom)) t.manquants.push(al.nom);
      } else t.total += a;
    }
  }
  return res;
}

export function indexAliments(foods) {
  return Object.fromEntries(foods.aliments.map((a) => [a.id, a]));
}

// Rapport de deux sommes de totaux : { valeur (null si le dénominateur est nul), incomplet, manquants }.
function rapport(t, num, den) {
  const somme = (cles) => cles.reduce((s, c) => s + t[c].total, 0);
  const d = somme(den);
  return {
    valeur: d > 0 ? somme(num) / d : null,
    incomplet: [...num, ...den].some((c) => t[c].incomplet),
    manquants: [...new Set([...num, ...den].flatMap((c) => t[c].manquants))],
  };
}

// Rapport acide linoléique / ALA (référence ANSES : à ne pas dépasser, references.json).
export const rapportLinoleiqueAla = (t) => rapport(t, ["linoleique"], ["ala"]);

// Rapport oméga 6 / oméga 3 total = (linoléique + arachidonique) / (ALA + EPA + DHA), sans référence.
export const rapportOmega = (t) => rapport(t, ["linoleique", "arachidonique"], ["ala", "epa", "dha"]);

// ---------- Dépense ----------

// Dépense du jour (kcal) ou null sans poids. activite = donnees/activite.json.
// jour = { km, seance (id ou null) } ; poids en kg ; mg = masse grasse en %.
export function depense(activite, poids, mg, jour) {
  if (!(poids > 0)) return null;
  const assis = activite.met_assis.valeur;
  const repos = activite.repos.a + activite.repos.b * poids * (1 - mg / 100);
  const sedentaire = repos * activite.facteur_journee_sedentaire.valeur;
  const marche = ((jour.km || 0) * (activite.marche.met - assis) * poids) / activite.marche.vitesse_kmh;
  const s = seance(activite, jour.seance);
  const salle = s ? (s.minutes / 60) * (activite.salle.met - assis) * poids : 0;
  return { total: sedentaire + marche + salle, repos, sedentaire, marche, salle, minutesSalle: s ? s.minutes : 0 };
}

// Séries et durée estimée d'un module de séance.
export function seance(activite, id) {
  const s = activite.seances.find((x) => x.id === id);
  if (!s) return null;
  const series = s.groupes.reduce((n, g) => n + g.series, 0);
  return { ...s, series, minutes: series * (activite.salle.minutes_effort_par_serie + activite.salle.minutes_repos_par_serie) };
}

// ---------- Références ----------

// Référence concrète d'un nutriment : { type, bas, haut } (bornes en unité du nutriment ; null si sans objet),
// { type, inconnue: true } si elle dépend du poids ou de la dépense encore inconnus, ou null sans référence.
export function referenceConcrete(ref, { poids, depense: dep }) {
  if (!ref) return null;
  const conv = (x) => {
    if (ref.base === "depense") return dep ?? NaN;
    if (ref.valeur !== undefined) return x;
    if (ref.par_kg !== undefined) return poids > 0 ? x * poids : NaN;
    if (ref.par_mj !== undefined) return dep != null ? x * dep * 0.004184 : NaN;
    if (ref.pct_ae !== undefined) return dep != null ? (dep * x) / 100 / ref.kcal_par_g : NaN;
    return NaN;
  };
  const brut = ref.valeur ?? ref.par_kg ?? ref.par_mj ?? ref.pct_ae ?? null;
  const [b, h] = Array.isArray(brut) ? brut.map(conv) : [conv(brut), conv(brut)];
  if (Number.isNaN(b) || Number.isNaN(h)) return { type: ref.type, inconnue: true };
  if (ref.type === "fourchette") return { type: "fourchette", bas: b, haut: h };
  return { type: ref.type, bas: b, haut: b };
}

// Pourcentage et état d'un total face à sa référence.
export function etatReference(total, r) {
  if (!r || r.inconnue) return null;
  const cible = r.type === "fourchette" ? r.haut : r.bas;
  const pct = cible > 0 ? (total / cible) * 100 : 0;
  let etat;
  if (r.type === "max") etat = total > r.bas ? "depasse" : "ok";
  else if (r.type === "fourchette") etat = total < r.bas ? "sous" : total > r.haut ? "depasse" : "ok";
  else etat = total >= r.bas ? "ok" : "sous";
  return { pct, etat };
}

// ---------- Affichage des nombres ----------

const fmt = (opts) => new Intl.NumberFormat("fr-FR", opts);
const F0 = fmt({ maximumFractionDigits: 0 });
const F1 = fmt({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
const F3S = fmt({ maximumSignificantDigits: 3 });

// kcal à l'unité, g à 0,1, mg et µg à 3 chiffres significatifs. null -> « — ».
export function formater(v, unite) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (unite === "kcal") return F0.format(v);
  if (unite === "g") return F1.format(v);
  return F3S.format(v);
}

// Valeur d'un nutriment avec son unité d'affichage. Un nutriment marqué « affichage: "mg" » est stocké en g
// mais affiché en mg (EPA, DHA, arachidonique) : seule la présentation change, jamais le calcul.
export function formaterNutriment(v, n) {
  if (n.affichage === "mg" && n.unite === "g") return `${formater(v === null || v === undefined ? v : v * 1000, "mg")} mg`;
  return `${formater(v, n.unite)} ${n.unite}`;
}

// Teneur pour 100 g telle que la table l'écrit (« 0,06 g », « < 0,35 g (compté 0) », « traces (compté 0) »).
export function teneurTable(val, n) {
  if (val?.brut === "absent de la table") return "absente de Ciqual";
  if (!val || val.v === null || val.v === undefined) return "non disponible";
  if (val.brut === undefined || val.brut === "absent") return formaterNutriment(val.v, n);
  if (/^traces$/i.test(val.brut)) return "traces (compté 0)";
  const texte = `${val.brut} ${n.unite}`;
  if (val.trace) return `${texte} (compté 0)`;
  return n.affichage === "mg" && n.unite === "g" && val.v !== 0 ? `${texte} (${formaterNutriment(val.v, n)})` : texte;
}

// Nombre quelconque au format français (virgule décimale), jusqu'à 3 décimales.
export const formaterNombre = (v) => fmt({ maximumFractionDigits: 4 }).format(v);

// Libellé d'un bouton de quantité : « ½ », « 1 œuf », « 2 œufs », « 150 g ».
export function libelleQuantite(aliment, q) {
  if (aliment.unite === "g") return `${F0.format(q)} g`;
  const nombre = q === 0.5 ? "½" : fmt({ maximumFractionDigits: 2 }).format(q);
  if (q === 0.5) return `${nombre} ${aliment.unite}`;
  return `${nombre} ${q > 1 ? aliment.unite_pluriel : aliment.unite}`;
}

// ---------- Dates et journée ----------

// Date locale AAAA-MM-JJ.
export function jourLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function activiteVide() {
  return { pas: 0, km: 0, seance: null, creatine: false };
}

// Archive la journée en cours puis la vide. Renvoie { etat, historique } nouveaux (sans modifier les anciens).
export function remiseAZero(etat, historique, motif, maintenant, nouveauJour = etat.jour) {
  const archive = { jour: etat.jour, motif, archiveLe: maintenant.toISOString(), journal: etat.journal, activite: etat.activite };
  return {
    etat: { ...etat, jour: nouveauJour, journal: [], activite: activiteVide() },
    historique: [...historique, archive],
  };
}

// Si la date a changé depuis le dernier enregistrement : archive la veille et commence une journée vide.
export function changementDeJour(etat, historique, maintenant) {
  const aujourdhui = jourLocal(maintenant);
  if (etat.jour === aujourdhui) return null;
  return remiseAZero(etat, historique, "minuit", maintenant, aujourdhui);
}

// ---------- Presse-papiers (Raccourci iPhone) ----------

// Extrait { pas, km } d'un texte comme « 8 432 pas 6,21 km » ou « Pas : 8432 ; Distance : 6.2 km ».
// Tolère espaces fines ou insécables, virgule ou point, ordre quelconque. null si rien d'exploitable.
export function analyserPressePapiers(texte) {
  if (typeof texte !== "string") return null;
  const t = texte.replace(/[    ]/g, " ").slice(0, 500);
  const NB = String.raw`(\d{1,3}(?: \d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)`;
  const nombre = (s) => Number(s.replace(/ /g, "").replace(",", "."));
  const res = {};
  const km = t.match(new RegExp(NB + String.raw`\s*km\b`, "i"));
  if (km) res.km = nombre(km[1]);
  const pas = t.match(new RegExp(NB + String.raw`\s*pas\b`, "i")) || t.match(new RegExp(String.raw`\bpas\b\s*[:=]?\s*` + NB, "i"));
  if (pas) {
    // Un nombre de pas est entier : « 8,432 » ou « 8.432 » est un séparateur de milliers.
    const s = pas[1].replace(/ /g, "");
    res.pas = /^\d{1,3}[.,]\d{3}$/.test(s) ? Number(s.replace(/[.,]/, "")) : Math.round(nombre(s));
  }
  if (res.km !== undefined && !(res.km >= 0 && res.km <= 300)) delete res.km;
  if (res.pas !== undefined && !(res.pas >= 0 && res.pas <= 200000)) delete res.pas;
  return res.km === undefined && res.pas === undefined ? null : res;
}

// ---------- Saisie au clavier ----------

// Lit un nombre tapé (virgule ou point, espaces tolérées) et le valide : { valeur } ou { erreur: message }.
export function lireSaisie(texte, { min, max, entier = false }) {
  const t = String(texte ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const borne = (x) => new Intl.NumberFormat("fr-FR").format(x);
  if (!/^\d+(\.\d+)?$/.test(t)) return { erreur: entier ? "Tape un nombre entier." : "Tape un nombre (virgule ou point)." };
  const v = Number(t);
  if (entier && !Number.isInteger(v)) return { erreur: "Nombre entier attendu, sans virgule." };
  if (v < min || v > max) return { erreur: `Valeur entre ${borne(min)} et ${borne(max)} attendue.` };
  return { valeur: v };
}

// ---------- Pesées ----------

// Dernière pesée à la date donnée ou avant (pesees triées ou non). null s'il n'y en a pas.
export function poidsDuJour(pesees, jour) {
  const avant = pesees.filter((p) => p.date <= jour).sort((a, b) => a.date.localeCompare(b.date));
  return avant.length ? avant[avant.length - 1].kg : null;
}

// Tableau des pesées : variation depuis la précédente et moyenne des pesées des 7 derniers jours (date comprise).
export function tableauPesees(pesees) {
  const tri = [...pesees].sort((a, b) => a.date.localeCompare(b.date));
  return tri.map((p, i) => {
    const debut = decalerJour(p.date, -6);
    const fen = tri.filter((x) => x.date >= debut && x.date <= p.date);
    return {
      ...p,
      variation: i ? p.kg - tri[i - 1].kg : null,
      moyenne7: fen.reduce((s, x) => s + x.kg, 0) / fen.length,
    };
  });
}

export function decalerJour(jour, n) {
  const [a, m, j] = jour.split("-").map(Number);
  return jourLocal(new Date(a, m - 1, j + n, 12));
}

// Arrondi à 0,1 kg (ou 0,5 %) sans dérive des additions successives.
export const arrondi1 = (x) => Math.round(x * 10) / 10;
