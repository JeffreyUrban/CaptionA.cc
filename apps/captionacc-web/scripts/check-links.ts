#!/usr/bin/env node
import { LinkChecker } from 'linkinator'

const SITE_URL = process.env['SITE_URL'] || 'https://mysitename.url'

interface CheckLinksOptions {
  url: string
  recurse?: boolean
  timeout?: number
  retryErrors?: boolean
}

async function checkLinks(options: CheckLinksOptions = { url: SITE_URL }) {
  const { url, recurse = true, timeout = 10000, retryErrors = true } = options

  console.log(`🔍 Checking links on: ${url}\n`)

  const checker = new LinkChecker()

  checker.on('link', (result) => {
    const status = result.status || 0
    const state = result.state

    if (state === 'BROKEN') {
      console.log(`❌ [${status}] ${result.url}`)
      if (result.parent) {
        console.log(`   Found on: ${result.parent}`)
      }
    } else if (state === 'SKIPPED') {
      // Skip logging skipped links to reduce noise
    } else {
      // Only log in verbose mode
      if (process.env['VERBOSE']) {
        console.log(`✅ [${status}] ${result.url}`)
      }
    }
  })

  try {
    const result = await checker.check({
      path: url,
      recurse,
      timeout,
      retryErrors,
      linksToSkip: [
        // Skip common patterns that may cause false positives
        'mailto:',
        'tel:',
        // Skip social media links that may block automated checks
        'https://twitter.com',
        'https://x.com',
        'https://linkedin.com',
        'https://github.com',
      ],
    })

    const passedLinks = result.links.filter(link => link.state === 'OK')
    const brokenLinks = result.links.filter(link => link.state === 'BROKEN')
    const skippedLinks = result.links.filter(link => link.state === 'SKIPPED')

    console.log('\n📊 Results:')
    console.log(`Total links checked: ${result.links.length}`)
    console.log(`Passed: ${passedLinks.length}`)
    console.log(`Broken: ${brokenLinks.length}`)
    console.log(`Skipped: ${skippedLinks.length}`)

    if (brokenLinks.length > 0) {
      console.log('\n❌ Broken links found!')
      process.exit(1)
    } else {
      console.log('\n✅ All links are working!')
      process.exit(0)
    }
  } catch (error) {
    console.error('\n❌ Error checking links:', error)
    process.exit(1)
  }
}

// Allow running with custom URL from command line
const customUrl = process.argv[2]
checkLinks({ url: customUrl || SITE_URL })
