#!/usr/bin/env node

/**
 * This script helps update the Node.js version across the project.
 * It updates .nvmrc, package.json, and Dockerfile to use the specified version.
 * 
 * Usage: node scripts/update-node-version.js <version>
 * Example: node scripts/update-node-version.js 21.6.0
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import semver from 'semver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Get the version from command line arguments
const newVersion = process.argv[2];

if (!newVersion || !semver.valid(semver.coerce(newVersion))) {
  console.error('Please provide a valid Node.js version.');
  console.error('Usage: node scripts/update-node-version.js <version>');
  console.error('Example: node scripts/update-node-version.js 21.6.0');
  process.exit(1);
}

const cleanVersion = semver.clean(newVersion) || semver.coerce(newVersion).version;
const majorVersion = semver.major(cleanVersion);

console.log(`Updating Node.js version to ${cleanVersion}...`);

// Update .nvmrc
const nvmrcPath = path.join(rootDir, '.nvmrc');
writeFileSync(nvmrcPath, cleanVersion);
console.log(`✅ Updated .nvmrc to ${cleanVersion}`);

// Update package.json
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
packageJson.engines.node = `>=${cleanVersion} <${majorVersion + 1}.0.0`;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`✅ Updated package.json engines to ${packageJson.engines.node}`);

// Update Dockerfile
const dockerfilePath = path.join(rootDir, 'Dockerfile');
const dockerfile = readFileSync(dockerfilePath, 'utf8');
const updatedDockerfile = dockerfile.replace(
  /ARG NODE_VERSION=\d+\.\d+\.\d+/,
  `ARG NODE_VERSION=${cleanVersion}`
);
writeFileSync(dockerfilePath, updatedDockerfile);
console.log(`✅ Updated Dockerfile to use Node.js ${cleanVersion}`);

// Check if nvm is available
let nvmAvailable = false;
try {
  // Try to detect nvm by checking if NVM_DIR is set
  const nvmDir = process.env.NVM_DIR;
  nvmAvailable = !!nvmDir;
} catch {
  nvmAvailable = false;
}

if (nvmAvailable) {
  console.log('\n⚠️ NVM is installed but cannot be used directly from Node.js scripts.');
}

console.log('\n🎉 Configuration files updated successfully!');
console.log(`The project is now configured to use Node.js ${cleanVersion}`);
console.log('\nNext steps:');
console.log(`1. Install Node.js ${cleanVersion} manually:`);
console.log(`   - With nvm: Run 'nvm install ${cleanVersion} && nvm use ${cleanVersion}'`);
console.log(`   - Without nvm: Download from https://nodejs.org/`);
console.log('2. Reinstall dependencies: Run \'npm ci\'');
console.log('3. Test the build: Run \'npm run build\'');
console.log('4. Commit the changes to version control');
console.log('5. Deploy the updated application'); 