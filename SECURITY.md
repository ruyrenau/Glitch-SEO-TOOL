# Security Policy

## Threat Model & Controls

### 1. File Uploads & Log Processing
- **Stream Ingestion**: Large logs (`.log`, `.gz`) are ingested chunk-by-chunk using Node.js readable streams with backpressure. No large file is buffered fully into RAM, preventing memory exhaustion (DoS).
- **Decompression Bomb Protection**: Gzip streams apply max uncompressed line limits and threshold checks.
- **Path Traversal**: Absolute file paths are resolved and strictly validated to prevent directory traversal.

### 2. Privacy & PII Protection
- **IP Anonymization**: IP addresses are never stored in raw plaintext. They are pseudonymized via HMAC-SHA256 with a configurable salt secret.
- **Sensitive Query Parameter Redaction**: Query strings are automatically stripped of sensitive parameters (`token`, `password`, `email`, `auth`, `session`, etc.).

### 3. SSRF & Crawler Protection
- **Private Network Blocking**: Crawler requests block RFC1918 private IP subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1/8`) unless explicitly whitelisted in development.
- **Respect for robots.txt**: Crawlers strictly parse and obey directives and rate limits.

### 4. Editorial Security (WordPress)
- **Draft Only**: The WordPress connector enforces `status: draft` at the code level. It is technically impossible to trigger auto-publishing into production through this tool without manual dashboard approval.

### 5. Reporting Vulnerabilities
Please report any discovered vulnerabilities to `security@glitchseo.internal`.
