import type { MetaFunction } from 'react-router'

import { WaitlistForm } from '~/components/WaitlistForm'
import { ButtonLink } from '~/components/oatmeal/elements/button'
import { Container } from '~/components/oatmeal/elements/container'
import { Main } from '~/components/oatmeal/elements/main'
import { Section } from '~/components/oatmeal/elements/section'
import { AlertTriangleIcon } from '~/components/oatmeal/icons/alert-triangle-icon'
import { ArrowNarrowRightIcon } from '~/components/oatmeal/icons/arrow-narrow-right-icon'
import { CheckmarkIcon } from '~/components/oatmeal/icons/checkmark-icon'
import { CallToActionSimpleCentered } from '~/components/oatmeal/sections/call-to-action-simple-centered'
import { FAQsAccordion, Faq } from '~/components/oatmeal/sections/faqs-accordion'
import { Feature, FeaturesThreeColumn } from '~/components/oatmeal/sections/features-three-column'
import {
  FooterWithLinkCategories,
  FooterCategory,
  FooterLink,
} from '~/components/oatmeal/sections/footer-with-link-categories'
import { HeroSimpleCentered } from '~/components/oatmeal/sections/hero-simple-centered'
import { NavbarWithLogoActionsAndLeftAlignedLinks } from '~/components/oatmeal/sections/navbar-with-logo-actions-and-left-aligned-links'

export const meta: MetaFunction = () => {
  return [
    {
      title: 'CaptionA.cc - Professional Subtitle Extraction | Join Waitlist',
    },
    {
      name: 'description',
      content:
        'Professional-grade hardcoded subtitle extraction with exceptional accuracy and frame-accurate timing. Join our waitlist for early access.',
    },
  ]
}

