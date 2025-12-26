# Design Rationale and Trade-offs

**Purpose**: Document why features were included, excluded, or deferred. Explains design decisions and trade-offs.

## Core Design Principles

### 1. Unix Composition Over Feature Bloat

**Principle**: Prefer documented composition patterns over built-in features when composition is efficient and clear.

**Rationale**:
- Smaller, faster tool with less code to maintain
- Users leverage existing knowledge of Unix tools
- Better citizen of Unix ecosystem
- Easier testing with fewer feature interactions

**Application**:
- ✅ Keep features when composition is inefficient, complex, or breaks streaming
- ❌ Cut features when standard tools can achieve the same result simply
- 📖 Document all composition patterns with tested examples

---

### 2. Streaming First

**Principle**: All features must work with unbounded streams and bounded memory.

**Rationale**:
- Real-time monitoring (`tail -f | crop_frames`)
- Predictable memory usage
- Scalable to any input size
- True Unix filter behavior

**Application**:
- History limits (default 100k for stdin, unlimited for files)
- Configurable via `--unlimited-history` when needed
- Features that require full input are deferred or cut

---

### 3. Core Competency Focus

**Principle**: Focus on TEMPLATE_PLACEHOLDER, not TEMPLATE_PLACEHOLDER.

**Rationale**:
- TEMPLATE_PLACEHOLDER

**Application**:
- ✅ Features that enhance TEMPLATE_PLACEHOLDER
- ❌ Features better served by TEMPLATE_PLACEHOLDER

---

## Feature Inclusion Decisions

### ✅ Kept: TEMPLATE_PLACEHOLDER

---

## Feature Exclusion Decisions

### ❌ Cut: TEMPLATE_PLACEHOLDER

---

## Implementation Trade-offs

### TEMPLATE_PLACEHOLDER

---

## Tool Comparisons

### vs. TEMPLATE_PLACEHOLDER

---

## Removed Features and Rationale

### TEMPLATE_PLACEHOLDER

---

### Features Clarified During Planning

**1. TEMPLATE_PLACEHOLDER**

---

## See Also

- **IMPLEMENTATION.md** - Implementation overview
- **ALGORITHM_DESIGN.md** - Core algorithm details
