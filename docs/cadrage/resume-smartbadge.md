> Cadrage de la vision. Le portail publié est décrit dans [l’état actuel](../portail-actuel.md).

# SmartBadge — résumé pour l'équipe

Université IRGIB-AFRICA, année 2025-2026. Ce qui est retenu pour la mise en œuvre, section par section. Ceci est le cadrage, pas du code déjà livré.

20 semaines pour deux développeurs. 6 phases. 6 rôles. Une seule règle de validité.

**Règle commune.** Cours, compositions, bibliothèque et emprunts interrogent la même politique : inscrit sur l'année, à jour dans sa scolarité, non radié, et QR encore valable.

## 1. Vision

Passer du badge papier à un badge numérique qui identifie, ouvre le contrôle d'accès, pointe les présences, sert à la bibliothèque et bloque automatiquement un étudiant qui n'est pas à jour. L'étudiant peut toujours imprimer sa carte.

## 2. La carte

Format horizontal, comme une pièce d'identité. Photo à gauche, données en colonnes à droite. Le PDF reprend le modèle : en-tête bleu avec le nom de l'université, l'écusson et l'année ; bande dorée « CARTE D'ÉTUDIANT » ; nom en grand (ESONO NCHAMA) et, dessous, le prénom d'usage (Jesús Esono) ; matricule IRGIB-3424F sous la photo ; QR à droite ; pied de page filière, niveau et année.

| Zone | Contenu |
|---|---|
| En-tête | UNIVERSITÉ IRGIB-AFRICA et année académique |
| Bande | CARTE D'ÉTUDIANT |
| Identité | Photo, nom, prénom, naissance, sexe, nationalité, téléphone |
| Scolarité | Filière et niveau, choisis dans une liste |
| Sous la photo | Matricule, attribué à la validation |
| QR | Code statique du document imprimé |
| Pied | Filière, niveau, année |

## 3. Demande, validation, téléchargement

La demande et la carte sont deux objets. L'envoi enregistre les données. La validation crée le matricule, le QR et le PDF. L'étudiant télécharge le document et l'imprime lui-même.

| Étape | Qui | Résultat |
|---|---|---|
| Remplir et envoyer | Étudiant | Demande « En révision », avec photo et données |
| Contrôler la file | Administration | Validée, ou renvoyée avec un commentaire |
| Corriger | Étudiant | La même demande repart en révision |
| Produire le PDF | Système, à la validation | Matricule, QR statique, document horizontal |
| Prévenir | E-mail, message dans l'app et notification | Lien de téléchargement |
| Télécharger et imprimer | Étudiant | Trace du téléchargement |

L'e-mail sert à l'avis. Il ne figure pas sur la carte imprimée. Le PDF n'existe qu'après la validation.

## 4. QR hybride

| QR | Où | Durée | Rôle |
|---|---|---|---|
| Statique | PDF et papier | L'année, jusqu'à révocation | Carte imprimée |
| Dynamique | Téléphone | 30 à 60 secondes | Présentation au contrôle |
| Portail | Écran à l'entrée | Quelques minutes | Une arrivée par jour |
| Salle | Cours, labo, bibliothèque | Fixe | Identifie le lieu |

Une carte perdue ou un étudiant radié : le jeton imprimé est révoqué. La carte suivante en porte un autre. Le code papier ne change pas tout seul.

## 5. Arrivée au portail

Une seule arrivée par jour. La première lecture fixe l'heure. Une lecture suivante répond « Déjà enregistré à 07:42 » et ne déplace pas cette heure. Année et filière viennent de la carte validée.

| Situation | Geste | Ce qui est enregistré |
|---|---|---|
| Portail avec sereno | Le sereno scanne le QR du téléphone ou du papier | Photo, nom, année, filière, heure de la première lecture |
| Portail sans sereno | L'étudiant scanne le QR de l'écran et confirme sa propre arrivée | La même heure. Un second passage le même jour ne la change pas |

La confirmation de l'étudiant porte sur son propre nom, déjà connu du carnet. Une liste ouverte de la classe permettrait de cocher quelqu'un d'autre.

## 6. Liste de classe

Entrer sur le campus à 07:42 enregistre l'arrivée. Être dans le cours de 10:00 s'enregistre à part. Le tableau du jour réunit les deux colonnes : heure de portail, puis présent ou absent à chaque séance.

| Mode | Qui scanne | Suite |
|---|---|---|
| A | Le responsable de classe scanne le badge | Plus fiable. Il clôture la séance |
| B | L'étudiant scanne le QR de la salle et choisit son cours | Plus rapide. Les deux modes cohabitent |

Après clôture, la fiche de présence part automatiquement au professeur. L'historique reste consultable. Sans réseau, les scans sont conservés sur l'appareil et envoyés au retour de la connexion.

## 7. Blocage, perte, renouvellement

Un étudiant pas à jour, radié, ou dont la carte est déclarée perdue, est refusé partout avec la même règle. Le renouvellement suit l'année académique : nouvelle inscription, nouveau PDF. Les absences au-delà du seuil déclenchent une alerte.

