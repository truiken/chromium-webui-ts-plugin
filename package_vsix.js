#!/usr/bin/env node
// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = __dirname;
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const tempDir = path.join(rootDir, '.vsix_staging');

console.log(`Packaging ${vsixName}...`);

// Clean staging directory
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(path.join(tempDir, 'extension'), { recursive: true });

// 1. Copy extension files
const filesToInclude = ['package.json', 'index.js', 'README.md', 'LICENSE'];
for (const f of filesToInclude) {
  if (fs.existsSync(path.join(rootDir, f))) {
    fs.copyFileSync(path.join(rootDir, f), path.join(tempDir, 'extension', f));
  }
}

// 2. Generate [Content_Types].xml
const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
  <Default Extension="txt" ContentType="text/plain"/>
</Types>
`;
fs.writeFileSync(path.join(tempDir, '[Content_Types].xml'), contentTypesXml);

// 3. Generate extension.vsixmanifest
const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Id="${pkg.name}" Version="${pkg.version}" Language="en-US" Publisher="${pkg.publisher || 'local'}"/>
    <DisplayName>${pkg.displayName || pkg.name}</DisplayName>
    <Description xml:space="preserve">${pkg.description || ''}</Description>
    <Categories>Programming Languages</Categories>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/>
  </Assets>
</PackageManifest>
`;
fs.writeFileSync(path.join(tempDir, 'extension.vsixmanifest'), vsixManifest);

// 4. Create ZIP package (.vsix)
const targetVsix = path.join(rootDir, vsixName);
if (fs.existsSync(targetVsix)) {
  fs.unlinkSync(targetVsix);
}

execSync(`zip -r "${targetVsix}" .`, { cwd: tempDir, stdio: 'inherit' });

// Clean staging directory
fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\nSuccessfully created package: ${targetVsix}`);
