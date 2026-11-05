// Interface de l'appli : affichage et gestes. Aucun calcul ici : tout passe par calculs.js.
import * as C from "./calculs.js";
import * as S from "./stockage.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ONGLETS = ["aliments", "journal", "bilan", "activite", "poids"];
const GROUPES_BILAN = [
  { groupe: "macros", titre: "Macros" },
  { groupe: "omega", titre: "Oméga" },
  { groupe: "vitamines", titre: "Vitamines" },
  { groupe: "mineraux", titre: "Minéraux" },
];
const LIBELLE_TYPE = { min: "À atteindre", max: "À ne pas dépasser", fourchette: "Fourchette", egal: "Objectif" };

let foods, refs, activite, parId, nutParCle;
let etat, historique;
const ui = { onglet: "aliments", replies: new Set(), ouvert: null, poids: null, manquantsOuverts: new Set(), presse: "" };

// ---------- Démarrage ----------

async function demarrer() {
  const charger = (f) => fetch(f).then((r) => (r.ok ? r.json() : Promise.reject(new Error(f))));
  [foods, refs, activite] = await Promise.all(["donnees/foods.json", "donnees/references.json", "donnees/activite.json"].map(charger));
  parId = C.indexAliments(foods);
  nutParCle = Object.fromEntries(foods.nutriments.map((n) => [n.cle, n]));

  $("#bandeau-stockage").hidden = S.testerStockage();
  etat = S.chargerEtat(activite.masse_grasse_pct_defaut);
  historique = S.chargerHistorique();
  verifierJour(false);
  ui.poids = derniereKg() ?? 70;

  $(".chargement")?.remove();
  rendreAliments();
  const h = location.hash.slice(1);
  allerOnglet(ONGLETS.includes(h) ? h : "aliments", false);
  rafraichir();

  document.addEventListener("click", surClic);
  // Remise à zéro à minuit : au retour au premier plan, au retour depuis le cache de navigation, et toutes les 30 s.
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && verifierJour());
  window.addEventListener("pageshow", () => verifierJour());
  setInterval(() => verifierJour(), 30000);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

function sauver() {
  S.enregistrerEtat(etat);
  S.enregistrerHistorique(historique);
  $("#bandeau-stockage").hidden = S.stockageDisponible();
}

// Nouveau jour : archive la veille et repart d'une journée vide.
function verifierJour(afficher = true) {
  const r = C.changementDeJour(etat, historique, new Date());
  if (!r) return;
  etat = r.etat;
  historique = r.historique;
  sauver();
  if (afficher) {
    cacherToast(); // un « Annuler » de la veille ne doit pas agir sur la nouvelle journée
    rafraichir();
  }
}

// ---------- Calculs du moment ----------

const derniereKg = () => C.poidsDuJour(etat.pesees, "9999-12-31");
function contexte() {
  const poids = C.poidsDuJour(etat.pesees, etat.jour);
  const dep = C.depense(activite, poids, etat.reglages.masseGrasse, etat.activite);
  return { poids, dep, t: C.totaux(etat.journal, foods) };
}

function rafraichir() {
  // Les blocs <details> ouverts restent ouverts après le nouvel affichage.
  const ouverts = [...document.querySelectorAll("details[data-garde][open]")].map((d) => d.dataset.garde);
  const ctx = contexte();
  rendreEntete(ctx);
  rendreJournal();
  rendreBilan(ctx);
  rendreActivite(ctx);
  rendrePoids();
  for (const g of ouverts) $(`details[data-garde="${g}"]`)?.setAttribute("open", "");
}

// ---------- Onglets ----------

function allerOnglet(nom, haut = true) {
  ui.onglet = nom;
  for (const o of ONGLETS) $(`#vue-${o}`).hidden = o !== nom;
  document.querySelectorAll(".onglets button").forEach((b) => b.setAttribute("aria-current", b.dataset.onglet === nom ? "page" : "false"));
  history.replaceState(null, "", "#" + nom);
  if (haut) window.scrollTo(0, 0);
}

// ---------- En-tête ----------

function rendreEntete({ t, dep }) {
  const pose = (id, cle, unite) => {
    const el = $(id);
    el.textContent = C.formater(t[cle].total, unite);
    el.dataset.total = String(t[cle].total);
    el.classList.toggle("est-incomplet", t[cle].incomplet);
  };
  pose("#e-kcal", "energie", "kcal");
  pose("#e-proteines", "proteines", "g");
  pose("#e-glucides", "glucides", "g");
  pose("#e-lipides", "lipides", "g");
  $("#e-depense").textContent = dep ? `/ ${C.formater(dep.total, "kcal")} estimées` : "";
  const cles = ["energie", "proteines", "glucides", "lipides"];
  $("#e-incomplet").hidden = !cles.some((c) => t[c].incomplet);
  const e = $("#entete");
  e.classList.remove("pulse");
  void e.offsetWidth; // relance l'animation
  e.classList.add("pulse");
}