## 8. Bibliothèque et emprunts

Le même badge sert à l'entrée et à l'emprunt de matériel. Le scan passe par la règle de validité déjà utilisée pour les cours.

## 9. Administration

Dans la première phase : la file des demandes et, avec la présence, le tableau des arrivées et des listes. Dans la phase 5 : facultés, filières, matières, import Excel, détection des doublons, statistiques par département, exports PDF et Excel, droits fins.

## 10. Rôles

| Rôle | Écran | Fait |
|---|---|---|
| Étudiant | /etudiant | Envoie la demande, télécharge le PDF, confirme sa venue si le portail n'a pas de sereno |
| Sereno | /sereno | Scanne la carte au portail. La première lecture du jour fixe l'heure |
| Responsable de classe | /responsable | Scanne, vérifie, clôture et produit la fiche |
| Professeur | /professeur | Reçoit la fiche et consulte l'historique |
| Bibliothèque | /bibliotheque | Entrées et emprunts |
| Administration | /admin | Valide les demandes et suit présences et heures |

## 11. Structure retenue

Un monorepo. Une PWA Next.js et TypeScript avec Tailwind. Une API NestJS. PostgreSQL et Prisma. Avis par e-mail, message dans l'app et notification Firebase. Hébergement VPS ou Railway/Render.

| Dossier | Rôle |
|---|---|
| apps/web | Formulaire, carte, portail, listes, administration |
| apps/api | Demandes, badges, QR, accès, présence, fiches, bibliothèque, avis |
| packages/database | Schéma Prisma |
| packages/card | La même carte horizontale, en PDF |
| packages/shared | Rôles et statuts partagés |

## 12. Phases de mise en œuvre

| Phase | Ce qui est mis en place | Semaines |
|---|---|---|
| 1. Demande et carte | Formulaire, file de validation, PDF, e-mail, message et notification avec le lien | 4 |
| 2. Présence | Arrivée au portail une fois par jour, listes A et B, tableau de présence, file hors ligne | 4 |
| 3. Fiches et blocage | Fiche au professeur, blocage scolarité ou radiation, carte perdue, renouvellement, alertes d'absences | 3 |
| 4. Bibliothèque | Entrée et emprunt avec la même règle | 3 |
| 5. Administration | Facultés et matières, Excel, doublons, statistiques, exports, permissions | 4 |
| 6. Lancement | Tests, formation du responsable de classe, du sereno et de l'administration | 2 |

### Deuxième livraison

Ouverture NFC des portes, réservation de salles, réservation de matériel, hors ligne avec conflits.

Le hors ligne du premier lancement conserve les scans et les envoie quand le réseau revient. Le traitement des conflits entre deux appareils attend la deuxième livraison.

## Autre projet — cours, examens et quiz

Le texte complet est dans [autre-projet.md](../autre-projet.md).

Ce n'est pas un module de SmartBadge. Une autre application, pilotée par les étudiants. Les phases, la base et l'administration de l'université restent celles du badge.

Le seul lien avec le badge est le matricule. L'étudiant crée son profil avec ce numéro de série, puis choisit sa carrière et son année. Cours, examens et séance du jour dépendent de ces deux choix.

### Carrière et année

Deux sections obligatoires après le profil. L'étudiant choisit sa carrière, puis l'année dans laquelle il est. Les documents, les anciens examens et la classe du jour s'affichent pour cette carrière et cette année. Changer de section ouvre un autre rayon : une autre carrière, ou une année antérieure pour consulter ses examens.

### Parcours d'une séance

| Section | Ce qui est prévu |
|---|---|
| Profil | Un compte par matricule de badge |
| Carrière | Section pour choisir sa filière |
| Année | Section pour choisir l'année en cours, ou une année passée |
| Cours | Documents par thème, téléchargeables, stockés dans le cloud |
| Examens | Archives des années précédentes, filtrées par carrière et par année |
| Séance du jour | Une classe proposée selon le thème de cette carrière et de cette année |
| Quiz | Court questionnaire après la séance, lié aux documents du jour |
| Aide à l'étude | Une IA dans l'app, qui répond à partir des documents du cours |
| Accès | Paiement mensuel de 1 000, puis activation par l'équipe étudiante |
| Blocage | Sans renouvellement, le compte se ferme automatiquement |

### Règle de la classe commencée

Une classe commencée se termine dans l'application. Si l'étudiant quitte l'app — il la ferme, passe à une autre application, ou sort de la séance — cette classe est interrompue. Il la recommence depuis le début. Le quiz du jour s'ouvre seulement après une séance menée jusqu'au bout.

### IA étudiante

L'application inclut une aide pour étudier. L'étudiant pose ses questions dans l'app. Les réponses s'appuient sur les documents de sa carrière, de son année et de la séance en cours, les mêmes documents que le quiz. Elle accompagne la révision. Elle ne remplace pas la séance ni le quiz.

Le montant est de 1 000. L'unité monétaire reste à confirmer. Le paiement est constaté par l'équipe, qui active le mois. L'échéance bloque l'accès toute seule.
