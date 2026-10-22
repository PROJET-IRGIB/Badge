> Ne pas appliquer ce prompt tel quel. Il parle de L1, L2 et L3. Le portail publié utilise LP1, LP2, LP3, M1 et M2. L’écran Groupes compte déjà les cartes approuvées par site, filière et niveau.

# Prompt — Badges séparés par niveau et par filière

Tu travailles sur SmartBadge, l'application de cartes d'étudiant de l'Université IRGIB-AFRICA (Next.js, TypeScript, Tailwind, NestJS, PostgreSQL, Prisma).

Ajoute un écran d'administration qui sépare les badges en trois niveaux, puis, dans chaque niveau, par filière.

## Niveaux

Il y a exactement trois sections, toujours visibles, dans cet ordre :

1. L1
2. L2
3. L3

Chaque étudiant validé a un seul niveau, enregistré sur son badge. Un badge de L1 n'apparaît pas dans L2 ni dans L3.

## Filières dans chaque niveau

Dans L1, dans L2 et dans L3, affiche une sous-section par filière.

Exemples de filières : TIC, PFMI, BBA. La liste n'est pas fermée : toute filière présente dans les données doit apparaître.

Pour chaque filière, affiche le nombre de badges de ce niveau. Exemple pour L1 :

- TIC : 40 élèves
- PFMI : 25 élèves
- BBA : 18 élèves

Le même découpage existe dans L2 et dans L3, avec ses propres nombres. Un élève de TIC en L2 compte dans L2 → TIC, pas dans L1 → TIC.

Le nombre est le total des badges de ce niveau et de cette filière. Affiche aussi 0 quand la filière existe et qu'aucun badge n'y est rattaché pour ce niveau.

## Interaction

- Les trois niveaux sont des blocs séparés.
- Chaque filière du niveau est un bloc cliquable.
- Au clic, ouvrir la liste des badges de ce niveau et de cette filière : photo, nom, prénom, matricule, filière, niveau, statut du badge.
- Un total du niveau est affiché sur l'en-tête de L1, de L2 et de L3. Il est égal à la somme des filières de ce niveau.

## Données

Utilise le niveau et la filière déjà portés par le badge validé. Ne demande pas à l'administrateur de retaper ces valeurs.

Ne compte pas une demande encore en révision. Seuls les badges validés entrent dans les nombres.

Trie les filières par nom. Trie les élèves de la liste par nom.

## Résultat attendu

L'administration voit, sans export ni filtre manuel :

- combien de badges existent en L1, en L2 et en L3 ;
- dans chaque niveau, combien de badges existent pour TIC, pour PFMI, pour BBA et pour chaque autre filière ;
- la liste des élèves derrière chaque nombre.
