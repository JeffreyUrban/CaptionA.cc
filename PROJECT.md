# CaptionA.cc Project Overview

**CaptionA.cc** is a SaaS application that identifies caption timing and text content within videos with high accuracy.

**Target Platforms**: Desktop via web browser

## Project Vision

Create a data annotation and training pipeline and maintainable SaaS application that:
- Has high accuracy
- Is easy to use
- Continually improves with more data annotations

## Technology Stack

### Core Technologies
- **Package Management**: uv (Python), npm workspaces (TypeScript)
- **Deployment**: Fly.io
- **Version Control**: GitHub

### Frontend Build Process
- **TypeScript**: Source files in `apps/*/app/static/js/src/`, compiled to `apps/*/app/static/js/dist/`
- **Compiled Files in Git**: JavaScript build artifacts (`.js`, `.d.ts`, `.map`) are committed to git
  - **Rationale**: Simplifies deployment by serving pre-compiled files directly in production
  - **Tradeoffs**:
    - ✅ Simpler deployment (no build step required)
    - ✅ Guaranteed consistency between source and deployed code
    - ❌ Larger repository size
    - ❌ Potential merge conflicts in compiled files
  - **Requirements**:
    - Must run `npm run build` before committing TypeScript changes
    - CI checks verify compiled files match source (planned)
- **Linting**: ESLint with @typescript-eslint for code quality
  - Run `npm run lint` to check code
  - Run `npm run lint:fix` to auto-fix issues
- **Future Optimizations** (to consider as bundle size grows):
  - **Minification**: Use terser or esbuild to reduce production bundle size
  - **Code Splitting**: Split TypeScript into multiple chunks loaded on demand
  - **Tree Shaking**: Remove unused code from production builds
  - **Build Pipeline**: Consider moving to build-time compilation in CI/CD

### Architecture Approach
- **Monorepo**: Single repository for all services and packages
- **Solo Development**: Optimized for single developer maintainability
- **Opinionated**: Prefer established best practices, prefer frameworks / components that optimize for simplicity and maintainability
- **Simple over Complex**: Choose straightforward solutions

### Technology Choices To Consider (consider if necessary, consider what to choose)
- [ ] **CDN**: For static assets (CSS, JS, images)
- [ ] **Database**: SQLite (dev/simple) vs PostgreSQL and/or NoSQL and/or vector store (production/scalable)
- [ ] **Payment Processor**: Stripe, Paddle, Lemon Squeezy, or alternatives
- [ ] **Subscription Management**: Likely integrated with payment processor. 
  - We'll want some flexibility to grandfather in earlier users at lower prices, given maintenance of their subscription. 
- [ ] **User Authentication**: Roll-your-own vs Auth0/Clerk/SuperTokens
- [ ] **Mail Provider**: SendGrid, Mailgun, AWS SES, Postmark
- [ ] **Logging**: CloudWatch, Datadog, Sentry, or Python logging
- [ ] **Performance Monitoring**: New Relic, Datadog, Scout APM
- [ ] **Error Monitoring**: Sentry, Rollbar, or similar
- [ ] **Maintenance Approach**: Automated updates, monitoring, backup strategy
- [ ] **Media Storage**: Local and/or cloud storage for pipeline media files
- [ ] **ML Model Storage**: Where to store trained models for caption/audio pipelines
- [ ] **ML Training Infrastructure**: Local vs cloud for model training/retraining
- [ ] **ML Framework**: PyTorch for user/content distribution modeling
- [ ] **Numerical Computing**: NumPy/SciPy for KL divergence calculations, or specialized libraries

## Repository Structure

## Database Design Considerations

The video is divided into audio segments and burned-in captions. Audio segments may be nested or overlapping. Audio segment word boundaries may not match burned-in caption word boundaries. 

### Core Data Models

**ML Pipeline Models**:
- **Annotation**: User/admin corrections for ML feedback
  - (caption_id/audio_segment_id, correction_type, old_value, new_value, corrected_by, corrected_at, issue_description)
- **MLModel**: ML model versions and metrics (model_type, version, accuracy, training_date)

### Timing Precision
- Store times as **milliseconds** or **10Hz indices** (0.1s precision)
  - Database uses integer indices for precision
  - Example: `start_time_ms = 12500` → 12.5 seconds
- Caption sync requires precision for accurate segment playback

## Development Approach

### Best Practices
1. **Code Standards**:
   - Python: Ruff linter, type hints, 120 char lines
   - Prefer Typescript over Javascript (unless trivial)
   - JavaScript: ESLint + Prettier
   - Consistent naming conventions
2. **Version Control**:
   - Feature branches
   - Descriptive commit messages
   - Pull request reviews (even solo - for documentation)
