// Tous les calculs de l'appli, sans DOM : apports, totaux, références, dépense, dates, presse-papiers, pesées.
// Testé en Node par outils/test-calculs.mjs.

// ---------- Apports ----------

// Grammes réellement mangés pour une quantité choisie.
// unite : "g" = grammes de l'aliment tel que la fiche le décrit (pesé avec l'os pour une viande, avec la peau
// pour le kiwi vert) ; sinon nombre de pièces. Par défaut l'unité de l'aliment : une entrée de journal sans
// champ « unite » (ancien format) garde donc son sens d'origine.
// taille : id d'une taille de l'aliment (« tailles » de foods.json, ex. tomates cerises) ; la pièce pèse alors
// le poids de cette taille au lieu de poids_unite_g.
export function grammesManges(aliment, quantite, unite = aliment.unite, taille) {
  const t = taille ? aliment.tailles?.find((x) => x.id === taille) : null;
  const pese = unite === "g" ? quantite : quantite * (t ? t.poids_g : aliment.poids_unite_g);
  return pese * aliment.part_comestible;
}

const ACIDES_GRAS = ["oleique", "linoleique", "arachidonique", "ala", "epa", "dha"];

// Teneur pour 100 g utilisée dans les calculs : celle de foods.json, corrigée pour
// - la cuisson (champ « cuisson ») : lipides et acides gras × rétention ; énergie − 9 × lipides × (1 − rétention),
//   9 kcal/g étant le coefficient des lipides (documentation Ciqual 2025, § 3.3.6) ;
// - un produit étiqueté (champ « facteur_acides_gras » = lipides de l'étiquette / lipides Ciqual) : acides gras × facteur.
//   Estimation : on suppose que ses graisses ont le profil de l'entrée Ciqual.
export function teneur(aliment, cle) {
  const v = aliment.valeurs[cle]?.v;
  if (v === null || v === undefined) return null;
  const ret = aliment.cuisson?.retention_lipides ?? 1;
  if (ACIDES_GRAS.includes(cle)) return v * (aliment.facteur_acides_gras ?? 1) * ret;
  if (cle === "lipides") return v * ret;
  if (cle === "energie" && ret !== 1) {
    const l = aliment.valeurs.lipides?.v;
    return l === null || l === undefined ? v : v - 9 * l * (1 - ret);
  }
  return v;
}

// Apport d'un nutriment pour une quantité : grammes mangés × teneur / 100. null si la teneur manque.
export function apport(aliment, quantite, cle, unite, taille) {
  const v = teneur(aliment, cle);
  if (v === null) return null;
  return (grammesManges(aliment, quantite, unite, taille) * v) / 100;
}

// Boutons de grammes d'un aliment en pièces (commodité, pas une donnée nutritionnelle) : quantites_g de
// foods.json, sinon cette liste par défaut.
export const QUANTITES_G_DEFAUT = [50, 100, 150, 200, 250, 300];
export const quantitesG = (aliment) => aliment.quantites_g ?? QUANTITES_G_DEFAUT;

