$ErrorActionPreference = 'Stop'

$base = 'https://info.propertylist.es'
$sitemapUrl = "$base/sitemap.xml"

Write-Host "Fetching $sitemapUrl"
$raw = (curl.exe -s $sitemapUrl) | Out-String
if (-not $raw.TrimStart().StartsWith('<')) {
	Write-Host "Sitemap not available at $sitemapUrl"
	exit 1
}
$xml = [xml]$raw
$urls = @($xml.urlset.url.loc | ForEach-Object { $_.'#text' }) | Where-Object { $_ }

$docs = $urls | Where-Object { $_ -match '^https://info\.propertylist\.es/docs/' } | ForEach-Object { $_.Replace($base,'') }
$esdocs = $urls | Where-Object { $_ -match '^https://info\.propertylist\.es/es/docs/' } | ForEach-Object { $_.Replace($base,'') }

$normalizedEs = $esdocs | ForEach-Object { $_.Replace('/es','') }
$missingInEs = $docs | Where-Object { $normalizedEs -notcontains $_ }
$missingInEn = $normalizedEs | Where-Object { $docs -notcontains $_ }

$report = [ordered]@{
  generatedAt = (Get-Date).ToString('s')
  docsCount = $docs.Count
  esDocsCount = $esdocs.Count
  missingEsCount = $missingInEs.Count
  missingEnCount = $missingInEn.Count
  missingEnglishPaths = $missingInEs
  missingSpanishPaths = $missingInEn
}

$outDir = Join-Path $PSScriptRoot '..\reports'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir 'es-docs-parity.json'
$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -Path $outPath

Write-Host "Wrote $outPath"
Write-Host "Missing ES pages: $($missingInEs.Count)"
