# Future Improvements

## Central Registry Database (Storage Optimization)

**Current approach**: Fully self-contained datasets - each dataset database includes all data needed for training.

**Future optimization**: Split into central registry + per-dataset databases for better storage efficiency.

### Design

**Central Registry** (`registry.db`):
- `VideoRegistry` - Video hashes, paths, metadata (shared across datasets)
- `FontEmbedding` - Cached FontCLIP embeddings (expensive to recompute, ~512 dim per video)
- `Experiment` - Training run tracking, checkpoint paths, W&B links

**Per-Dataset Databases** (`datasets/{name}.db`):
- `TrainingDataset` - Dataset metadata
- `TrainingSample` - Frame pairs with labels
- `TrainingFrame` - Frame image BLOBs
- `TrainingOCRVisualization` - OCR visualization BLOBs
- Foreign keys reference registry.db (attach database during queries)

### Benefits

- **Deduplication**: Font embeddings computed once, reused across datasets
- **Storage savings**: Multiple datasets from same videos don't duplicate 512-dim embeddings
- **Still portable**: Dataset databases are self-contained (can copy without registry, regenerate embeddings if needed)
- **Training efficiency**: Open 2 databases instead of 1, minimal overhead

### When to Implement

When storage becomes a concern (e.g., 10+ datasets, 100+ videos with cached embeddings).

### Implementation Notes

Use SQLite ATTACH DATABASE:
```python
db.execute(f"ATTACH DATABASE '{registry_path}' AS registry")
# Query across databases
db.query(TrainingSample).join(registry.FontEmbedding, ...)
```

### Why Not Now?

Keeping it simple: fully self-contained datasets are easier to understand, manage, and debug. No cross-database dependencies to reason about.
