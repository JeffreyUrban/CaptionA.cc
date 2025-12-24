# Developer Documentation

This directory contains technical documentation for caption_frames developers and contributors.

## Documentation Structure

### Design Documentation (`design/`)

Technical architecture and design decisions:

- **[IMPLEMENTATION.md](design/IMPLEMENTATION.md)** - Current implementation overview
  - Core algorithm architecture
  - Data structures and processing phases
  - Key implementation details

- **[ALGORITHM_DESIGN.md](design/ALGORITHM_DESIGN.md)** - Detailed algorithm design
  - TEMPLATE_PLACEHOLDER
  - Memory management and data structures
  - Performance characteristics

- **[DESIGN_RATIONALE.md](design/DESIGN_RATIONALE.md)** - Design decisions and trade-offs
  - Why certain approaches were chosen
  - Alternatives considered
  - Trade-offs and constraints
  - Feature scope decisions

### Testing Documentation (`testing/`)

Test strategy and coverage:

- **[TESTING_STRATEGY.md](testing/TESTING_STRATEGY.md)** - Test organization and approach
  - Test categories and structure
  - Unit, integration, and oracle testing
  - Testing best practices
  - CI/CD integration

- **[TEST_COVERAGE.md](testing/TEST_COVERAGE.md)** - Test coverage tracking
  - Coverage targets and status
  - Test scenarios for each feature
  - Gap analysis and priorities
  - Historical testing milestones

- **[ORACLE_TESTING.md](testing/ORACLE_TESTING.md)** - Oracle-based testing
  - Reference implementation testing
  - Correctness validation approach
  - Oracle compatibility guarantees

### Deployment Documentation (`deployment/`)

Distribution and release processes:

- **[DEPLOYMENT.md](deployment/DEPLOYMENT.md)** - Distribution strategy
  - PyPI package setup
  - Homebrew formula
  - Release process
  - Version management

## Documentation Standards

**Permanent Documentation** (design/, testing/, user/):
- Describes current reality, not plans or history
- Updated as features are implemented
- Technical and precise
- Includes code references where relevant

**Planning Documentation** (planning/, deployment/):
- Future-focused, not binding commitments
- Helps evaluate new feature requests
- Provides context for decisions
- May reference completed work for context

**All Documentation**:
- Written in Markdown
- Links to related docs
- Code examples tested where possible
- Updated alongside code changes
