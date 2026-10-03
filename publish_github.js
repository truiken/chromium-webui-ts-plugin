#!/usr/bin/env node
// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const repoDir = __dirname;

function getEnvToken() {
  const envPath = path.join(process.env.HOME || '', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('GITHUB_TOKEN=')) {
        return trimmed.substring('GITHUB_TOKEN='.length).trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
  return process.env.GITHUB_TOKEN || null;
}

function checkSsh() {
  try {
    const out = execSync('ssh -o BatchMode=yes -T git@github.com 2>&1 || true', { encoding: 'utf8' });
    const match = out.match(/Hi\s+([a-zA-Z0-9_-]+)!/);
    if (match) {
      return { ok: true, user: match[1] };
    }
  } catch (e) {}
  return { ok: false };
}

function githubApiRequest(method, endpoint, token, data) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: endpoint,
        method: method,
        headers: {
          'User-Agent': 'chromium-webui-ts-plugin-publisher',
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      }
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('=== GitHub Publisher for chromium-webui-ts-plugin ===\n');

  // Check 1: SSH authentication
  console.log('Checking SSH authentication to github.com...');
  const sshResult = checkSsh();
  if (sshResult.ok) {
    console.log(`✓ Authenticated via SSH as '${sshResult.user}'!`);
    const remoteUrl = `git@github.com:${sshResult.user}/chromium-webui-ts-plugin.git`;
    console.log(`Setting remote origin: ${remoteUrl}`);
    try {
      execSync(`git remote remove origin 2>/dev/null || true`, { cwd: repoDir });
      execSync(`git remote add origin ${remoteUrl}`, { cwd: repoDir });
      console.log('Pushing to GitHub (main)...');
      execSync(`git push -u origin main`, { cwd: repoDir, stdio: 'inherit' });
      console.log('\n✓ Successfully pushed repository to GitHub!');
      return;
    } catch (e) {
      console.error('Error during git push:', e.message);
      return;
    }
  }
  console.log('SSH key is not yet associated with a GitHub account.');

  // Check 2: Token authentication
  console.log('Checking for GITHUB_TOKEN...');
  const token = getEnvToken();
  if (token) {
    console.log('✓ Found GITHUB_TOKEN. Querying user info...');
    const userRes = await githubApiRequest('GET', '/user', token);
    if (userRes.status !== 200 || !userRes.data || !userRes.data.login) {
      console.error(`GitHub API authentication failed (status ${userRes.status}):`, userRes.data);
      return;
    }
    const username = userRes.data.login;
    console.log(`✓ Authenticated as GitHub user: ${username}`);

    // Create repo if it doesn't exist
    console.log(`Creating repository '${username}/chromium-webui-ts-plugin' on GitHub...`);
    const createRes = await githubApiRequest('POST', '/user/repos', token, {
      name: 'chromium-webui-ts-plugin',
      description: 'Dynamic TypeScript import resolver and IntelliSense enhancer for Chromium WebUI in VS Code',
      private: false,
      has_issues: true,
    });

    if (createRes.status === 201) {
      console.log(`✓ Repository created: https://github.com/${username}/chromium-webui-ts-plugin`);
    } else if (createRes.status === 422) {
      console.log(`Repository already exists on GitHub.`);
    } else {
      console.warn(`Note on repository creation (status ${createRes.status}):`, createRes.data && createRes.data.message);
    }

    const pushUrl = `https://${username}:${token}@github.com/${username}/chromium-webui-ts-plugin.git`;
    const publicUrl = `https://github.com/${username}/chromium-webui-ts-plugin.git`;

    console.log('Configuring remote and pushing...');
    execSync(`git remote remove origin 2>/dev/null || true`, { cwd: repoDir });
    execSync(`git remote add origin ${pushUrl}`, { cwd: repoDir });
    execSync(`git push -u origin main`, { cwd: repoDir, stdio: 'inherit' });
    // Reset origin to public clean URL without embedded token
    execSync(`git remote set-url origin ${publicUrl}`, { cwd: repoDir });

    console.log(`\n✓ Successfully created and pushed repository to: ${publicUrl}`);
    return;
  }

  console.log('\nNeither SSH authentication nor GITHUB_TOKEN is configured yet.');
}

main().catch(console.error);