// ---------- Aliments ----------

function rendreAliments() {
  const html = foods.categories
    .map((cat) => {
      const als = foods.aliments.filter((a) => a.categorie === cat);
      return `<section class="categorie" data-cat="${esc(cat)}">
        <button class="cat-tete" data-act="categorie" data-cat="${esc(cat)}" aria-expanded="true">
          <span>${esc(cat)}</span><span class="chevron" aria-hidden="true">▾</span></button>
        <div class="cat-corps">${als.map(htmlAliment).join("")}</div></section>`;
    })
    .join("");
  $("#vue-aliments").innerHTML = html;
}

function htmlAliment(a) {
  const boutons = a.quantites.map((q) => `<button class="q" data-act="ajouter" data-id="${a.id}" data-q="${q}">${esc(C.libelleQuantite(a, q))}</button>`);
  if (a.ajustement_g) boutons.push(`<button class="q q-ajust" data-act="ajouter" data-id="${a.id}" data-q="${a.ajustement_g}">+${a.ajustement_g} g</button>`);
  return `<div class="aliment" data-id="${a.id}">
    <div class="al-ligne">
      <button class="al-nom" data-act="aliment" data-id="${a.id}" aria-expanded="false">
        <span class="emoji" aria-hidden="true">${a.icone}</span><span class="al-texte">${esc(a.nom)}${a.a_confirmer ? ' <span class="badge">à confirmer</span>' : ""}</span>
      </button>
      <button class="al-info" data-act="fiche" data-id="${a.id}" aria-label="Fiche : ${esc(a.nom)}">i</button>
    </div>
    <div class="quantites" hidden>${boutons.join("")}</div>
  </div>`;
}

function basculerAliment(id) {
  const el = $(`.aliment[data-id="${id}"]`);
  const ouvrir = el.querySelector(".quantites").hidden;
  document.querySelectorAll(".aliment").forEach((x) => {
    x.querySelector(".quantites").hidden = true;
    x.querySelector(".al-nom").setAttribute("aria-expanded", "false");
    x.classList.remove("ouvert");
  });
  if (ouvrir) {
    el.querySelector(".quantites").hidden = false;
    el.querySelector(".al-nom").setAttribute("aria-expanded", "true");
    el.classList.add("ouvert");
  }
}

function ajouter(id, q, bouton) {
  const al = parId[id];
  const entree = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), alimentId: id, quantite: q, heure: new Date().toISOString() };
  etat.journal.push(entree);
  sauver();
  rafraichir();
  bouton?.classList.remove("flash");
  void bouton?.offsetWidth;
  bouton?.classList.add("flash");
  toast(`Ajouté : ${libelleEntree(al, q)}`, () => {
    etat.journal = etat.journal.filter((e) => e.id !== entree.id);
    sauver();
    rafraichir();
  });
}

const libelleEntree = (al, q) => (al.unite === "g" ? `${C.libelleQuantite(al, q)} de ${al.nom}` : `${C.libelleQuantite(al, q)} · ${al.nom}`);

// ---------- Fiche d'un aliment ----------

