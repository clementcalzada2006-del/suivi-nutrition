# Fichiers sources (gardés sur le PC, non publiés)

Ces fichiers servent de référence et à la vérification (`python3 -I outils/ciqual.py verifier`). Ils ne sont pas dans le dépôt (taille et droits) : seul ce fichier l'est. Téléchargés le **2026-11-04**. Ce sont des données : ils ne sont jamais exécutés et le site ne les sert pas.

## `ciqual-2025/` : table Ciqual 2025 (ANSES)

Origine : dépôt Zenodo de l'équipe Ciqual, « Ciqual French food composition table 2025 », DOI [10.5281/zenodo.17550133](https://doi.org/10.5281/zenodo.17550133), licence CC-BY 4.0 (ciqual.anses.fr était en maintenance le jour du téléchargement). Sommes MD5 publiées par Zenodo, vérifiées, recopiées dans `ciqual-2025/zenodo_checksums.txt` :

| Fichier | Taille (octets) | MD5 |
|---|---|---|
| alim_2025_11_03.xml | 1 581 031 | 8e1171d63cee4b6010cfce25dd29243d |
| alim_grp_2025_11_03.xml | 80 421 | c31aeea90349c3aab86f98ef5f4f10da |
| compo_2025_11_03.xml | 69 243 149 | 2da725585946434df320d8041631998b |
| const_2025_11_03.xml | 17 955 | d8f2f25fdacb887bc993a6eeaf80f203 |
| sources_2025_11_03.xml | 871 783 | 5469598d6b4811672b65e1644dfc6485 |
| Table Ciqual 2025_ENG_2025_11_03.xlsx | 1 537 602 | a953e8c473d8cee24a32f89a48fbd54d |
| Table Ciqual 2025 doc ENG_2025_11_19.pdf | 4 197 666 | ecb54ba5be359d215ec7001c0e5a2604 |

## `usda-sr-legacy/` : USDA SR28 / FoodData Central SR Legacy (poids des pièces, parts non comestibles)

Origine : USDA Agricultural Research Service, FoodData Central, « SR Legacy » (https://fdc.nal.usda.gov/download-datasets/) et documentation SR28. MD5 calculés localement (pas de somme officielle publiée) :

| Fichier | MD5 |
|---|---|
| sr28_doc.pdf | 3e58d1d243228d0884293ec302957ea8 |
| sr28asc.zip | d9c5e61d76a77ae6fa7e4108227982db |
| sr_legacy_csv.zip | b35951cc9dae0e0d9d1dce93c4532442 |

## `anses/` : références nutritionnelles (copies des pages et de l'avis cités dans `donnees/references.json`)

URL d'origine : voir `sources` dans `donnees/references.json`. MD5 calculés localement :

| Fichier | MD5 |
|---|---|
| ANSES_2016_NUT2012SA0103Ra.pdf | 534df6dfae2fcdeb1d0b186b3bf20b25 |
| les-lipides.html | 03764ad7d1853f801e524dbabbf87659 |
| les-proteines.html | 9588b240abe53339082123a064f516f8 |
| references-vitamines-mineraux.html | cc7e6eecd7d2396f81b9e2d408e37b3d |
| tables.txt (extraction des tableaux de la page précédente, faite le 2026-11-04 pour lecture) | c5fb3112c2b793e2163f2b4a0aff07ff |

## `etiquettes/` (à venir)

Photos des étiquettes des produits de marque (pains, légumes surgelés Super U), nommées `<id de l'aliment>-<AAAA-MM-JJ>.jpg`.
