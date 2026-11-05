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
// - totaux sur les seuls jours « rempli » (journal non vide et dépense connue).
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
    const etatJour = date > aujourdhui ? "à venir" : !journal.length ? "non rempli" : !dep ? "dépense inconnue" : "rempli";
    jours.push({
      date,
      nomJour: nomJour(date),
      journal,
      totaux: tot,
      activite: act,
      seanceNom: seance(activite, act.seance)?.nom ?? null,
      poids: pesee ? pesee.kg : null,
      depense: dep ? dep.total : null,
      solde: etatJour === "rempli" ? tot.energie - dep.total : null,
      etat: etatJour,
    });
  }
  const comptes = jours.filter((j) => j.etat === "rempli");
  const n = comptes.length;
  const somme = (f) => comptes.reduce((s, j) => s + f(j), 0);
  const pesees = etat.pesees.filter((p) => p.date >= lundi && p.date <= decalerJour(lundi, 6)).sort((a, b) => a.date.localeCompare(b.date));
  const premiere = pesees[0] ?? null;
  const derniere = pesees.length > 1 ? pesees[pesees.length - 1] : null;
  return {
    lundi,
    dimanche: decalerJour(lundi, 6),
    jours,
    totaux: {
      jours: n,
      mange: somme((j) => j.totaux.energie),
      depense: somme((j) => j.depense),
      solde: somme((j) => j.solde),
      soldeMoyen: n ? somme((j) => j.solde) / n : null,
      proteinesMoyennes: n ? somme((j) => j.totaux.proteines) / n : null,
      glucidesMoyens: n ? somme((j) => j.totaux.glucides) / n : null,
      lipidesMoyens: n ? somme((j) => j.totaux.lipides) / n : null,
    },
    poids: { premiere, derniere, difference: premiere && derniere ? derniere.kg - premiere.kg : null },
  };
}

// Verdict de la semaine : « Déficit de 2 350 kcal sur la semaine (6 jours remplis) ».
export function verdictSemaine(b) {
  const { jours: n, solde } = b.totaux;
  if (!n) return "Aucun jour rempli avec une dépense connue : pas de bilan pour cette semaine.";
  const jours = `${n} jour${n > 1 ? "s" : ""} rempli${n > 1 ? "s" : ""}`;
  const kcal = F0.format(Math.abs(solde));
  if (Math.round(solde) === 0) return `Équilibre sur la semaine (${jours})`;
  return `${solde < 0 ? "Déficit" : "Surplus"} de ${kcal} kcal sur la semaine (${jours})`;
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
    ligne("Note", "Dépense estimée : Cunningham × facteur sédentaire FAO + marche + salle. Seuls les jours remplis avec une dépense connue sont comptés."),
    "",
    ligne("Date", "Jour", "État", "kcal mangées", "Dépense (kcal)", "Solde (kcal)", "Protéines (g)", "Glucides (g)", "Lipides (g)", "Pas", "km", "Séance", "Créatine", "Poids (kg)"),
    ...b.jours.map((j) => {
      const venir = j.etat === "à venir";
      const vide = venir || j.etat === "non rempli";
      return ligne(
        j.date, j.nomJour, j.etat,
        vide ? "" : nb(j.totaux.energie, 0), nb(j.depense, 0), nb(j.solde, 0),
        vide ? "" : nb(j.totaux.proteines, 1), vide ? "" : nb(j.totaux.glucides, 1), vide ? "" : nb(j.totaux.lipides, 1),
        venir ? "" : j.activite.pas, venir ? "" : nb(j.activite.km, 2), j.seanceNom ?? "", venir ? "" : j.activite.creatine ? "oui" : "non", nb(j.poids, 1),
      );
    }),
    "",
    ligne("Total (jours comptés)", "", `${t.jours} jour${t.jours > 1 ? "s" : ""}`, nb(t.mange, 0), nb(t.depense, 0), nb(t.solde, 0)),
    ligne("Moyenne par jour", "", "", t.jours ? nb(t.mange / t.jours, 0) : "", t.jours ? nb(t.depense / t.jours, 0) : "", nb(t.soldeMoyen, 0), nb(t.proteinesMoyennes, 1), nb(t.glucidesMoyens, 1), nb(t.lipidesMoyens, 1)),
    ligne("Poids", p.premiere ? `${p.premiere.date} : ${nb(p.premiere.kg, 1)} kg` : "aucune pesée", p.derniere ? `${p.derniere.date} : ${nb(p.derniere.kg, 1)} kg` : "", p.difference === null ? "" : `${p.difference > 0 ? "+" : ""}${nb(p.difference, 1)} kg`),
    ligne("Verdict", verdictSemaine(b)),
  ];
  return "\uFEFF" + lignes.join("\r\n") + "\r\n";
}
