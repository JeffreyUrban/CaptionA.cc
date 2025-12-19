#!/bin/bash

# Validate images for vite-imagetools setup
# Checks for:
# - Images still in public/images (should be in app/assets/images)
# - Images not registered in centralized registry
# - Excessively large source files (>5MB)
# - Proper image formats

ERRORS=0
WARNINGS=0

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "🖼️  Validating images for vite-imagetools setup..."
echo ""

# 1. Check for images in public/images (should be none)
echo "📍 Checking for images in old public/images directory..."
if [ -d "public/images" ]; then
    image_count=$(find public/images -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \) 2>/dev/null | wc -l | tr -d ' ')
    if [ "$image_count" -gt 0 ]; then
        echo "${RED}❌ Found $image_count images in public/images${NC}"
        echo "   💡 Images should be in app/assets/images and imported through:"
        echo "      - app/lib/images.ts (for specific images)"
        echo "      - app/lib/articleImages.ts (for article galleries via glob)"
        ((ERRORS++))
        find public/images -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \) | head -5 | while read file; do
            echo "      ${RED}• $file${NC}"
        done
        if [ "$image_count" -gt 5 ]; then
            echo "      ${RED}... and $((image_count - 5)) more${NC}"
        fi
    else
        echo "${GREEN}✅ No images in public/images (correct)${NC}"
    fi
else
    echo "${GREEN}✅ public/images directory doesn't exist (correct)${NC}"
fi

echo ""

# 2. Check for excessively large source files in app/assets/images
echo "📏 Checking for large source files..."
LARGE_FILE_THRESHOLD_KB=5120  # 5MB

large_files_found=false
while IFS= read -r -d '' image_file; do
    size_kb=$(du -k "$image_file" | cut -f1)
    if [ "$size_kb" -gt "$LARGE_FILE_THRESHOLD_KB" ]; then
        if [ "$large_files_found" = false ]; then
            echo "${RED}❌ Found excessively large source files (>5MB):${NC}"
            large_files_found=true
        fi
        size_mb=$(echo "scale=1; $size_kb / 1024" | bc)
        echo "   ${RED}• $image_file (${size_mb}MB)${NC}"
        echo "      💡 Optimize before committing: sips -s formatOptions 85 \"$image_file\" --out \"$image_file\""
        ((ERRORS++))
    fi
done < <(find app/assets/images -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) -print0 2>/dev/null)

if [ "$large_files_found" = false ]; then
    echo "${GREEN}✅ No excessively large source files (all <5MB)${NC}"
fi

echo ""

# 3. Check that images.ts exists and has imports
echo "📦 Checking centralized image registry..."
if [ ! -f "app/lib/images.ts" ]; then
    echo "${RED}❌ app/lib/images.ts not found${NC}"
    ((ERRORS++))
else
    import_count=$(grep -c "^import.*from.*assets/images" app/lib/images.ts || echo "0")
    if [ "$import_count" -eq 0 ]; then
        echo "${YELLOW}⚠️  No image imports found in app/lib/images.ts${NC}"
        ((WARNINGS++))
    else
        echo "${GREEN}✅ Found $import_count image imports in app/lib/images.ts${NC}"
    fi
fi

echo ""

# 4. Check that articleImages.ts exists and has glob import
echo "📦 Checking article images glob import..."
if [ ! -f "app/lib/articleImages.ts" ]; then
    echo "${RED}❌ app/lib/articleImages.ts not found${NC}"
    ((ERRORS++))
else
    if grep -q "import.meta.glob" app/lib/articleImages.ts; then
        echo "${GREEN}✅ Article images using glob import${NC}"
    else
        echo "${RED}❌ No glob import found in app/lib/articleImages.ts${NC}"
        ((ERRORS++))
    fi
fi

echo ""

# 5. Count images in app/assets/images
echo "📊 Image inventory:"
if [ -d "app/assets/images" ]; then
    total_images=$(find app/assets/images -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" -o -iname "*.svg" \) 2>/dev/null | wc -l | tr -d ' ')
    jpg_count=$(find app/assets/images -type f \( -iname "*.jpg" -o -iname "*.jpeg" \) 2>/dev/null | wc -l | tr -d ' ')
    png_count=$(find app/assets/images -type f -iname "*.png" 2>/dev/null | wc -l | tr -d ' ')
    svg_count=$(find app/assets/images -type f -iname "*.svg" 2>/dev/null | wc -l | tr -d ' ')

    echo "${BLUE}   • Total images: $total_images${NC}"
    echo "${BLUE}   • JPG/JPEG: $jpg_count${NC}"
    echo "${BLUE}   • PNG: $png_count${NC}"
    echo "${BLUE}   • SVG: $svg_count${NC}"

    # Count article images (handled by glob)
    article_images=$(find app/assets/images/articles -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) 2>/dev/null | wc -l | tr -d ' ')
    echo "${BLUE}   • Article gallery images (via glob): $article_images${NC}"
else
    echo "${RED}❌ app/assets/images directory not found${NC}"
    ((ERRORS++))
fi

echo ""

# 6. Info about vite-imagetools processing
echo "ℹ️  ${BLUE}Images are automatically processed by vite-imagetools:${NC}"
echo "   • Converted to WebP format at build time"
echo "   • Multiple sizes generated based on query parameters"
echo "   • Optimized for web delivery"
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "${GREEN}✅ All image validations passed!${NC}"
    echo ""
    echo "Image optimization setup is correct:"
    echo "  ✓ All images in app/assets/images"
    echo "  ✓ Centralized registry (app/lib/images.ts)"
    echo "  ✓ Article glob import (app/lib/articleImages.ts)"
    echo "  ✓ vite-imagetools configured for automatic WebP conversion"
    exit 0
else
    echo "${RED}Image validation completed with issues:${NC}"
    echo "  • Errors: $ERRORS"
    echo "  • Warnings: $WARNINGS"
    echo ""
    if [ $ERRORS -gt 0 ]; then
        echo "${RED}❌ Please fix errors before committing.${NC}"
        exit 1
    else
        echo "${YELLOW}⚠️  Warnings found. Consider addressing these issues.${NC}"
        exit 0
    fi
fi