// Bornes du champ « grammes » de l'écran Aliments.
export const SAISIE_GRAMMES = { min: 1, max: 5000 };

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
    if (!al) {
      // Aliment retiré de foods.json : on ne sait plus rien de cette entrée, tous les totaux sont incomplets.
      const nom = `aliment supprimé (${e.alimentId})`;
      for (const n of foods.nutriments) {
        if (absentDeLaTable(n)) continue;
        res[n.cle].incomplet = true;
        if (!res[n.cle].manquants.includes(nom)) res[n.cle].manquants.push(nom);
      }
      continue;
    }
    for (const n of foods.nutriments) {
      if (absentDeLaTable(n)) continue;
      const a = apport(al, e.quantite, n.cle, e.unite, e.taille);
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
// jour = { km, exercices: [ids], seance (ancien format, id de module ou absent) } ; poids en kg ; mg = masse grasse en %.
export function depense(activite, poids, mg, jour) {
  if (!(poids > 0)) return null;
  const assis = activite.met_assis.valeur;
  const repos = activite.repos.a + activite.repos.b * poids * (1 - mg / 100);
  const sedentaire = repos * activite.facteur_journee_sedentaire.valeur;
  const marche = ((jour.km || 0) * (activite.marche.met - assis) * poids) / activite.marche.vitesse_kmh;
  const s = salleDuJour(activite, jour);
  const salle = kcalSalle(activite, s.series, poids);
  return { total: sedentaire + marche + salle, repos, sedentaire, marche, salle, minutesSalle: s.minutes };
}

// Durée affichée d'une séance : séries × (minutes d'effort + minutes de repos).
const minutesPourSeries = (activite, series) => series * (activite.salle.minutes_effort_par_serie + activite.salle.minutes_repos_par_serie);

// Dépense ajoutée par la salle : séries menées à l'échec, MET 02050 sur le seul temps d'effort ;
// le repos entre les séries ne dépense rien de plus que la position assise (déjà dans la journée sédentaire).
export function kcalSalle(activite, series, poids) {
  if (!(poids > 0)) return null;
  return ((series * activite.salle.minutes_effort_par_serie) / 60) * (activite.salle.met - activite.met_assis.valeur) * poids;
}

// Ancien module de séance (format d'avant les exercices : activite.seance), lu dans seances_anciennes.
export function seance(activite, id) {
  const s = (activite.seances_anciennes || []).find((x) => x.id === id);
  if (!s) return null;
  const series = s.groupes.reduce((n, g) => n + g.series, 0);
  return { ...s, series, minutes: minutesPourSeries(activite, series) };
}

// Salle du jour : exercices cochés (ids inconnus ignorés) plus, pour une journée à l'ancien format, le module « seance ».
export function salleDuJour(activite, jour) {
  const exercices = (jour.exercices || []).map((id) => activite.exercices.find((e) => e.id === id)).filter(Boolean);
  const ancienne = seance(activite, jour.seance);
  const series = exercices.reduce((n, e) => n + e.series, 0) + (ancienne ? ancienne.series : 0);
  return { exercices, ancienne, series, minutes: minutesPourSeries(activite, series) };
}

// Libellé court de la salle pour le CSV : « Développé couché, Pec fly (5 séries) » ou « Jambes (10 séries) ».
export function libelleSalle(activite, jour) {
  const s = salleDuJour(activite, jour);
  if (!s.series) return "";
  const noms = [...s.exercices.map((e) => e.nom.replace(/ \(.*\)$/, "")), ...(s.ancienne ? [s.ancienne.nom] : [])];
  return `${noms.join(", ")} (${s.series} séries)`;
}

// ---------- Références ----------

// Référence concrète d'un nutriment : { type, bas, haut } (bornes en unité du nutriment ; null si sans objet),
// { type, inconnue: true } si elle dépend du poids ou de la dépense encore inconnus, ou null sans référence.
// Les références en % de l'énergie (pct_ae) et par MJ (par_mj) portent sur l'ÉNERGIE MANGÉE (energie, kcal) :
// l'ANSES les définit en part de l'apport énergétique et par MJ d'énergie consommée. Seule la ligne Énergie
// (base « depense ») prend la dépense estimée comme repère. raison : « poids » ou « energie » (rien mangé).
export function referenceConcrete(ref, { poids, depense: dep, energie }) {
  if (!ref) return null;
  let raison = null;
  const conv = (x) => {
    if (ref.base === "depense") return dep ?? ((raison = "poids"), NaN);
    if (ref.valeur !== undefined) return x;
    if (ref.par_kg !== undefined) return poids > 0 ? x * poids : ((raison = "poids"), NaN);
    if (ref.par_mj !== undefined) return energie > 0 ? x * energie * 0.004184 : ((raison = "energie"), NaN);
    if (ref.pct_ae !== undefined) return energie > 0 ? (energie * x) / 100 / ref.kcal_par_g : ((raison = "energie"), NaN);
    return NaN;
  };
  const brut = ref.valeur ?? ref.par_kg ?? ref.par_mj ?? ref.pct_ae ?? null;
  const [b, h] = Array.isArray(brut) ? brut.map(conv) : [conv(brut), conv(brut)];
  if (Number.isNaN(b) || Number.isNaN(h)) return { type: ref.type, inconnue: true, raison };
  if (ref.type === "fourchette") return { type: "fourchette", bas: b, haut: h };
  return { type: ref.type, bas: b, haut: b };
}

// Pourcentage et état d'un total face à sa référence.
export function etatReference(total, r) {
  if (!r || r.inconnue) return null;
  // Fourchette : le pourcentage se lit par rapport à la borne basse (le minimum à atteindre).
  const cible = r.bas;
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
  // Texte qui n'est pas un simple nombre (étiquette pour 100 ml, moyenne de plusieurs entrées) : valeur calculée
  // pour 100 g, puis le texte d'origine entre parenthèses.
  if (!/^(<\s*)?\d+(,\d+)?$/.test(val.brut)) return `${formaterNutriment(val.v, n)} (${val.source === "etiquette" ? "étiquette : " : ""}${val.brut})`;
  const texte = `${val.brut} ${n.unite}`;
  if (val.trace) return `${texte} (compté 0)`;
  return n.affichage === "mg" && n.unite === "g" && val.v !== 0 ? `${texte} (${formaterNutriment(val.v, n)})` : texte;
}

// Nombre quelconque au format français (virgule décimale), jusqu'à 3 décimales.
export const formaterNombre = (v) => fmt({ maximumFractionDigits: 4 }).format(v);

// Libellé d'un bouton de quantité : « ½ », « 1 œuf », « 2 œufs », « 150 g ».
export function libelleQuantite(aliment, q, unite = aliment.unite, taille) {
  if (unite === "g") return `${fmt({ maximumFractionDigits: 1 }).format(q)} g`;
  const t = taille ? aliment.tailles?.find((x) => x.id === taille) : null;
  if (t) return `${fmt({ maximumFractionDigits: 2 }).format(q)} ${q > 1 ? aliment.unite_pluriel : aliment.unite} (${q > 1 ? t.nom_pluriel : t.nom.toLowerCase()})`;
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
  return { pas: 0, km: 0, exercices: [], creatine: false };
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

// Tableau des pesées (une par semaine, le lundi) : variation depuis la pesée précédente.
export function tableauPesees(pesees) {
  const tri = [...pesees].sort((a, b) => a.date.localeCompare(b.date));
  return tri.map((p, i) => ({ ...p, variation: i ? p.kg - tri[i - 1].kg : null }));
}

// Rappel du lundi : on est lundi et aucune pesée n'est enregistrée ce jour-là.
export const rappelPesee = (jour, pesees) => jourDate(jour).getDay() === 1 && !pesees.some((p) => p.date === jour);

export function decalerJour(jour, n) {
  const [a, m, j] = jour.split("-").map(Number);
  return jourLocal(new Date(a, m - 1, j + n, 12));
}

// Arrondi à 0,1 kg (ou 0,5 %) sans dérive des additions successives.
export const arrondi1 = (x) => Math.round(x * 10) / 10;

// ---------- Bilan de la semaine (lundi → dimanche) ----------

const NOMS_JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const jourDate = (jour) => {
  const [a, m, j] = jour.split("-").map(Number);
  return new Date(a, m - 1, j, 12);
};
export const nomJour = (jour) => NOMS_JOURS[jourDate(jour).getDay()];
export const estDimanche = (jour) => jourDate(jour).getDay() === 0;

// Lundi de la semaine qui contient ce jour (AAAA-MM-JJ, date locale).
export function lundiDe(jour) {
  return decalerJour(jour, -((jourDate(jour).getDay() + 6) % 7));
}

// Bilan d'une semaine. Règles :
// - jours passés : archives de l'historique au motif « minuit » pour ce jour (journaux concaténés s'il y en a
//   plusieurs, activité de la dernière) ; les archives « manuel » sont des copies de secours d'une remise à zéro
//   voulue et ne comptent pas ;
// - aujourd'hui : l'état en cours ; jours suivants : « à venir » ;
// - dépense du jour : depense() avec la dernière pesée à cette date ou avant. La masse grasse utilisée est le
//   RÉGLAGE ACTUEL pour tous les jours : l'historique de ce réglage n'est pas gardé ;
// - totaux sur les seuls jours « rempli » (journal non vide et dépense connue) ;
// - poids (une pesée par semaine, le lundi matin) : début = dernière pesée au lundi L ou avant ; fin = première
//   pesée à L + 7 ou après (normalement le lundi suivant), qui montre le résultat de la semaine. Sans pesée de fin,
//   le résultat est attendu à la pesée de lundi prochain.
export function bilanSemaine({ lundi, aujourdhui, etat, historique, foods, activite }) {
  const mg = etat.reglages.masseGrasse;
  const jours = [];
  for (let i = 0; i < 7; i++) {
    const date = decalerJour(lundi, i);
    let journal = [];
    let act = activiteVide();
    if (date === aujourdhui && etat.jour === aujourdhui) {
      journal = etat.journal;
      act = { ...activiteVide(), ...etat.activite };
    } else if (date < aujourdhui) {
      const archives = historique.filter((h) => h.jour === date && h.motif === "minuit");
      journal = archives.flatMap((h) => h.journal || []);
      if (archives.length) act = { ...activiteVide(), ...archives[archives.length - 1].activite };
    }
    const t = totaux(journal, foods);
    const tot = Object.fromEntries(["energie", "proteines", "glucides", "lipides"].map((c) => [c, t[c].total]));
    const pesee = etat.pesees.find((p) => p.date === date);
    const dep = date > aujourdhui ? null : depense(activite, poidsDuJour(etat.pesees, date), mg, act);
    const etatJour = date > aujourdhui ? "à venir" : !journal.length ? "non rempli" : !dep ? "dépense inconnue" : date === aujourdhui ? "en cours" : "rempli";
    jours.push({
      date,
      nomJour: nomJour(date),
      journal,
      totaux: tot,
      activite: act,
      salle: libelleSalle(activite, act),
      poids: pesee ? pesee.kg : null,
      depense: dep ? dep.total : null,
      solde: etatJour === "rempli" || etatJour === "en cours" ? tot.energie - dep.total : null,
      etat: etatJour,
    });
  }
  // Totaux : jours TERMINÉS remplis ; puis les mêmes avec la journée en cours (le dimanche soir, la semaine complète).
  const totauxDe = (comptes) => {
    const n = comptes.length;
    const somme = (f) => comptes.reduce((s, j) => s + f(j), 0);
    return {
      jours: n,
      mange: somme((j) => j.totaux.energie),
      depense: somme((j) => j.depense),
      solde: somme((j) => j.solde),
      soldeMoyen: n ? somme((j) => j.solde) / n : null,
      proteinesMoyennes: n ? somme((j) => j.totaux.proteines) / n : null,
      glucidesMoyens: n ? somme((j) => j.totaux.glucides) / n : null,
      lipidesMoyens: n ? somme((j) => j.totaux.lipides) / n : null,
    };
  };
  const enCours = jours.some((j) => j.etat === "en cours");
  const tri = [...etat.pesees].sort((a, b) => a.date.localeCompare(b.date));
  const lundiSuivant = decalerJour(lundi, 7);
  const debut = tri.filter((p) => p.date <= lundi).at(-1) ?? null;
  const fin = tri.find((p) => p.date >= lundiSuivant) ?? null;
  return {
    lundi,
    dimanche: decalerJour(lundi, 6),
    jours,
    totaux: totauxDe(jours.filter((j) => j.etat === "rempli")),
    totauxAvecAujourdhui: enCours ? totauxDe(jours.filter((j) => j.etat === "rempli" || j.etat === "en cours")) : null,
    poids: { debut, fin, lundiSuivant, difference: debut && fin ? fin.kg - debut.kg : null },
  };
}

// Pesée lisible : « 80,0 kg (lun. 02/11) ».
export function textePesee(p) {
  const d = jourDate(p.date);
  const jj = (n) => String(n).padStart(2, "0");
  return `${F1.format(p.kg)} kg (${NOMS_JOURS[d.getDay()].slice(0, 3)}. ${jj(d.getDate())}/${jj(d.getMonth() + 1)})`;
}

// Évolution du poids sur la semaine (voir la règle de bilanSemaine).
export function texteEvolutionPoids(poids) {
  const { debut, fin, lundiSuivant, difference } = poids;
  const [, m, j] = lundiSuivant.split("-");
  if (!fin) {
    const attente = `Résultat à la pesée de lundi prochain (${j}/${m})`;
    return debut ? `Poids de début : ${textePesee(debut)}. ${attente}.` : `Aucune pesée de début. ${attente}.`;
  }
  if (!debut) return `Poids : ${textePesee(fin)} ; aucune pesée de début.`;
  const signe = difference > 0 ? "+" : difference < 0 ? "−" : "±";
  return `Poids : ${textePesee(debut)} → ${textePesee(fin)}, soit ${signe}${F1.format(Math.abs(difference))} kg`;
}

// Verdict de la semaine : « Déficit de 2 350 kcal sur la semaine (6 jours remplis) ».
// Porte sur les jours terminés ; verdictAvecAujourdhui ajoute la journée en cours.
export function verdictSemaine(b) {
  const { jours: n, solde } = b.totaux;
  if (!n) return "Aucun jour terminé et rempli avec une dépense connue : pas encore de bilan pour cette semaine.";
  const jours = `${n} jour${n > 1 ? "s" : ""} rempli${n > 1 ? "s" : ""}`;
  const kcal = F0.format(Math.abs(solde));
  if (Math.round(solde) === 0) return `Équilibre sur la semaine (${jours})`;
  return `${solde < 0 ? "Déficit" : "Surplus"} de ${kcal} kcal sur la semaine (${jours})`;
}

// « Avec aujourd'hui (en cours) : déficit de 7 836 kcal (3 jours) », ou null sans journée en cours.
export function verdictAvecAujourdhui(b) {
  const t = b.totauxAvecAujourdhui;
  if (!t) return null;
  const jours = `${t.jours} jour${t.jours > 1 ? "s" : ""}`;
  if (Math.round(t.solde) === 0) return `Avec aujourd'hui (en cours) : équilibre (${jours})`;
  return `Avec aujourd'hui (en cours) : ${t.solde < 0 ? "déficit" : "surplus"} de ${F0.format(Math.abs(t.solde))} kcal (${jours})`;
}

// Fichier CSV pour Excel en français : UTF-8 avec BOM, séparateur « ; », virgule décimale, sans séparateur de milliers.
export function csvSemaine(b, { genereLe, profil, masseGrasse }) {
  const nb = (v, d) => (v === null || v === undefined ? "" : (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace(".", ",").replace(/^-0(,0*)?$/, "0$1"));
  const champ = (x) => (/[;"\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));
  const ligne = (...c) => c.map(champ).join(";");
  const longue = (j) => jourDate(j).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const t = b.totaux;
  const p = b.poids;
  const lignes = [
    ligne("Bilan de la semaine"),
    ligne("Période", `du ${longue(b.lundi)} au ${longue(b.dimanche)}`),
    ligne("Généré le", genereLe),
    ligne("Profil", `${profil} Masse grasse (réglage actuel) : ${nb(masseGrasse, 1)} %.`),
    ligne("Note", "Dépense estimée : Cunningham × facteur sédentaire FAO + marche + salle. Seuls les jours terminés et remplis, avec une dépense connue, sont comptés ; la journée en cours est ajoutée à part."),
    "",
    ligne("Date", "Jour", "État", "kcal mangées", "Dépense (kcal)", "Solde (kcal)", "Protéines (g)", "Glucides (g)", "Lipides (g)", "Pas", "km", "Séance", "Créatine", "Poids (kg)"),
    ...b.jours.map((j) => {
      const venir = j.etat === "à venir";
      const vide = venir || j.etat === "non rempli";
      return ligne(
        j.date, j.nomJour, j.etat,
        vide ? "" : nb(j.totaux.energie, 0), nb(j.depense, 0), nb(j.solde, 0),
        vide ? "" : nb(j.totaux.proteines, 1), vide ? "" : nb(j.totaux.glucides, 1), vide ? "" : nb(j.totaux.lipides, 1),
        venir ? "" : j.activite.pas, venir ? "" : nb(j.activite.km, 2), j.salle, venir ? "" : j.activite.creatine ? "oui" : "non", nb(j.poids, 1),
      );
    }),
    "",
    ligne("Total (jours terminés comptés)", "", `${t.jours} jour${t.jours > 1 ? "s" : ""}`, nb(t.mange, 0), nb(t.depense, 0), nb(t.solde, 0)),
    ...(b.totauxAvecAujourdhui
      ? [ligne("Total avec aujourd'hui (en cours)", "", `${b.totauxAvecAujourdhui.jours} jour${b.totauxAvecAujourdhui.jours > 1 ? "s" : ""}`, nb(b.totauxAvecAujourdhui.mange, 0), nb(b.totauxAvecAujourdhui.depense, 0), nb(b.totauxAvecAujourdhui.solde, 0))]
      : []),
    ligne("Moyenne par jour", "", "", t.jours ? nb(t.mange / t.jours, 0) : "", t.jours ? nb(t.depense / t.jours, 0) : "", nb(t.soldeMoyen, 0), nb(t.proteinesMoyennes, 1), nb(t.glucidesMoyens, 1), nb(t.lipidesMoyens, 1)),
    ligne("Poids", p.debut ? textePesee(p.debut) : "aucune pesée", p.fin ? textePesee(p.fin) : "", p.difference === null ? "" : `${p.difference > 0 ? "+" : ""}${nb(p.difference, 1)} kg`, p.fin ? "" : texteEvolutionPoids(p).replace(/^.*\. (Résultat)/, "$1")),
    ligne("Verdict", verdictSemaine(b)),
    ...(b.totauxAvecAujourdhui ? [ligne("Verdict avec aujourd'hui", verdictAvecAujourdhui(b))] : []),
  ];
  return "\uFEFF" + lignes.join("\r\n") + "\r\n";
}
