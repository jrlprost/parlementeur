# Parlementeur

Ce que font vos élus, en chiffres et avec leurs sources : votes, présence, loyauté envers le groupe, qui vote avec qui, intérêts déclarés, lobbying, parcours.

Site : [parlementeur.fr](https://parlementeur.fr)

## Principes

- Uniquement des données publiques officielles, et chaque chiffre renvoie à sa source.
- Aucun cookie, aucun traceur, aucune ressource tierce.
- Les déclarations de patrimoine des parlementaires ne sont jamais lues ni publiées (article 26 de la loi n° 2013-907 du 11 octobre 2013 ; consultation en préfecture selon l'article LO 135-2 du code électoral).
- Seules les condamnations définitives, documentées par une source primaire, sont publiées.

## Structure

- `database/` : pipeline Python et DuckDB. Il télécharge les sources (Assemblée nationale, HATVP, Wikidata), les recoupe, calcule les indicateurs et écrit les fichiers publiés dans `database/dist/`.
- `website/` : site statique Astro. L'hémicycle est dessiné en SVG ; les images de partage sont générées au build.

## Lancer en local

```bash
cd database && uv run parlementeur
cd ../website && pnpm install && pnpm dev
```

## Sources

| Source | Données | Licence |
|---|---|---|
| [Assemblée nationale, open data](https://data.assemblee-nationale.fr/) | députés, mandats, groupes, scrutins | Licence Ouverte 2.0 |
| [HATVP, open data](https://www.hatvp.fr/open-data/) | déclarations d'intérêts et d'activités | Licence Ouverte 2.0 |
| [Wikidata](https://www.wikidata.org/) | mandats antérieurs à 2012 | CC0 |
| [Ministère de l'Intérieur, législatives 2024](https://www.data.gouv.fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour) | résultats, découpage par bureau de vote | Licence Ouverte 2.0 |
| [La Poste, base officielle des codes postaux](https://www.data.gouv.fr/datasets/base-officielle-des-codes-postaux) | code postal → commune | Licence Ouverte 2.0 |

## Licences

Code : MIT. Données produites : Licence Ouverte 2.0, avec mention de Parlementeur et des sources d'origine.

Réalisé par Jean-Rémi Larcelet-Prost.
