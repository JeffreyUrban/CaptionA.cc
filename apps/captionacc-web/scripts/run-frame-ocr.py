#!/usr/bin/env python3
"""
Run OCR on frames and return simple results

Takes frame indices as input, runs OCR, returns JSON with text extracted.
"""

import sys
import json
from pathlib import Path

# Add ocr_utils to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'packages' / 'ocr_utils' / 'src'))

from ocr_utils.processing import process_frame_ocr_with_retry


def extract_text_from_annotations(annotations):
    """Extract text from OCR annotations array."""
    if not annotations:
        return ''

    texts = []
    for ann in annotations:
        if isinstance(ann, (list, tuple)) and len(ann) > 0:
            texts.append(ann[0])  # First element is text
        elif isinstance(ann, dict) and 'text' in ann:
            texts.append(ann['text'])

    # Join without separator for continuous text (e.g., Chinese characters)
    return ''.join(texts)


def calculate_average_confidence(annotations):
    """Calculate average confidence from annotations."""
    if not annotations:
        return 0.0

    confidences = []
    for ann in annotations:
        if isinstance(ann, (list, tuple)) and len(ann) > 1:
            confidences.append(ann[1])  # Second element is confidence
        elif isinstance(ann, dict) and 'confidence' in ann:
            confidences.append(ann['confidence'])

    if not confidences:
        return 1.0

    return sum(confidences) / len(confidences)


def main():
    # Check for single image mode
    if len(sys.argv) >= 3 and sys.argv[1] == '--single':
        image_path = Path(sys.argv[2])
        language = sys.argv[3] if len(sys.argv) > 3 else 'zh-Hans'

        try:
            ocr_result = process_frame_ocr_with_retry(
                image_path,
                language=language,
                timeout=10,
                max_retries=3
            )

            annotations = ocr_result.get('annotations', [])
            text = extract_text_from_annotations(annotations)

            # Output simple result for single image
            print(json.dumps({
                'text': text,
                'framework': ocr_result.get('framework', 'unknown'),
                'language': language
            }, ensure_ascii=False))

        except Exception as e:
            print(json.dumps({'error': str(e)}), file=sys.stderr)
            sys.exit(1)
        return

    # Original multi-frame mode
    if len(sys.argv) < 4:
        print("Usage: run-frame-ocr.py <frames_dir> <language> <frame_index1> [frame_index2] ...", file=sys.stderr)
        print("   or: run-frame-ocr.py --single <image_path> [language]", file=sys.stderr)
        sys.exit(1)

    frames_dir = Path(sys.argv[1])
    language = sys.argv[2]
    frame_indices = [int(idx) for idx in sys.argv[3:]]

    results = []

    for frame_index in frame_indices:
        frame_path = frames_dir / f"frame_{str(frame_index).zfill(10)}.jpg"

        try:
            ocr_result = process_frame_ocr_with_retry(
                frame_path,
                language=language,
                timeout=10,
                max_retries=3
            )

            annotations = ocr_result.get('annotations', [])
            text = extract_text_from_annotations(annotations)
            confidence = calculate_average_confidence(annotations)

            results.append({
                'frame_index': frame_index,
                'ocr_text': text,
                'ocr_annotations': annotations,
                'ocr_confidence': confidence
            })
        except Exception as e:
            # Return empty result on error
            results.append({
                'frame_index': frame_index,
                'ocr_text': '',
                'ocr_annotations': [],
                'ocr_confidence': 0.0,
                'error': str(e)
            })

    # Output JSON
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    main()