function ouvrirFiche(id) {
  const a = parId[id];
  const q0 = a.quantites[0];
  const g0 = C.grammesManges(a, q0);
  const portion = `${C.libelleQuantite(a, q0)}${a.unite !== "g" || a.part_comestible !== 1 ? ` (${C.formater(g0, "g")} g mangés)` : ""}`;
  const provenance = (val) => {
    if (val.source === "etiquette") return `Étiquette${val.origine ? ` : ${esc(val.origine)}` : ""}${val.date ? ` (${esc(val.date)})` : ""}`;
    const base = `Ciqual ${val.code} « ${esc(a.ciqual.nom)} », constituant ${val.const}`;
    return val.source === "estime" ? `Estimé : aliment voisin ${base}` : base;
  };
  const lignes = GROUPES_BILAN.map(({ groupe, titre }) => {
    const nuts = foods.nutriments.filter((n) => n.groupe === groupe);
    return `<h3>${titre}</h3>${nuts
      .map((n) => {
        const val = a.valeurs[n.cle];
        const nul = val?.v === null || val?.v === undefined;
        const absent = C.absentDeLaTable(n);
        const p100 = esc(C.teneurTable(val, n)); // chiffre officiel, tel qu'écrit dans la table
        const ppor = absent ? "absente de Ciqual" : nul ? "non disponible" : C.formaterNutriment(C.apport(a, q0, n.cle), n);
        return `<div class="fiche-ligne${nul ? " nul" : ""}" data-cle="${n.cle}">
          <div class="fiche-nom">${esc(n.nom)}</div>
          <div class="fiche-vals"><span class="fiche-100">${p100}<small> / 100 g</small></span><span>${ppor}<small> / ${esc(C.libelleQuantite(a, q0))}</small></span></div>
          <div class="fiche-prov">${absent ? esc(n.note || "Absente de la table Ciqual 2025") : val ? provenance(val) : "non disponible"}${val?.trace ? " · traces ou valeur sous le seuil" : ""}</div>
        </div>`;
      })
      .join("")}`;
  }).join("");
  ouvrirFeuille(`
    <div class="feuille-tete"><h2><span aria-hidden="true">${a.icone}</span> ${esc(a.nom)}</h2>${a.a_confirmer ? '<span class="badge">à confirmer</span>' : ""}</div>
    <dl class="fiche-meta">
      <dt>Portion</dt><dd>${esc(portion)}${a.poids_unite_g ? ` · 1 ${esc(a.unite)} = ${C.formater(a.poids_unite_g, "g")} g` : ""}</dd>
      ${a.poids_source ? `<dt>Poids de la portion</dt><dd>${esc(a.poids_source)}</dd>` : ""}
      <dt>Part comestible</dt><dd>${Math.round(a.part_comestible * 100)} %${a.part_comestible_source ? ` · ${esc(a.part_comestible_source)}` : ""}</dd>
      <dt>État</dt><dd>${esc(a.etat)}</dd>
      <dt>Entrée Ciqual</dt><dd>${a.ciqual.code} « ${esc(a.ciqual.nom)} » (table du ${esc(foods.table_ciqual.date)})</dd>
      ${a.notes ? `<dt>Notes</dt><dd>${esc(a.notes)}</dd>` : ""}
    </dl>
    ${lignes}
    <button class="btn btn-large" data-act="fermer">Fermer</button>`);
}

// ---------- Journal ----------

function rendreJournal() {
  const lignes = [...etat.journal]
    .map((e, i) => ({ e, i }))
    .reverse()
    .map(({ e }) => {
      const al = parId[e.alimentId];
      if (!al) return "";
      const v = (c) => C.apport(al, e.quantite, c);
      const h = new Date(e.heure).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      return `<li class="j-ligne" data-id="${e.id}">
        <div class="j-tete"><span class="j-heure">${h}</span><span class="j-nom"><span aria-hidden="true">${al.icone}</span> ${esc(al.nom)}${al.a_confirmer ? ' <span class="badge">à confirmer</span>' : ""}</span></div>
        <div class="j-detail"><span class="j-q">${esc(C.libelleQuantite(al, e.quantite))}</span>
          <span><b>${C.formater(v("energie"), "kcal")}</b> kcal</span>
          <span class="c-prot">P ${C.formater(v("proteines"), "g")}</span>
          <span class="c-gluc">G ${C.formater(v("glucides"), "g")}</span>
          <span class="c-lip">L ${C.formater(v("lipides"), "g")}</span></div>
        <button class="j-suppr" data-act="supprimer" data-id="${e.id}" aria-label="Supprimer ${esc(al.nom)}">✕</button>
      </li>`;
    })
    .join("");
  $("#vue-journal").innerHTML = `
    <h2>Journal du ${dateLongue(etat.jour)}</h2>
    ${etat.journal.length ? `<ul class="journal">${lignes}</ul>` : '<p class="vide">Rien d\'ajouté aujourd\'hui.</p>'}
    <button class="btn btn-large btn-danger" data-act="raz">Remise à zéro</button>
    <p class="aide">Remise à zéro automatique à minuit. Chaque journée est archivée sur l'appareil avant d'être vidée.</p>`;
}

function supprimer(id) {
  const i = etat.journal.findIndex((e) => e.id === id);
  if (i < 0) return;
  const [e] = etat.journal.splice(i, 1);
  sauver();
  rafraichir();
  toast(`Supprimé : ${libelleEntree(parId[e.alimentId], e.quantite)}`, () => {
    etat.journal.splice(Math.min(i, etat.journal.length), 0, e);
    sauver();
    rafraichir();
  });
}

function demanderRaz() {
  ouvrirFeuille(`
    <h2>Remettre la journée à zéro ?</h2>
    <p>Le journal et l'activité du jour (pas, distance, séance, créatine) seront vidés. Une copie est gardée dans l'historique de l'appareil. Les pesées ne bougent pas.</p>
    <div class="rangee"><button class="btn btn-large" data-act="fermer">Garder</button>
    <button class="btn btn-large btn-danger" data-act="raz-ok">Remettre à zéro</button></div>`);
}

function razManuelle() {
  fermerFeuille();
  const avant = { etat: structuredClone(etat), historique: [...historique] };
  const r = C.remiseAZero(etat, historique, "manuel", new Date());
  etat = r.etat;
  historique = r.historique;
  sauver();
  rafraichir();
  toast("Journée remise à zéro", () => {
    etat = avant.etat;
    historique = avant.historique;
    sauver();
    verifierJour(false); // si minuit est passé entre-temps, la journée restaurée part dans l'historique
    rafraichir();
  }, 8000);
}

