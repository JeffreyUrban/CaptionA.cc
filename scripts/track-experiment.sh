#!/bin/bash
# Track trained model checkpoint with DVC
# Usage: ./scripts/track-experiment.sh <experiment_dir> <wandb_run_id> <model_name>

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ $# -lt 3 ]; then
    echo -e "${RED}Usage: $0 <experiment_dir> <wandb_run_id> <model_name>${NC}"
    echo ""
    echo "Example:"
    echo "  $0 path/to/model versionhash fusion"
    exit 1
fi

EXPERIMENT_DIR=$1
WANDB_RUN_ID=$2
MODEL_NAME=$3

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Tracking Model${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""
echo -e "Experiment:  ${YELLOW}${EXPERIMENT_DIR}${NC}"
echo -e "W&B Run ID:  ${YELLOW}${WANDB_RUN_ID}${NC}"
echo -e "Model Name:  ${YELLOW}${MODEL_NAME}${NC}"
echo ""

# Validate experiment directory
if [ ! -d "${EXPERIMENT_DIR}" ]; then
    echo -e "${RED}❌ Error: Experiment directory not found: ${EXPERIMENT_DIR}${NC}"
    exit 1
fi

# Find best checkpoint
BEST_CHECKPOINT="${EXPERIMENT_DIR}/checkpoints/best.pt"
if [ ! -f "${BEST_CHECKPOINT}" ]; then
    echo -e "${RED}❌ Error: Best checkpoint not found at ${BEST_CHECKPOINT}${NC}"
    exit 1
fi

CHECKPOINT_SIZE=$(du -h "${BEST_CHECKPOINT}" | cut -f1)
echo -e "${GREEN}✓${NC} Found checkpoint: ${BEST_CHECKPOINT} (${CHECKPOINT_SIZE})"

# Validate checkpoint
echo "Validating checkpoint..."
python3 - << PYEOF
import torch
import sys
try:
    ckpt = torch.load("${BEST_CHECKPOINT}", map_location='cpu', weights_only=False)
    if isinstance(ckpt, dict):
        print(f"  Epoch: {ckpt.get('epoch', 'unknown')}")
        if 'metrics' in ckpt:
            metrics = ckpt['metrics']
            if 'val/accuracy' in metrics:
                print(f"  Val Accuracy: {metrics['val/accuracy']:.4f}")
    sys.exit(0)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
PYEOF

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Invalid checkpoint${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Checkpoint validated"
echo ""

# Copy to models directory
MODEL_PATH="models/caption_frame_extents/${MODEL_NAME}_${WANDB_RUN_ID}.pt"
echo "Copying to versioned location: ${MODEL_PATH}"
cp "${BEST_CHECKPOINT}" "${MODEL_PATH}"
echo -e "${GREEN}✓${NC} Model copied"
echo ""

# Create metadata file
METADATA_FILE="${MODEL_PATH%.pt}.json"
echo "Creating metadata file..."
cat > "${METADATA_FILE}" << JSONEOF
{
  "wandb_run_id": "${WANDB_RUN_ID}",
  "experiment_dir": "${EXPERIMENT_DIR}",
  "checkpoint_path": "${MODEL_PATH}",
  "tracked_at": "$(date -Iseconds)",
  "git_commit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
}
JSONEOF
echo -e "${GREEN}✓${NC} Metadata created: ${METADATA_FILE}"
echo ""

# Track with DVC
echo "📦 Tracking with DVC..."
dvc add "${MODEL_PATH}"
echo -e "${GREEN}✓${NC} DVC tracking complete"
echo ""

# Stage for git
echo "📋 Staging for git..."
git add "${MODEL_PATH}.dvc" "${METADATA_FILE}" .gitignore
echo -e "${GREEN}✓${NC} Files staged"
echo ""

echo -e "${BLUE}Staged files:${NC}"
git diff --cached --name-only | sed 's/^/  /'
echo ""

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  ✅ Success!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo "1. Commit:"
echo -e "   ${BLUE}git commit -m \"Track ${MODEL_NAME} model from run ${WANDB_RUN_ID}\"${NC}"
echo ""
echo "2. Push to DVC:"
echo -e "   ${BLUE}dvc push${NC}"
echo ""
echo "3. Push to git:"
echo -e "   ${BLUE}git push${NC}"
echo ""