3. **Testing**:
   - pytest for backend
   - Coverage targets (aim for 80%+ critical paths)
   - Integration tests for API endpoints
4. **Documentation**:
   - Keep this document updated 
   - Inline docstrings (Python)
   - API documentation (FastAPI auto-generated)
   - Architecture decision records (ADRs) for major choices
5. **Dependency Management**:
   - Lock files (uv.lock)
   - Regular security updates
   - Minimal dependency footprint

### Solo Developer Workflow
- Keep complexity low for long-term maintenance
- Prefer boring, proven technologies, or newer options if meaningfully more elegant 
- Automate repetitive tasks (scripts, CI/CD)
- Document non-obvious decisions
- Use SaaS when it reduces operational burden

## Deployment Architecture

### Fly.io Deployment
- Single region initially (expand as needed)
- Database: Fly Postgres or external managed DB
- Static assets: Fly CDN or external CDN
- Environment-based configuration (dev, staging, production)

### Environment Configuration
```bash
# Database
export DATABASE_URL="postgresql://..."  # or sqlite:///data/captionacc.db

# Payment processor
export STRIPE_SECRET_KEY="..."

# Authentication secrets
export JWT_SECRET="..."

# Mail provider
export MAIL_API_KEY="..."
```

## Content Pipeline Architecture

### Overview

Content preparation involves machine learning pipelines to extract and annotate captions and audio segments from videos.

Pipelines are in subdirectories:
- `data-pipelines/captions` - (burned-in) Caption detection and annotation
- `data-pipelines/segments` - Audio/Video segmentation and annotation (including text content disambiguation via alignment with caption text)

### Caption Pipeline (Burned-in Captions)

**Why Not Video Hosting Provider Captions?**: Auto-generated captions are generally speech-to-text based, resulting in incorrect text content and inaccurate timing. We use ML to detect and extract burned-in captions directly from video frames, and we have our own speech to text pipeline.

**Process**:
1. **Caption Detection**: ML models identify burned-in caption regions in video frames
2. **Bounds Extraction**: Determine caption bounding box per video (e.g., bottom of frame)
3. **OCR**: Extract text content from detected caption regions
4. **Timing**: Capture precise start/end timestamps for each caption
5. **Annotation Workflow**: Human review and correction of ML-generated annotations
6. **Database Import**: Store curated captions with precise timestamps

**Output**: High-quality caption data in database with accurate text and timing.

### Audio Clipping Pipeline

**Purpose**: Detect natural audio segment boundaries and speaker changes for audio-based exercises.

**Technology**: Pyannote library for audio segmentation and diarization.

**Process**:
1. **Audio Extraction**: Extract audio track from video
2. **Segmentation**: Identify natural breaks, pauses, speaker changes
3. **Diarization**: Identify different speakers
4. **Boundary Detection**: Determine precise start/end times for audio segments
5. **Annotation Workflow**: Human review and adjustment of segment boundaries
6. **Database Import**: Store audio segment metadata

**Output**: Audio segment boundaries for use cases requiring audio or video playback.

### Pipeline Integration Vision

**Admin Annotation Correction**:
- Admin user notices incorrect caption or audio boundary
- Clicks "Edit" to enter annotation correction mode
- Makes correction inline (adjust timing, fix text, refine boundaries)
- Correction saved to database AND fed back to ML training pipeline
- Improves ML models over time through active learning

TODO: User can also flag issues with captions or audio segments, and suggest corrections. Admins can review and approve these corrections, which are then applied to the database and used to improve ML models.

**Integration Benefits**:
0. Remove problematic media. Source user feedback.  
1. **In-Context Corrections**: Fix issues where they're discovered
2. **Closed Feedback Loop**: Corrections improve ML models
3. **Single Source of Truth**: One database for both app and pipelines. Content is promoted from draft to production and can be demoted back from production to issue-to-fix.
4. **Simplified Workflow**: No context switching between tools

### Media File Storage (Open Question)

**Options**:
- [ ] Keep media files in separate directory outside repo
- [ ] Store in repo but gitignored (`data/media/`)
- [ ] Use cloud storage (S3, GCS) for pipeline input/output
- [ ] Hybrid: Development files local, production in cloud

**Considerations**:
- Media files can be large (multiple GB per video)
- Needed for pipeline development and testing
- Must avoid committing to git

## Future Considerations

### Scalability
- Start with SQLite, migrate to PostgreSQL (or other database(s)) when needed
- Horizontal scaling via Fly.io multi-region
- Cache layer (Redis) if database becomes bottleneck
- CDN for static assets at scale

### Internationalization
- Support multiple languages (Chinese, Norwegian, Latin, etc.)
- i18n for UI (FastAPI i18n extensions)

### Content Management
- Admin interface for adding playlists/videos
- Bulk caption import tools
