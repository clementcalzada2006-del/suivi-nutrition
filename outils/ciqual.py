"""Outil Ciqual 2025 : remplit et vérifie les valeurs nutritionnelles de donnees/foods.json.

Toutes les valeurs viennent des fichiers XML officiels (sources/ciqual-2025/), jamais d'une saisie.
Bibliothèque standard seulement. Lancer avec : python3 -I outils/ciqual.py <commande>

Commandes :
  remplir          lit les teneurs dans compo_*.xml et remplit aliments[].valeurs
  verifier         contrôle exhaustif (code de sortie 1 au moindre écart) + rapport
  manquants        nutriments sans valeur (null) ou en traces, par aliment
  chercher MOTIF   recherche dans les noms Ciqual (sans accents ni casse)
"""

import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

RACINE = Path(__file__).resolve().parent.parent
DOSSIER = RACINE / "sources" / "ciqual-2025"
FICHIER_ALIM = DOSSIER / "alim_2025_11_03.xml"
FICHIER_COMPO = DOSSIER / "compo_2025_11_03.xml"
FICHIER_CONST = DOSSIER / "const_2025_11_03.xml"
FOODS = RACINE / "donnees" / "foods.json"
REFERENCES = RACINE / "donnees" / "references.json"
RAPPORT = RACINE / "outils" / "rapport-verification.txt"
DATE_TABLE = "2025-11-03"

# Teneur notée pour un nutriment suivi absent des 74 constituants de la table (« ciqual »: [], ex. biotine) :
# { "v": null, "brut": ABSENT_TABLE, "const": null, ... } ; ni total ni marqueur « incomplet » dans l'appli.
ABSENT_TABLE = "absent de la table"

# Constituants lus directement dans le XML pour les contrôles de cohérence (certains ne sont plus suivis par l'appli).
CONST_COHERENCE = {
    "energie": 328, "proteines": 25003, "glucides": 31000, "lipides": 40000, "fibres": 34100,
    "ags": 40302, "agmi": 40303, "agpi": 40304,
    "ala": 41833, "epa": 42053, "dha": 42263, "linoleique": 41826, "arachidonique": 42046,
}

# Unité de l'appli -> suffixe attendu dans const_nom_fr.
SUFFIXES = {"g": "(g/100 g)", "mg": "(mg/100 g)", "µg": "(µg/100 g)", "kcal": "(kcal/100 g)"}


# ---------- Lecture des XML ----------

def texte(el, balise):
    """Texte d'une balise enfant, sans les espaces de bord (le XML en met partout)."""
    t = el.findtext(balise)
    return t.strip() if t is not None else ""


def lire_aliments():
    """{code: nom_fr} pour tous les aliments de la table."""
    return {int(texte(a, "alim_code")): texte(a, "alim_nom_fr") for a in ET.parse(FICHIER_ALIM).getroot().iter("ALIM")}


def lire_constituants():
    """{code: nom_fr} pour les 74 constituants."""
    return {int(texte(c, "const_code")): texte(c, "const_nom_fr") for c in ET.parse(FICHIER_CONST).getroot().iter("CONST")}


def lire_compo(codes_alim):
    """{(code_aliment, code_constituant): teneur brute} pour les aliments demandés (lecture en flux, 69 Mo)."""
    compo = {}
    for _, el in ET.iterparse(FICHIER_COMPO, events=("end",)):
        if el.tag != "COMPO":
            continue
        a = int(texte(el, "alim_code"))
        if codes_alim is None or a in codes_alim:
            cle = (a, int(texte(el, "const_code")))
            if cle in compo:
                raise ValueError(f"ligne COMPO en double : aliment {cle[0]}, constituant {cle[1]}")
            compo[cle] = texte(el, "teneur")
        el.clear()
    return compo


def interpreter(brut):
    """Teneur brute du XML -> (valeur, trace). « traces » et « < x » -> 0 signalé ; « - » ou absent -> None."""
    if brut is None or brut == "" or brut == "-":
        return None, False
    if brut.lower() == "traces" or brut.startswith("<"):
        return 0, True
    try:
        v = float(brut.replace(",", "."))
    except ValueError:
        raise ValueError(f"teneur illisible : {brut!r}")
    return (int(v) if v.is_integer() else v), False


def constituant_utilise(nutriment, code_alim, compo):
    """Constituant à lire : le premier de la liste qui a une valeur, sinon le dernier (cas de vitB9 : 56702 puis 56700).
    None si le nutriment n'existe pas dans la table (liste vide)."""
    if not nutriment["ciqual"]:
        return None
    for c in nutriment["ciqual"]:
        if interpreter(compo.get((code_alim, c)))[0] is not None:
            return c
    return nutriment["ciqual"][-1]


# ---------- Fichiers JSON ----------

def charger(chemin):
    return json.loads(chemin.read_text(encoding="utf-8"))


