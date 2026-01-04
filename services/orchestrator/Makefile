.PHONY: help install setup serve worker clean test-queue

help:  ## Show this help message
	@echo "CaptionA.cc Orchestrator - Available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install:  ## Install dependencies
	@echo "Installing orchestrator dependencies..."
	@echo "Note: Only installs Prefect (reuses existing project dependencies)"
	cd ../.. && uv pip install prefect

install-dev:  ## Install development dependencies
	@echo "Installing orchestrator + dev dependencies..."
	cd ../.. && uv pip install prefect ruff pytest

setup:  ## Run Prefect Cloud setup (interactive)
	@echo "Starting Prefect Cloud setup..."
	cd ../.. && uv run python services/orchestrator/setup.py

serve:  ## Serve flows (makes them available for execution)
	@echo "Starting flow server..."
	cd ../.. && uv run python services/orchestrator/serve_flows.py

worker:  ## Start Prefect worker (runs flows) - DEPRECATED: Use 'make serve' instead
	@echo "⚠️  Note: In ephemeral mode, use 'make serve' instead of workers"
	@echo "Starting Prefect worker..."
	cd ../.. && uv run python services/orchestrator/start_worker.py

test-queue:  ## Test queuing a flow (requires serve running in another terminal)
	@echo "Testing flow queuing..."
	cd ../.. && uv run python services/orchestrator/queue_flow.py full-frames \
		--video-id test-123 \
		--video-path /tmp/test.mp4 \
		--db-path /tmp/test.db \
		--output-dir /tmp/output

clean:  ## Clean build artifacts
	@echo "Cleaning build artifacts..."
	rm -rf build/ dist/ *.egg-info __pycache__ .pytest_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