export default function Home() {
  return (
    <>
      <NavbarWithLogoActionsAndLeftAlignedLinks
        logo={
          <a
            href="/"
            className="font-display text-xl font-medium tracking-tight text-olive-950 dark:text-white"
          >
            Caption<span className="font-semibold">A.cc</span>
          </a>
        }
        links={
          <>
            <a
              href="#how-it-works"
              className="text-sm/7 font-medium text-olive-950 hover:bg-olive-950/10 rounded-full px-3 py-1 dark:text-white dark:hover:bg-white/10"
            >
              How It Works
            </a>
            <a
              href="#features"
              className="text-sm/7 font-medium text-olive-950 hover:bg-olive-950/10 rounded-full px-3 py-1 dark:text-white dark:hover:bg-white/10"
            >
              Features
            </a>
            <a
              href="#faq"
              className="text-sm/7 font-medium text-olive-950 hover:bg-olive-950/10 rounded-full px-3 py-1 dark:text-white dark:hover:bg-white/10"
            >
              FAQ
            </a>
          </>
        }
        actions={
          <ButtonLink href="#waitlist-form" size="lg">
            Join Waitlist
          </ButtonLink>
        }
      />

      <Main>
        {/* Hero Section */}
        <HeroSimpleCentered
          headline="Professional Subtitle Extraction From Hardcoded Video."
          subheadline="High accuracy, frame-accurate timing, minimal corrections. Built for translation teams, media professionals, and content platforms that need reliable results."
          cta={
            <div className="flex items-center gap-4">
              <ButtonLink href="#waitlist-form" size="lg">
                Join the Waitlist
              </ButtonLink>
              <ButtonLink href="#how-it-works" size="lg" color="light">
                <span className="flex items-center gap-1">
                  Learn more <ArrowNarrowRightIcon className="size-4" />
                </span>
              </ButtonLink>
            </div>
          }
        />

        {/* Problem Section */}
        <Section
          eyebrow="The Problem"
          headline="Why Existing Tools Waste Your Time"
          className="bg-olive-950/2.5 dark:bg-white/5"
        >
          <FeaturesThreeColumn
            features={
              <>
                <Feature
                  icon={<AlertTriangleIcon className="size-5" />}
                  headline="Low Accuracy = Hours of Cleanup"
                  subheadline="Standard OCR tools produce errors that take hours to fix. What should be quick verification becomes tedious error correction."
                />
                <Feature
                  icon={<AlertTriangleIcon className="size-5" />}
                  headline="Imprecise Timing = Unusable Output"
                  subheadline="Captions off by even half a second create poor viewing experiences. Professional workflows need frame-level precision."
                />
                <Feature
                  icon={<AlertTriangleIcon className="size-5" />}
                  headline="Generic Tools, Inconsistent Results"
                  subheadline="Most tools treat all videos the same. Complex character sets, varied fonts, and different caption styles? Results vary wildly."
                />
              </>
            }
          />
        </Section>

        {/* Solution Section */}
        <Section
          id="features"
          eyebrow="The Solution"
          headline="High Accuracy, Less Work"
          subheadline="CaptionA.cc delivers professional-grade subtitle extraction designed for demanding workflows."
        >
          <FeaturesThreeColumn
            features={
              <>
                <Feature
                  icon={<CheckmarkIcon className="size-5" />}
                  headline="For Translators & Localization Teams"
                  subheadline="Extract hardcoded subtitles with accuracy that minimizes cleanup work. Get clean SRT files ready for your workflow, not hours of corrections."
                />
                <Feature
                  icon={<CheckmarkIcon className="size-5" />}
                  headline="For Media Professionals & Archives"
                  subheadline="Convert legacy content with burned-in subtitles into searchable, editable formats. Consistent quality across your video library."
                />
                <Feature
                  icon={<CheckmarkIcon className="size-5" />}
                  headline="For Language Learners & Content Platforms"
                  subheadline="Process video content with burned-in subtitles at scale. Frame-accurate timing and reliable text extraction for building language learning tools, creating study materials, or powering content platforms."
                />
              </>
            }
          />
        </Section>

        {/* Stats Section */}
        <Section
          eyebrow="Proven Quality"
          headline="Built on Real-World Testing"
          className="bg-olive-950/2.5 dark:bg-white/5"
        >
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
            <div className="text-center">
              <div className="text-4xl font-semibold text-olive-950 dark:text-white">
                Exceptional Accuracy
              </div>
              <p className="mt-2 text-sm/7 text-olive-700 dark:text-olive-400">
                Significantly better than standard OCR
              </p>
            </div>
            <div className="text-center">
              <div className="text-4xl font-semibold text-olive-950 dark:text-white">
                Frame-Accurate
              </div>
              <p className="mt-2 text-sm/7 text-olive-700 dark:text-olive-400">
                Precision down to individual frames
              </p>
            </div>
            <div className="text-center">
              <div className="text-4xl font-semibold text-olive-950 dark:text-white">
                374+ Shows
              </div>
              <p className="mt-2 text-sm/7 text-olive-700 dark:text-olive-400">
                ~374,000 captions tested
              </p>
            </div>
          </div>
        </Section>

        {/* How It Works Section */}
        <Section
          id="how-it-works"
          eyebrow="Process"
          headline="Simple Workflow, Professional Results"
          subheadline="Typical TV show: ~1000 captions per hour. Built to minimize corrections—most videos need only light verification."
        >
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
            <div>
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-olive-950 text-white dark:bg-olive-300 dark:text-olive-950">
                <span className="text-xl font-bold">1</span>
              </div>
              <h3 className="text-base/7 font-semibold text-olive-950 dark:text-white">
                Upload Your Video
              </h3>
              <p className="mt-4 text-sm/7 text-olive-700 dark:text-olive-400">
                Videos with consistent, burned-in subtitles (movies, TV shows, lectures, broadcasts,
                etc.)
              </p>
            </div>
            <div>
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-olive-950 text-white dark:bg-olive-300 dark:text-olive-950">
                <span className="text-xl font-bold">2</span>
              </div>
              <h3 className="text-base/7 font-semibold text-olive-950 dark:text-white">
                Automated Extraction
              </h3>
              <p className="mt-4 text-sm/7 text-olive-700 dark:text-olive-400">
                Our system identifies caption boundaries and extracts text with professional-grade
                accuracy
              </p>
            </div>
            <div>
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-olive-950 text-white dark:bg-olive-300 dark:text-olive-950">
                <span className="text-xl font-bold">3</span>
              </div>
              <h3 className="text-base/7 font-semibold text-olive-950 dark:text-white">
                Verify & Export
              </h3>
              <p className="mt-4 text-sm/7 text-olive-700 dark:text-olive-400">
                Quick quality verification, then export to SRT, VTT, or other formats
              </p>
            </div>
          </div>
        </Section>

        {/* Early Access CTA */}
        <CallToActionSimpleCentered
          headline="Join Our Founding Users"
          subheadline={
            <div className="text-left">
              <p className="mb-6 text-center">
                We're launching with a select group of early users. During early access, you'll:
              </p>
              <ul className="mx-auto max-w-2xl space-y-3">
                <li className="flex items-start">
                  <CheckmarkIcon className="mr-3 mt-0.5 size-5 shrink-0 text-olive-950 dark:text-white" />
                  <span>
                    <strong>Shape the product</strong> - Your feedback directly influences features
                    and workflows
                  </span>
                </li>
                <li className="flex items-start">
                  <CheckmarkIcon className="mr-3 mt-0.5 size-5 shrink-0 text-olive-950 dark:text-white" />
                  <span>
                    <strong>Direct collaboration</strong> - Work with us to ensure the tool meets
                    your needs
                  </span>
                </li>
                <li className="flex items-start">
                  <CheckmarkIcon className="mr-3 mt-0.5 size-5 shrink-0 text-olive-950 dark:text-white" />
                  <span>
                    <strong>Priority access</strong> - Be among the first to use the platform when
                    it launches
                  </span>
                </li>
              </ul>
            </div>
          }
          cta={
            <ButtonLink href="#waitlist-form" size="lg">
              Request Early Access
            </ButtonLink>
          }
          className="bg-olive-950/2.5 dark:bg-white/5"
        />

        {/* FAQ Section */}
        <FAQsAccordion id="faq" headline="Frequently Asked Questions">
          <Faq
            question="What types of videos work best?"
            answer={
              <p>
                CaptionA.cc works with videos that have consistent, clearly-positioned
                subtitles—like movies, TV shows, educational content, and broadcasts. The captions
                should have consistent styling and placement throughout the video.
              </p>
            }
          />
          <Faq
            question="How accurate is the extraction?"
            answer={
              <p>
                We've developed the system to deliver exceptional accuracy, significantly better
                than standard OCR tools. During early access, we'll work with you to ensure quality
                on your specific content.
              </p>
            }
          />
          <Faq
            question="What languages and character sets do you support?"
            answer={
              <p>
                We've primarily developed and tested with Chinese subtitles, but the system is
                designed to work with multiple character sets. We're interested in working with
                early users who have content in any language or script.
              </p>
            }
          />
          <Faq
            question="What formats do you support?"
            answer={
              <p>
                We export to SRT, VTT, and other standard subtitle formats. Upload common video
                formats like MP4, MOV, MKV, and AVI.
              </p>
            }
          />
          <Faq
            question="What about pricing?"
            answer={
              <p>
                We're still finalizing our pricing model. Details will be shared with early access
                users.
              </p>
            }
          />
          <Faq
            question="Can I use this to create language learning flashcards/Anki decks?"
            answer={
              <p>
                Yes! Frame-accurate subtitle extraction with reliable text is perfect for creating
                study materials. Let us know what output formats or integrations would be most
                valuable for your workflow.
              </p>
            }
          />
        </FAQsAccordion>

        {/* Waitlist Form Section */}
        <section id="waitlist-form" className="bg-olive-950/2.5 py-16 dark:bg-white/5">
          <Container>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="font-display text-4xl font-semibold tracking-tight text-olive-950 dark:text-white sm:text-5xl">
                Ready to Work With Better Subtitle Extraction?
              </h2>
              <p className="mt-6 text-lg/7 text-olive-700 dark:text-olive-400">
                Join the waitlist for early access.
              </p>
            </div>
            <div className="mx-auto mt-16 max-w-2xl">
              <div className="rounded-lg bg-white p-8 shadow-sm dark:bg-olive-900">
                <WaitlistForm />
              </div>
            </div>
          </Container>
        </section>

        {/* Footer */}
        <FooterWithLinkCategories
          links={
            <>
              <FooterCategory title="Product">
                <FooterLink href="#features">Features</FooterLink>
                <FooterLink href="#how-it-works">How It Works</FooterLink>
                <FooterLink href="#faq">FAQ</FooterLink>
              </FooterCategory>
              <FooterCategory title="Company">
                <FooterLink href="/contact">Contact</FooterLink>
              </FooterCategory>
            </>
          }
          fineprint={
            <>
              <div className="font-display text-xl font-medium tracking-tight text-olive-950 dark:text-white mb-4">
                Caption<span className="font-semibold">A.cc</span>
              </div>
              <p>© 2026 CaptionA.cc. All rights reserved.</p>
            </>
          }
        />
      </Main>
    </>
  )
}