def ecrire_foods(donnees):
    FOODS.write_text(json.dumps(donnees, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sans_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


# ---------- Commandes ----------

def remplir():
    foods = charger(FOODS)
    codes = {a["ciqual"]["code"] for a in foods["aliments"]}
    compo = lire_compo(codes)
    n = 0
    for al in foods["aliments"]:
        code = al["ciqual"]["code"]
        cles = {n["cle"] for n in foods["nutriments"]}
        # Les nutriments qui ne sont plus suivis disparaissent de valeurs.
        valeurs = al["valeurs"] = {k: x for k, x in al.get("valeurs", {}).items() if k in cles}
        for nut in foods["nutriments"]:
            cle = nut["cle"]
            if valeurs.get(cle, {}).get("source") == "etiquette":
                continue  # saisie depuis une étiquette : jamais écrasée
            const = constituant_utilise(nut, code, compo)
            brut = compo.get((code, const)) if const is not None else None
            v, trace = interpreter(brut)
            valeurs[cle] = {
                "v": v,
                "brut": ABSENT_TABLE if const is None else brut if brut is not None else "absent",
                "unite": nut["unite"],
                "source": al["source_valeurs"],
                "code": code,
                "const": const,
                "date": DATE_TABLE,
                "trace": trace,
            }
            n += 1
    ecrire_foods(foods)
    print(f"{n} valeurs écrites pour {len(foods['aliments'])} aliments.")


def controles_coherence(valeurs):
    """Contrôles de cohérence d'un aliment : liste de (nom, ok, détail). ok = None si ignoré (valeur manquante)."""
    def v(c):
        return valeurs.get(c, {}).get("v")

    res = []
    p, g, l, f, e = v("proteines"), v("glucides"), v("lipides"), v("fibres"), v("energie")
    if None in (p, g, l, f, e):
        res.append(("énergie", None, "ignoré : valeur manquante"))
    else:
        calc = 4 * p + 4 * g + 9 * l + 2 * f
        ecart = abs(e - calc) / e if e else 0
        res.append(("énergie", ecart <= 0.10, f"{e} kcal déclarées, {calc:.1f} calculées (écart {ecart * 100:.1f} %)"))
    ags, agmi, agpi = v("ags"), v("agmi"), v("agpi")
    if None in (ags, agmi, agpi, l):
        res.append(("acides gras", None, "ignoré : valeur manquante"))
    else:
        s = ags + agmi + agpi
        res.append(("acides gras", s <= l + 1e-9, f"saturés + mono + poly = {s:.3f} g, lipides = {l} g"))
    om = [v(c) for c in ("ala", "epa", "dha", "linoleique", "arachidonique")]
    if None in om or agpi is None:
        res.append(("oméga", None, "ignoré : valeur manquante"))
    else:
        s = sum(om)
        res.append(("oméga", s <= agpi + 1e-9, f"oméga 3 + oméga 6 = {s:.4f} g, polyinsaturés = {agpi} g"))
    return res


def verifier():
    foods = charger(FOODS)
    refs = charger(REFERENCES)
    alims = lire_aliments()
    consts = lire_constituants()
    codes = {a["ciqual"]["code"] for a in foods["aliments"]}
    compo = lire_compo(codes)
    ecarts, avert, lignes = [], [], []
    n_verif = 0
    nuts = {n["cle"]: n for n in foods["nutriments"]}

    # Unités et existence des constituants déclarés.
    for nut in foods["nutriments"]:
        for c in nut["ciqual"]:
            if c not in consts:
                ecarts.append(f"nutriment {nut['cle']} : constituant {c} absent de la table")
            elif not consts[c].endswith(SUFFIXES[nut["unite"]]):
                ecarts.append(f"nutriment {nut['cle']} : unité {nut['unite']} incompatible avec « {consts[c]} »")

    # Références <-> nutriments.
    cles_ref = set(refs["nutriments"])
    for c in sorted(cles_ref - set(nuts)):
        ecarts.append(f"references.json : clé {c} sans nutriment dans foods.json")
    for c in sorted(set(nuts) - cles_ref):
        ecarts.append(f"foods.json : nutriment {c} sans clé dans references.json")

    for al in foods["aliments"]:
        code = al["ciqual"]["code"]
        nom = f"{al['id']} ({code})"
        if code not in alims:
            ecarts.append(f"{nom} : code Ciqual introuvable")
            continue
        if al["ciqual"]["nom"] != alims[code]:
            ecarts.append(f"{nom} : nom « {al['ciqual']['nom']} » ≠ nom officiel « {alims[code]} »")
        for cle in sorted(set(al.get("valeurs", {})) - set(nuts)):
            ecarts.append(f"{nom} : valeurs contient {cle}, qui n'est pas un nutriment suivi")
        for cle, nut in nuts.items():
            val = al.get("valeurs", {}).get(cle)
            if val is None:
                ecarts.append(f"{nom} : nutriment {cle} absent de valeurs")
                continue
            if val.get("unite") != nut["unite"]:
                ecarts.append(f"{nom} {cle} : unité {val.get('unite')} ≠ {nut['unite']}")
            if val.get("source") == "etiquette":
                continue  # contrôlé par la relecture des étiquettes, pas par la table
            if val.get("source") not in ("ciqual", "estime"):
                ecarts.append(f"{nom} {cle} : source inconnue {val.get('source')!r}")
                continue
            n_verif += 1
            if not nut["ciqual"]:  # absent de la table : seule la forme attendue est acceptée
                if val.get("v") is not None or val.get("const") is not None or val.get("brut") != ABSENT_TABLE or val.get("trace"):
                    ecarts.append(f"{nom} {cle} : nutriment absent de la table, attendu v = null, const = null, brut « {ABSENT_TABLE} »")
                continue
            attendu_const = constituant_utilise(nut, code, compo)
            if val.get("const") != attendu_const or val["const"] not in nut["ciqual"]:
                ecarts.append(f"{nom} {cle} : constituant {val.get('const')} au lieu de {attendu_const}")
                continue
            if val.get("code") != code:
                ecarts.append(f"{nom} {cle} : code aliment {val.get('code')} au lieu de {code}")
            if not consts[val["const"]].endswith(SUFFIXES[val["unite"]]):
                ecarts.append(f"{nom} {cle} : unité {val['unite']} ≠ « {consts[val['const']]} »")
            brut = compo.get((code, val["const"]))
            v, trace = interpreter(brut)
            if val.get("v") != v or type(val.get("v")) is bool:
                ecarts.append(f"{nom} {cle} : v = {val.get('v')!r}, XML = {brut!r}")
            if v is None and val.get("v") == 0:
                ecarts.append(f"{nom} {cle} : 0 là où le XML dit « - » ou rien")
            if val.get("trace") != trace:
                ecarts.append(f"{nom} {cle} : trace = {val.get('trace')!r}, XML = {brut!r}")
            if val.get("brut") != (brut if brut is not None else "absent"):
                ecarts.append(f"{nom} {cle} : brut {val.get('brut')!r} ≠ XML {brut!r}")
        # Cohérence de l'entrée Ciqual elle-même, lue dans le XML (fibres et acides gras ne sont plus suivis).
        xml = {k: {"v": interpreter(compo.get((code, c)))[0]} for k, c in CONST_COHERENCE.items()}
        for nom_c, ok, detail in controles_coherence(xml):
            if ok is None:
                avert.append(f"{al['id']} : contrôle {nom_c} {detail}")
            elif not ok:
                avert.append(f"{al['id']} : contrôle {nom_c} en écart : {detail}")

    lignes.append(f"Vérification Ciqual 2025 ({DATE_TABLE}) de donnees/foods.json")
    lignes.append(f"Aliments : {len(foods['aliments'])} ; nutriments suivis : {len(nuts)}")
    lignes.append(f"Valeurs vérifiées contre le XML : {n_verif}")
    lignes.append(f"Écarts : {len(ecarts)}")
    lignes += ["  " + e for e in ecarts]
    lignes.append(f"Avertissements de cohérence : {len(avert)}")
    lignes += ["  " + a for a in avert]
    sortie = "\n".join(lignes)
    RAPPORT.write_text(sortie + "\n", encoding="utf-8")
    print(sortie)
    print(f"Rapport écrit dans {RAPPORT.relative_to(RACINE)}")
    sys.exit(1 if ecarts else 0)


def manquants():
    foods = charger(FOODS)
    absents = [n["cle"] for n in foods["nutriments"] if not n["ciqual"]]
    print(f"Absents de la table pour tous les aliments : {', '.join(absents) or 'aucun'}")
    for al in foods["aliments"]:
        nuls = [n["cle"] for n in foods["nutriments"] if n["ciqual"] and al["valeurs"].get(n["cle"], {}).get("v") is None]
        traces = [n["cle"] for n in foods["nutriments"] if al["valeurs"].get(n["cle"], {}).get("trace")]
        print(f"{al['nom']} (Ciqual {al['ciqual']['code']})")
        print(f"  sans valeur ({len(nuls)}) : {', '.join(nuls) or 'aucun'}")
        print(f"  traces ({len(traces)}) : {', '.join(traces) or 'aucun'}")


def chercher(motif):
    alims = lire_aliments()
    m = sans_accents(motif)
    trouves = {c: n for c, n in alims.items() if m in sans_accents(n)}
    compo = lire_compo(set(trouves))
    print(f"{len(trouves)} aliment(s) pour « {motif} » (kcal, protéines, glucides, lipides pour 100 g)")
    for c, n in sorted(trouves.items(), key=lambda x: x[1]):
        cols = [compo.get((c, k), "absent") for k in (328, 25003, 31000, 40000)]
        print(f"{c:>6}  {n}  |  {cols[0]} kcal  P {cols[1]}  G {cols[2]}  L {cols[3]}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "remplir":
        remplir()
    elif cmd == "verifier":
        verifier()
    elif cmd == "manquants":
        manquants()
    elif cmd == "chercher" and len(sys.argv) > 2:
        chercher(" ".join(sys.argv[2:]))
    else:
        print(__doc__)
        sys.exit(2)
