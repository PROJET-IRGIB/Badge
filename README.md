# IRGIB AFRICA · portail et cartes étudiantes

## Applications

- Étudiants : /etudiant/
- Administration : /espace-campus/ (connexion Supabase et autorisation par site ; /admin/ renvoie au portail étudiant)
- Configuration publique d’exécution : /api/config lit uniquement les variables SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY.
- La clé `service_role` n’est jamais exposée au navigateur ni stockée dans le dépôt ; elle est utilisée uniquement côté serveur par la fonction Edge via une variable d’environnement secrète.

## Backend Supabase

Les migrations dans supabase/migrations créent les profils étudiants, demandes de badges, matricules, séances QR, présences, stockage privé des photos, RPC transactionnelles et règles RLS. La dernière migration ajoute les appels quotidiens, les absences par séance et les droits administrateur limités à un site. Les étudiants et les admins n’accèdent qu’aux données autorisées par RLS.

### Mise en service

1. Dans les paramètres Vercel du projet, ajouter SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY aux environnements Production, Preview et Development. Le fichier .env.local est ignoré par Git et ne doit jamais être ajouté.
2. Exécuter les migrations SQL dans l’ordre dans le SQL Editor du projet Supabase, ou les appliquer avec Supabase CLI lié au bon projet. Exécuter aussi `20261023130000_daily_attendance_and_site_admins.sql` pour les présences quotidiennes et les accès par site.
3. Dans Supabase Auth, activer la confirmation d’adresse e-mail et autoriser le retour vers https://irgib-africa-badge.vercel.app/etudiant/.
4. Un compte dans `public.admin_members` reste administrateur général. Pour un administrateur limité à un site, l’ajouter plutôt à `public.admin_site_members` et le retirer de `public.admin_members` :
   `insert into public.admin_site_members(user_id,site) select id,'COT-AKPAKPA' from auth.users where lower(email)=lower('adresse-admin') on conflict do nothing;`
   `delete from public.admin_members where user_id=(select id from auth.users where lower(email)=lower('adresse-admin'));`
   Remplacer `COT-AKPAKPA` par `CAL-CENTRE`, `PNV-CENTRE`, `PRK-CENTRE` ou `DJG-CENTRE` selon le site.
   Pour conserver un administrateur général, créer/autoriser son UUID dans `public.admin_members` :
   insert into public.admin_members(user_id) select id from auth.users where lower(email)=lower('adresse-admin');
5. Redéployer Vercel après avoir enregistré les variables.

Le portail étudiant utilise Supabase Auth pour inscription, confirmation, connexion et changement de mot de passe. Il envoie les photos vers le bucket privé student-photos; la base enregistre un chemin, pas une URL publique. Les matricules temporaires sont attribués en base. L’approbation/rejet passe par une RPC admin; le matricule final est alloué sous verrou transactionnel et unique globalement. Les décisions sont définitives. Chaque jour, les groupes avec des étudiants approuvés reçoivent une séance locale au fuseau `Africa/Porto-Novo`; la liste est créée en absent, puis la RPC sécurisée bascule l’étudiant en présent au scan. Les jetons sont conservés dans une table privée et seule leur empreinte figure dans les séances. Le nom de cours reste « Séance du jour » jusqu’à l’ajout d’un emploi du temps.

La clé sb_publishable est conçue pour être transmise au navigateur et ne constitue pas une clé secrète. Les règles RLS protègent les données. Ne jamais fournir ni enregistrer une clé service_role, un mot de passe de base, un jeton d’accès, ni un fichier .env.

## Données académiques

Niveaux : LP1, LP2, LP3, M1, M2. Les huit filières et les cinq sites d’étude sont proposés : 200 groupes au total. À Cotonou, seul Akpakpa est un site d’étude; le Siège administratif n’est pas proposé aux étudiants. La clé suit SITE-FILIERE-NIVEAU.

## Carte et présence

Carte au format 85,60 × 53,98 mm (épaisseur 0,76 mm), recto avec QR d’identification, verso avec les contacts du site. Le scanner accepte le QR de séance créé dans l’administration; la présence est confirmée après affichage des renseignements de l’étudiant. HTTPS et autorisation caméra sont nécessaires.

## Documentation

Le mode d’emploi du portail est ce fichier. Le cadrage, l’état du portail et le projet séparé de cours sont dans [docs/smartbadge.md](docs/smartbadge.md). Vercel ne publie pas ce dossier.

## Vérifications

Vérifier avant publication : syntaxe JavaScript, absence de .env suivi par Git, migration appliquée sans erreur, inscription avec confirmation e-mail, connexion étudiant/admin, demande avec photo, consultation de la photo en session signée, approbation et rejet, unicité du matricule, présence QR active/invalide/expirée/en double, et RLS avec deux comptes étudiants différents.