// ---------- Bilan ----------

function rendreBilan({ t, dep, poids }) {
  const contexteRef = { poids, depense: dep ? dep.total : null };
  const groupes = GROUPES_BILAN.map(({ groupe, titre }) => {
    const lignes = foods.nutriments.filter((n) => n.groupe === groupe).map((n) => ligneBilan(n, t[n.cle], C.referenceConcrete(refs.nutriments[n.cle], contexteRef)));
    if (groupe === "omega") {
      const ri = refs.rapport_omega6_omega3;
      lignes.push(ligneRapport("rapport_la_ala", "Rapport acide linoléique / ALA", C.rapportLinoleiqueAla(t), C.referenceConcrete(ri, contexteRef), ri.note));
      lignes.push(ligneRapport("omega", "Rapport oméga 6 / oméga 3 total", C.rapportOmega(t), null, ""));
    }
    return `<section class="carte"><h2>${titre}</h2>${lignes.join("")}</section>`;
  }).join("");
  const sources = Object.values(refs.sources)
    .map((s) => `<li>${esc(s.titre)}${s.url ? ` <span class="url">${esc(s.url)}</span>` : ""}${s.consulte ? ` (consulté le ${esc(s.consulte)})` : ""}</li>`)
    .join("");
  $("#vue-bilan").innerHTML = `
    <h2>Bilan du ${dateLongue(etat.jour)}</h2>
    ${blocEnergie(t, dep, poids)}
    <p class="legende"><span class="l-min">▮ à atteindre</span> <span class="l-max">▮ à ne pas dépasser</span> <span class="l-four">▮ fourchette</span></p>
    ${groupes}
    <section class="carte sources"><h2>Références</h2>
      <p>${esc(refs.profil)}. Références du ${esc(refs.date)}.</p>
      <p class="aide">${esc(refs.explication)}</p>
      <ul class="citation">${sources}</ul></section>`;
}

function ligneBilan(n, tot, r) {
  if (tot.absent) {
    // Absent de la table (biotine) : ni total ni barre, la référence reste affichée pour mémoire.
    const ref = r && !r.inconnue ? ` · ${LIBELLE_TYPE[r.type]} : ${C.formaterNutriment(r.bas, n)} (pour mémoire)` : "";
    return `<div class="ligne-nut t-aucun absent" data-cle="${n.cle}" data-total="" data-incomplet="0" data-absent="1">
      <div class="nut-tete"><span class="nut-nom">${esc(n.nom)}</span><span class="nut-val">—</span></div>
      <div class="nut-ref">Absente de la table Ciqual 2025${ref}</div></div>`;
  }
  const et = C.etatReference(tot.total, r);
  let refTexte = "";
  let barre = "";
  if (r?.inconnue) refTexte = `${LIBELLE_TYPE[r.type]} : — <small>(saisis ton poids)</small>`;
  else if (r) {
    const borne = r.type === "fourchette" ? `${C.formaterNutriment(r.bas, n).replace(/ \S+$/, "")} à ${C.formaterNutriment(r.haut, n)}` : C.formaterNutriment(r.bas, n);
    refTexte = `${LIBELLE_TYPE[r.type]} : ${borne} · <b>${Math.round(et.pct)} %</b>`;
    const marque = r.type === "fourchette" && r.haut > 0 ? `<i class="repere" style="left:${(r.bas / r.haut) * 100}%"></i>` : "";
    barre = `<div class="barre t-${r.type} e-${et.etat}" role="img" aria-label="${Math.round(et.pct)} %"><span style="width:${Math.min(100, et.pct)}%"></span>${marque}</div>`;
  }
  const ouvert = ui.manquantsOuverts.has(n.cle);
  return `<div class="ligne-nut t-${r?.type || "aucun"}" data-cle="${n.cle}" data-total="${tot.total}" data-incomplet="${tot.incomplet ? 1 : 0}">
    <div class="nut-tete"><span class="nut-nom">${esc(n.nom)}</span>
      <span class="nut-val">${C.formaterNutriment(tot.total, n)}</span></div>
    ${barre}
    ${refTexte ? `<div class="nut-ref">${refTexte}</div>` : ""}
    ${tot.incomplet ? `<button class="marque-incomplet" data-act="manquants" data-cle="${n.cle}" aria-expanded="${ouvert}">incomplet</button>
      <p class="manquants" ${ouvert ? "" : "hidden"}>Pas de donnée pour : ${tot.manquants.map(esc).join(", ")}</p>` : ""}
  </div>`;
}

