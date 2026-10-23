$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$vercel = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercel) {
  throw 'Vercel CLI requis. Installez-le avec npm install -g vercel, puis lancez vercel login et vercel link.'
}
Write-Host 'Espace étudiant local : http://localhost:8765/etudiant/'
Write-Host 'Espace administration : http://localhost:8765/espace-campus/'
Write-Host 'Arrêtez le serveur avec Ctrl+C.'
vercel dev --listen 8765
