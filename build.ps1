$baseDir = "e:/Local_Storage/GitHub/whereabouts_dev/whereabouts_dev"
$jsDir = "$baseDir/js"
$outFile = "$baseDir/index_refactored.html"
$templateFile = "$baseDir/index.html"
$cssFile = "$baseDir/styles.css"

# Read HTML Template
$html = Get-Content $templateFile -Raw

# Remove existing script tags (simplified regex, might need tuning)
# We remove lines containing <script src="js/..."> to avoid duplicates
# And removing <link rel="stylesheet"> for styles.css
$html = $html -replace '<script src="js/.*"></script>', ''
$html = $html -replace '<link rel="stylesheet" href="styles.css">', ''

# Prepare CSS Concat
$cssContent = Get-Content $cssFile -Raw
$styleBlock = "<style>`n$cssContent`n</style>"

# Prepare JS Concat
$jsFiles = @(
    "app_core.js",
    "app_sync_legacy.js",
    "globals.js",
    "utils.js",
    "vacations.js",
    "admin.js",
    "app_network.js",
    "app_auth.js",
    "app_notices.js",
    "app_tools.js",
    "app_logic.js",
    "bootstrap.js"
)

$combinedJs = ""
foreach ($file in $jsFiles) {
    $path = "$jsDir/$file"
    if (Test-Path $path) {
        $content = Get-Content $path -Raw
        $combinedJs += "`n/* --- $file --- */`n$content`n"
    } else {
        Write-Host "Warning: File not found: $path"
    }
}

$scriptBlock = "<script>`n$combinedJs`n</script>"

# Inject into HTML
# Insert Style before </head>
$html = $html -replace '</head>', "$styleBlock`n</head>"

# Insert Script before </body>
$html = $html -replace '</body>', "$scriptBlock`n</body>"

# Write Output
Set-Content -Path $outFile -Value $html -Encoding UTF8
Write-Host "Build complete: $outFile"