// Ligne d'un rapport (sans unité) : valeur, référence éventuelle avec barre, note, marqueur « incomplet ».
function ligneRapport(cle, nom, r, ref, note) {
  const ouvert = ui.manquantsOuverts.has(cle);
  const val = r.valeur === null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(r.valeur);
  const et = r.valeur === null ? null : C.etatReference(r.valeur, ref);
  const nombre = (x) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(x);
  const refTexte = ref ? `${LIBELLE_TYPE[ref.type]} : ${nombre(ref.bas)}${et ? ` · <b>${Math.round(et.pct)} %</b>` : ""}` : "";
  const barre = et ? `<div class="barre t-${ref.type} e-${et.etat}" role="img" aria-label="${Math.round(et.pct)} %"><span style="width:${Math.min(100, et.pct)}%"></span></div>` : "";
  return `<div class="ligne-nut t-${ref?.type || "aucun"}" data-cle="${cle}" data-total="${r.valeur ?? ""}" data-incomplet="${r.incomplet ? 1 : 0}" data-etat="${et?.etat ?? ""}">
    <div class="nut-tete"><span class="nut-nom">${nom}</span><span class="nut-val">${val}</span></div>
    ${barre}
    ${refTexte ? `<div class="nut-ref">${refTexte}</div>` : ""}
    ${note ? `<div class="nut-ref">${esc(note)}</div>` : ""}
    ${r.incomplet ? `<button class="marque-incomplet" data-act="manquants" data-cle="${cle}" aria-expanded="${ouvert}">incomplet</button>
      <p class="manquants" ${ouvert ? "" : "hidden"}>Pas de donnée pour : ${r.manquants.map(esc).join(", ")}</p>` : ""}
  </div>`;
}

function blocEnergie(t, dep, poids) {
  const s = activite.sources;
  const detail = dep
    ? `<dl class="detail-dep">
        <dt>Journée sédentaire</dt><dd>${C.formater(dep.sedentaire, "kcal")} kcal</dd>
        <dt>Marche (${C.formater(etat.activite.km, "g")} km)</dt><dd>${C.formater(dep.marche, "kcal")} kcal</dd>
        <dt>Salle${dep.minutesSalle ? ` (${C.formater(dep.minutesSalle, "kcal")} min)` : ""}</dt><dd>${C.formater(dep.salle, "kcal")} kcal</dd>
        <dt>Dépense estimée</dt><dd><b>${C.formater(dep.total, "kcal")} kcal</b></dd></dl>`
    : `<p class="alerte">Dépense inconnue : <button class="lien" data-act="onglet" data-onglet="poids">saisis ton poids</button> pour l'estimer.</p>`;
  return `<section class="carte energie" data-cle="energie-bloc">
    <h2>Énergie</h2>
    <p class="gros">${C.formater(t.energie.total, "kcal")} kcal mangées${dep ? ` sur ${C.formater(dep.total, "kcal")} dépensées` : ""}</p>
    ${detail}
    <p class="aide">Poids utilisé : ${poids ? `${C.formater(poids, "g")} kg` : "—"}, masse grasse ${C.formater(etat.reglages.masseGrasse, "g")} %. ${esc(activite.explication)}</p>
    <p class="aide">Sources : Cunningham 1991 (repos) ; FAO/OMS/UNU 2004 (journée sédentaire, facteur ${C.formater(activite.facteur_journee_sedentaire.valeur, "mg")}) ; Compendium 2024 (marche ${C.formaterNombre(activite.marche.met)} MET, salle ${C.formaterNombre(activite.salle.met)} MET).</p>
    <details data-garde="sources-dep"><summary>Détail des sources</summary><ul class="citation">${Object.values(s).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="aide">${esc(activite.salle.note)}</p></details>
  </section>`;
}

// ---------- Activité ----------

