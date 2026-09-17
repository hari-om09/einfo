$ErrorActionPreference = "Stop"

Write-Host "Validating docker-compose config..."
docker-compose config
if ($LASTEXITCODE -ne 0) {
    Write-Error "docker-compose config failed!"
}

Write-Host "Config is valid. Safe and sound!"
Write-Host "You can now run 'docker-compose up --build -d' to start the application."
