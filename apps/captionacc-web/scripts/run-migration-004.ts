/**
 * Run migration 004 (add ocr_visualization_image) on all annotations.db files
 */

import { readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { migrateOCRVisualizationImage } from '../app/db/migrate'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function findAnnotationsDbs(dir: string): string[] {
  const results: string[] = []

  try {
    const entries = readdirSync(dir)

    for (const entry of entries) {
      const fullPath = join(dir, entry)

      try {
        const stat = statSync(fullPath)

        if (stat.isDirectory()) {
          // Recursively search subdirectories
          results.push(...findAnnotationsDbs(fullPath))
        } else if (entry === 'annotations.db') {
          results.push(fullPath)
        }
      } catch {
        // Skip inaccessible files/directories
        continue
      }
    }
  } catch {
    // Skip inaccessible directories
  }

  return results
}

async function main() {
  const dataDir = join(__dirname, '../../../local/data')

  console.log('Finding annotations.db files...')
  const dbPaths = findAnnotationsDbs(dataDir)

  console.log(`Found ${dbPaths.length} databases\n`)

  let migrated = 0
  let skipped = 0
  let errors = 0

  for (const dbPath of dbPaths) {
    try {
      const wasMigrated = migrateOCRVisualizationImage(dbPath)
      if (wasMigrated) {
        migrated++
      } else {
        skipped++
      }
    } catch (error) {
      console.error(`Error migrating ${dbPath}:`, error)
      errors++
    }
  }

  console.log('\n=== Migration Summary ===')
  console.log(`Total databases: ${dbPaths.length}`)
  console.log(`Migrated: ${migrated}`)
  console.log(`Skipped (already migrated): ${skipped}`)
  console.log(`Errors: ${errors}`)
}

main().catch(console.error)