function rendreActivite({ dep, poids }) {
  const a = etat.activite;
  const seances = activite.seances
    .map((s0) => {
      const s = C.seance(activite, s0.id);
      const kcal = poids ? (s.minutes / 60) * (activite.salle.met - activite.met_assis.valeur) * poids : null;
      const choisi = a.seance === s.id;
      return `<button class="seance${choisi ? " choisie" : ""}" data-act="seance" data-id="${s.id}" aria-pressed="${choisi}">
        <span class="seance-titre"><span aria-hidden="true">${s.icone}</span> ${esc(s.nom)}</span>
        <span class="seance-detail">${s.groupes.map((g) => `${esc(g.nom)} ${g.series}`).join(" · ")}</span>
        <span class="seance-detail">${s.series} séries · ~${C.formater(s.minutes, "kcal")} min · ${kcal === null ? "— kcal" : `+${C.formater(kcal, "kcal")} kcal`}</span>
      </button>`;
    })
    .join("");
  $("#vue-activite").innerHTML = `
    <section class="carte"><h2>Pas et distance</h2>
      <button class="btn btn-large btn-principal" data-act="importer">📋 Importer depuis le Raccourci</button>
      ${ui.presse ? `<p class="message" role="status">${esc(ui.presse)}</p>` : ""}
      <div class="reglage"><span class="reglage-nom">Distance</span><span class="reglage-val" id="a-km" data-valeur="${a.km}">${C.formater(a.km, "g")} km</span></div>
      <div class="rangee4"><button class="btn" data-act="km" data-d="-1">−1</button><button class="btn" data-act="km" data-d="-0.1">−0,1</button><button class="btn" data-act="km" data-d="0.1">+0,1</button><button class="btn" data-act="km" data-d="1">+1</button></div>
      <div class="reglage"><span class="reglage-nom">Pas</span><span class="reglage-val" id="a-pas" data-valeur="${a.pas}">${new Intl.NumberFormat("fr-FR").format(a.pas)}</span></div>
      <div class="rangee4"><button class="btn" data-act="pas" data-d="-1000">−1000</button><button class="btn" data-act="pas" data-d="-100">−100</button><button class="btn" data-act="pas" data-d="100">+100</button><button class="btn" data-act="pas" data-d="1000">+1000</button></div>
      <p class="aide">Seule la distance entre dans la dépense ; les pas sont affichés pour mémoire.</p>
      <details class="aide-raccourci" data-garde="raccourci"><summary>Créer le Raccourci iPhone</summary>
        <p>Une appli web ne peut pas lire l'app Santé. Un Raccourci copie tes pas et ta distance du jour, puis le bouton ci-dessus les lit dans le presse-papiers.</p>
        <ol>
          <li>Ouvre l'app Raccourcis, touche « + » pour un nouveau raccourci, nomme-le « Pas du jour ».</li>
          <li>Ajoute l'action « Rechercher des échantillons de santé » : type « Nombre de pas », date « Aujourd'hui », regrouper par « Jour », valeur « Somme ».</li>
          <li>Ajoute une 2ᵉ action « Rechercher des échantillons de santé » : type « Distance à pied et en course », date « Aujourd'hui », regrouper par « Jour », valeur « Somme », unité « km ».</li>
          <li>Ajoute l'action « Texte » et écris : [résultat des pas] pas [résultat de la distance] km (insère chaque résultat avec la barre au-dessus du clavier).</li>
          <li>Ajoute l'action « Copier dans le presse-papiers ».</li>
          <li>Le soir : lance le Raccourci (ou ajoute-le à l'écran d'accueil), ouvre cette appli, touche « Importer depuis le Raccourci ».</li>
        </ol></details>
    </section>
    <section class="carte"><h2>Salle</h2>
      <p class="aide">Un module par jour ; retouche-le pour l'annuler.</p>
      <div class="seances">${seances}</div>
    </section>
    <section class="carte"><h2>Créatine</h2>
      <button class="btn btn-large case${a.creatine ? " cochee" : ""}" data-act="creatine" aria-pressed="${a.creatine}">${a.creatine ? "✅ Créatine prise" : "⬜ Créatine prise"}</button>
    </section>
    <section class="carte"><h2>Dépense du jour</h2>
      ${dep ? `<dl class="detail-dep" id="a-depense" data-total="${dep.total}">
        <dt>Repos (Cunningham)</dt><dd>${C.formater(dep.repos, "kcal")} kcal</dd>
        <dt>Journée sédentaire (× ${C.formater(activite.facteur_journee_sedentaire.valeur, "mg")})</dt><dd>${C.formater(dep.sedentaire, "kcal")} kcal</dd>
        <dt>Marche</dt><dd>${C.formater(dep.marche, "kcal")} kcal</dd>
        <dt>Salle</dt><dd>${C.formater(dep.salle, "kcal")} kcal</dd>
        <dt>Total</dt><dd><b>${C.formater(dep.total, "kcal")} kcal</b></dd></dl>`
        : `<p class="alerte" id="a-depense" data-total="">Dépense inconnue : <button class="lien" data-act="onglet" data-onglet="poids">saisis ton poids</button>.</p>`}
    </section>`;
}

async function importer() {
  let texte;
  try {
    texte = await navigator.clipboard.readText();
  } catch {
    ui.presse = "Lecture du presse-papiers refusée : règle la distance et les pas avec les boutons.";
    return rafraichir();
  }
  const r = C.analyserPressePapiers(texte);
  if (!r) ui.presse = "Texte non reconnu dans le presse-papiers (attendu : « 8 432 pas 6,21 km »). Rien n'a changé.";
  else {
    if (r.pas !== undefined) etat.activite.pas = r.pas;
    if (r.km !== undefined) etat.activite.km = r.km;
    ui.presse = `Importé : ${r.pas !== undefined ? `${new Intl.NumberFormat("fr-FR").format(r.pas)} pas` : ""}${r.pas !== undefined && r.km !== undefined ? ", " : ""}${r.km !== undefined ? `${C.formater(r.km, "g")} km` : ""}.`;
    sauver();
  }
  rafraichir();
}

