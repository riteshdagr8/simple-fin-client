Set-Location "$PSScriptRoot"
$env:PORT="4200"
$env:NODE_ENV="development"
# All secrets are loaded from .env — do not hardcode them here
node server/index.js
