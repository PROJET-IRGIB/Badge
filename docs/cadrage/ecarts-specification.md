> Écarts entre deux textes de cadrage. L’écart avec le portail déjà en ligne est dans [l’état actuel](../portail-actuel.md).

# SmartBadge — écarts avec la spécification reçue

La spécification reprend le brief d'origine. Elle ne contient pas plusieurs décisions déjà closes dans cette conversation. Elle n'est pas prête à être donnée telle quelle à une IA de codage.

Ce qui manque est marqué **en gras**.

## Ce qui correspond déjà

L'objectif est le même : identifier, contrôler l'accès, pointer, bloquer qui n'est pas à jour, produire la fiche, bibliothèque, emprunts, et laisser l'étudiant imprimer sa carte.

Correspondent aussi le mode A (le responsable scanne) et le mode B (l'étudiant scanne le QR de la salle et choisit le cours), sur la même session. Seul le responsable clôture. Le PDF part au professeur, qui ne configure rien. Le QR du téléphone dure 30 à 60 secondes. Celui du papier ne tourne pas seul et peut être révoqué. Chaque scan vérifie l'identité et la scolarité. La bibliothèque et le prêt, avec date de retour et scan de restitution, suivent la même règle. La pile est la même : Next.js, NestJS, PostgreSQL, Prisma, PWA, Firebase, VPS ou Railway.

Le passage « en attente » puis « confirmé » à la clôture, et la liste des absents, vont dans le même sens. **Il manque la table des inscrits au cours**, sans laquelle la liste des absents ne se calcule pas. Le schéma Prisma ne l'a pas.

## Ce qui manque

**1. Le format horizontal de la carte.** En-tête avec l'université et l'année, bande « CARTE D'ÉTUDIANT », photo à gauche, nom en grand, prénom d'usage dessous, deux colonnes (naissance, sexe, nationalité, niveau, filière, téléphone), matricule sous la photo, QR à droite, pied de page filière, niveau et année. Le modèle `Student` ne garde que le matricule, la photo, la filière et le niveau. **Il manque la date de naissance, le sexe, la nationalité et le téléphone sur la carte.**

**2. La demande, puis la validation.** L'étudiant envoie le formulaire. La demande reste « en révision ». L'administration valide ou renvoie. Le matricule, le QR et le PDF n'existent qu'après la validation. L'avis part en même temps par **e-mail, message dans l'app et notification**, avec le lien de téléchargement. **L'e-mail ne s'imprime pas.** La spécification n'a ni formulaire, ni file de validation, ni avis de carte prête.

**3. L'arrivée au portail, une fois par jour.** C'est un enregistrement distinct de la liste de classe. La première lecture fixe l'heure. Le sereno scanne l'étudiant, ou l'étudiant scanne le QR du portail (il change toutes les quelques minutes) et confirme sa propre arrivée, sans retaper le mot de passe. L'année et la carrière viennent de la carte. L'administration voit les deux colonnes : heure d'entrée, puis présent ou absent à chaque séance. **Il manque le rôle sereno, le portail, le QR de portail et l'écran des arrivées.**

**4. La file hors ligne des scans.** Sans réseau, la caméra lit quand même le code. L'enregistrement reste sur le téléphone et part au retour de la connexion. La spécification ne prévoit hors ligne que l'affichage du badge.

## Là où les deux textes se contredisent

| Sujet | Décision déjà close | Spécification reçue |
|---|---|---|
| Impression | Le PDF existe après la validation | Bouton « Imprimer » et jeton créé à l'impression |
| Arrivée | Portail, une fois par jour, avec sereno | Liste de classe seulement, modes A et B |
| Avis de la carte | E-mail, message et notification avec le lien | Firebase, SMS facultatif. Pas d'avis de téléchargement |
| Situation de l'étudiant | À jour, radié, carte perdue ou révoquée | Un booléen, faux par défaut, qui bloquerait tout le monde |
| Durée | Environ 20 semaines, avec formulaire, validation et portail | 13 à 16 semaines, sans ces pièces |
| Dossiers | `packages/card` pour le PDF et `packages/database` | Prisma à la racine, seul `packages/shared` |

## Trous du schéma, à corriger avant de coder

**Il manque l'inscription de l'étudiant à un cours**, alors que la clôture doit créer les absents. **`Course.teacherId` n'est pas relié à `User`.** **`staticQrToken` est obligatoire** : on ne peut pas créer l'étudiant avant le jeton, ce qui bloque la demande en révision. **`isAdministrativelyUpToDate` vaut faux par défaut.**

## L'autre projet

Cours, examens, quiz, choix de la carrière et de l'année, aide à l'étude, classe à recommencer si l'on quitte l'app, paiement mensuel de 1 000 : cela reste hors de SmartBadge. Le détail est dans [autre-projet.md](../autre-projet.md). La phrase selon laquelle la spécification contient déjà tout ce qui a été validé ne tient pas : **il manque le formulaire, la validation, la carte du modèle et le portail.**

## Pour coder

La spécification reçue peut servir de base pour le badge et la liste de classe. Avant de la donner à une IA de codage, il faut y écrire **la demande avec validation, le format horizontal de la carte, le sereno et l'arrivée unique du jour.**