// ---------- Poids ----------

function rendrePoids() {
  const tab = C.tableauPesees(etat.pesees);
  const signe = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±") + C.formater(Math.abs(x), "g");
  const lignes = [...tab]
    .reverse()
    .map((p) => `<tr data-date="${p.date}"><td>${dateCourte(p.date)}</td><td><b>${C.formater(p.kg, "g")}</b></td><td>${p.variation === null ? "—" : signe(p.variation)}</td><td>${C.formater(p.moyenne7, "g")}</td>
      <td><button class="j-suppr" data-act="suppr-pesee" data-date="${p.date}" aria-label="Supprimer la pesée du ${dateCourte(p.date)}">✕</button></td></tr>`)
    .join("");
  $("#vue-poids").innerHTML = `
    <section class="carte"><h2>Pesée du jour</h2>
      <div class="poids-val" id="p-brouillon" data-valeur="${ui.poids}">${C.formater(ui.poids, "g")} kg</div>
      <div class="rangee4"><button class="btn" data-act="poids" data-d="-1">−1</button><button class="btn" data-act="poids" data-d="-0.1">−0,1</button><button class="btn" data-act="poids" data-d="0.1">+0,1</button><button class="btn" data-act="poids" data-d="1">+1</button></div>
      <button class="btn btn-large btn-principal" data-act="enregistrer-poids">Enregistrer pour aujourd'hui</button>
    </section>
    <section class="carte"><h2>Courbe</h2>${courbe(tab)}
      <p class="aide">La créatine peut faire prendre un peu de poids en eau, surtout au début : regarde plutôt la moyenne sur 7 jours.</p></section>
    <section class="carte"><h2>Toutes les pesées</h2>
      ${tab.length ? `<div class="table-defil"><table class="pesees"><thead><tr><th>Date</th><th>kg</th><th>Écart</th><th>Moy. 7 j</th><th><span class="visuellement-cache">Supprimer</span></th></tr></thead><tbody>${lignes}</tbody></table></div>` : '<p class="vide">Aucune pesée pour l\'instant.</p>'}
    </section>
    <section class="carte"><h2>Masse grasse</h2>
      <div class="reglage"><span class="reglage-nom">Pour le calcul de la dépense</span><span class="reglage-val" id="p-mg" data-valeur="${etat.reglages.masseGrasse}">${C.formater(etat.reglages.masseGrasse, "g")} %</span></div>
      <div class="rangee2"><button class="btn" data-act="mg" data-d="-0.5">−0,5 %</button><button class="btn" data-act="mg" data-d="0.5">+0,5 %</button></div>
    </section>`;
}

// Courbe SVG faite main : pesées (points et ligne) et moyenne sur 7 jours (trait épais).
function courbe(tab) {
  if (tab.length < 2) return '<p class="vide">La courbe apparaît à partir de deux pesées.</p>';
  const L = 340, H = 180, m = { g: 40, d: 10, h: 12, b: 26 };
  const jours = (d) => Date.UTC(...d.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0))) / 864e5;
  const x0 = jours(tab[0].date), x1 = jours(tab[tab.length - 1].date);
  const vals = tab.flatMap((p) => [p.kg, p.moyenne7]);
  let y0 = Math.min(...vals), y1 = Math.max(...vals);
  if (y1 - y0 < 1) { y0 -= 0.5; y1 += 0.5; }
  const X = (d) => m.g + ((jours(d) - x0) / Math.max(1, x1 - x0)) * (L - m.g - m.d);
  const Y = (v) => m.h + (1 - (v - y0) / (y1 - y0)) * (H - m.h - m.b);
  const chemin = (k) => tab.map((p, i) => `${i ? "L" : "M"}${X(p.date).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(" ");
  const graduations = [y0, (y0 + y1) / 2, y1].map((v) => `<line x1="${m.g}" x2="${L - m.d}" y1="${Y(v)}" y2="${Y(v)}" class="grille"/><text x="${m.g - 4}" y="${Y(v) + 4}" text-anchor="end">${C.formater(v, "g")}</text>`).join("");
  return `<svg class="courbe" viewBox="0 0 ${L} ${H}" role="img" aria-label="Courbe du poids et de sa moyenne sur 7 jours">
    ${graduations}
    <text x="${m.g}" y="${H - 6}">${dateCourte(tab[0].date)}</text><text x="${L - m.d}" y="${H - 6}" text-anchor="end">${dateCourte(tab[tab.length - 1].date)}</text>
    <path d="${chemin("kg")}" class="c-poids"/><path d="${chemin("moyenne7")}" class="c-moy"/>
    ${tab.map((p) => `<circle cx="${X(p.date).toFixed(1)}" cy="${Y(p.kg).toFixed(1)}" r="3" class="c-point"/>`).join("")}
  </svg>
  <p class="legende"><span class="l-poids">● poids</span> <span class="l-moy">━ moyenne 7 jours</span></p>`;
}

// ---------- Feuille du bas, toast ----------

function ouvrirFeuille(html) {
  const f = $("#feuille");
  f.innerHTML = `<div class="feuille-poignee" aria-hidden="true"></div>${html}`;
  f.hidden = false;
  $("#voile").hidden = false;
  document.body.classList.add("feuille-ouverte");
  f.scrollTop = 0;
}
function fermerFeuille() {
  $("#feuille").hidden = true;
  $("#voile").hidden = true;
  document.body.classList.remove("feuille-ouverte");
}

let toastAnnuler = null;
let toastMinuteur = null;
function toast(message, annuler, duree = 5000) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(message)}</span>${annuler ? '<button class="btn" data-act="annuler">Annuler</button>' : ""}`;
  toastAnnuler = annuler || null;
  t.classList.add("visible");
  clearTimeout(toastMinuteur);
  toastMinuteur = setTimeout(cacherToast, duree);
}
function cacherToast() {
  $("#toast").classList.remove("visible");
  toastAnnuler = null;
}

