$ErrorActionPreference = 'Stop'
$rootPath = [System.IO.Path]::GetFullPath($PSScriptRoot)
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:8765/')
$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.png' = 'image/png'
  '.webp' = 'image/webp'
  '.json' = 'application/json; charset=utf-8'
  '.rules' = 'text/plain; charset=utf-8'
}

$listener.Start()
Write-Host 'Maquette IRGIB AFRICA disponible sur http://localhost:8765/etudiant/'
Write-Host 'Arrête le serveur avec Ctrl+C dans cette fenêtre.'
Start-Process 'http://localhost:8765/etudiant/'

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $relativePath = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relativePath)) { $relativePath = 'etudiant/index.html' }
      $relativePath = $relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $filePath = [System.IO.Path]::GetFullPath((Join-Path $rootPath $relativePath))
      $allowedPrefix = $rootPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
      if (-not $filePath.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        $context.Response.StatusCode = 403
        $context.Response.Close()
        continue
      }
      if ([System.IO.Directory]::Exists($filePath)) { $filePath = Join-Path $filePath 'index.html' }
      if (-not [System.IO.File]::Exists($filePath)) {
        $context.Response.StatusCode = 404
        $context.Response.Close()
        continue
      }
      $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
      $context.Response.ContentType = $mimeTypes[$extension]
      if (-not $context.Response.ContentType) { $context.Response.ContentType = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $context.Response.Close()
    } catch {
      try { $context.Response.StatusCode = 500; $context.Response.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
