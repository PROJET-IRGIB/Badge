# IRGIB AFRICA · portail et cartes étudiantes

## Applications

- Étudiants : /etudiant/
- Administration : /gestion-campus-irga82/ (/admin/ redirige vers l’entrée sécurisée)
- Configuration publique d’exécution : /api/config lit uniquement les variables SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY.
- La clé service_role n’est jamais utilisée côté navigateur ni dans ce dépôt.

## Backend Supabase

La migration supabase/migrations/20261022000000_initial_backend.sql crée les profils étudiants, demandes de badges, matricules, séances QR, présences, stockage privé des photos, RPC transactionnelles et règles RLS. Les tables refusent l’accès anonyme. Les étudiants ne lisent que leurs données; les administrateurs sont autorisés par public.admin_members.

### Mise en service

1. Dans les paramètres Vercel du projet, ajouter SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY aux environnements Production, Preview et Development. Le fichier .env.local est ignoré par Git et ne doit jamais être ajouté.
2. Exécuter la migration SQL dans le SQL Editor du projet Supabase, ou l’appliquer avec Supabase CLI lié au bon projet.
3. Dans Supabase Auth, activer la confirmation d’adresse e-mail et autoriser le retour vers https://irgib-africa-badge.vercel.app/etudiant/.
4. Créer l’utilisateur administrateur dans Auth puis autoriser son UUID dans public.admin_members, par le SQL Editor :
   insert into public.admin_members(user_id) select id from auth.users where lower(email)=lower('adresse-admin');
5. Redéployer Vercel après avoir enregistré les variables.

Le portail étudiant utilise Supabase Auth pour inscription, confirmation, connexion et changement de mot de passe. Il envoie les photos vers le bucket privé student-photos; la base enregistre un chemin, pas une URL publique. Les matricules temporaires sont attribués en base. L’approbation/rejet passe par une RPC admin; le matricule final est alloué sous verrou transactionnel et unique globalement. Les décisions sont définitives. Les séances de présence utilisent un jeton aléatoire dont seule l’empreinte est stockée; la RPC de présence vérifie son expiration, le groupe et le doublon.

La clé sb_publishable est conçue pour être transmise au navigateur et ne constitue pas une clé secrète. Les règles RLS protègent les données. Ne jamais fournir ni enregistrer une clé service_role, un mot de passe de base, un jeton d’accès, ni un fichier .env.

## Données académiques

Niveaux : LP1, LP2, LP3, M1, M2. Les huit filières et les six sites sont proposés : 240 groupes au total. Le Siège et Akpakpa sont deux sites distincts. La clé suit SITE-FILIERE-NIVEAU.

## Carte et présence

Carte au format 85,60 × 53,98 mm (épaisseur 0,76 mm), recto avec QR d’identification, verso avec les contacts du site. Le scanner accepte le QR de séance créé dans l’administration; la présence est confirmée après affichage des renseignements de l’étudiant. HTTPS et autorisation caméra sont nécessaires.

## Vérifications

Vérifier avant publication : syntaxe JavaScript, absence de .env suivi par Git, migration appliquée sans erreur, inscription avec confirmation e-mail, connexion étudiant/admin, demande avec photo, consultation de la photo en session signée, approbation et rejet, unicité du matricule, présence QR active/invalide/expirée/en double, et RLS avec deux comptes étudiants différents.