// ---------- Dates lisibles ----------

const enDate = (j) => new Date(...j.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
const dateLongue = (j) => enDate(j).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const dateCourte = (j) => enDate(j).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });

// ---------- Gestes ----------

const ACTIONS = {
  onglet: (b) => allerOnglet(b.dataset.onglet),
  categorie: (b) => {
    const ouvert = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!ouvert));
    b.nextElementSibling.hidden = ouvert;
  },
  aliment: (b) => basculerAliment(b.dataset.id),
  ajouter: (b) => ajouter(b.dataset.id, Number(b.dataset.q), b),
  fiche: (b) => ouvrirFiche(b.dataset.id),
  fermer: () => fermerFeuille(),
  supprimer: (b) => supprimer(b.dataset.id),
  raz: () => demanderRaz(),
  "raz-ok": () => razManuelle(),
  annuler: () => {
    const f = toastAnnuler;
    cacherToast();
    f?.();
  },
  manquants: (b) => {
    const c = b.dataset.cle;
    ui.manquantsOuverts.has(c) ? ui.manquantsOuverts.delete(c) : ui.manquantsOuverts.add(c);
    b.setAttribute("aria-expanded", String(ui.manquantsOuverts.has(c)));
    b.nextElementSibling.hidden = !ui.manquantsOuverts.has(c);
  },
  importer: () => importer(),
  km: (b) => {
    etat.activite.km = Math.max(0, C.arrondi1(etat.activite.km + Number(b.dataset.d)));
    sauver();
    rafraichir();
  },
  pas: (b) => {
    etat.activite.pas = Math.max(0, etat.activite.pas + Number(b.dataset.d));
    sauver();
    rafraichir();
  },
  seance: (b) => {
    etat.activite.seance = etat.activite.seance === b.dataset.id ? null : b.dataset.id;
    sauver();
    rafraichir();
  },
  creatine: () => {
    etat.activite.creatine = !etat.activite.creatine;
    sauver();
    rafraichir();
  },
  poids: (b) => {
    ui.poids = Math.min(400, Math.max(20, C.arrondi1(ui.poids + Number(b.dataset.d))));
    rendrePoids();
  },
  "enregistrer-poids": () => {
    verifierJour();
    etat.pesees = etat.pesees.filter((p) => p.date !== etat.jour).concat({ date: etat.jour, kg: ui.poids });
    sauver();
    rafraichir();
    toast(`Pesée enregistrée : ${C.formater(ui.poids, "g")} kg`);
  },
  "suppr-pesee": (b) => {
    const i = etat.pesees.findIndex((p) => p.date === b.dataset.date);
    if (i < 0) return;
    const [p] = etat.pesees.splice(i, 1);
    sauver();
    rafraichir();
    toast(`Pesée du ${dateCourte(p.date)} supprimée`, () => {
      etat.pesees.push(p);
      sauver();
      rafraichir();
    });
  },
  mg: (b) => {
    etat.reglages.masseGrasse = Math.min(60, Math.max(3, Math.round((etat.reglages.masseGrasse + Number(b.dataset.d)) * 2) / 2));
    sauver();
    rafraichir();
  },
};

function surClic(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b || !ACTIONS[b.dataset.act]) return;
  // Chaque geste commence par vérifier la date : un ajout après minuit va dans la bonne journée.
  if (!["annuler", "fermer", "onglet", "categorie", "aliment", "fiche", "manquants"].includes(b.dataset.act)) verifierJour();
  ACTIONS[b.dataset.act](b);
}

demarrer().catch((e) => {
  document.querySelector("#app").innerHTML = `<p class="alerte">Impossible de charger les données : ${esc(e.message)}</p>`;
  console.error(e);
});
