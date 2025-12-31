"""LLM-based text vetting for error detection and correction.

Uses an LLM to:
- Detect transcription errors in caption text
- Provide corrected versions
- Segment words/phrases
- Translate to English
- Explain meaning in context
"""

import json
from pathlib import Path
from typing import Any

from .database import get_captions_with_text, get_database_path


def caption_vetting_prompt(caption_text: str, prev_context: list[str], next_context: list[str]) -> str:
    """Generate vetting prompt for LLM.

    Args:
        caption_text: Caption text to vet
        prev_context: List of previous caption texts (up to 5)
        next_context: List of next caption texts (up to 5)

    Returns:
        Prompt string for LLM
    """
    prev_context_str = "\n".join(prev_context) if prev_context else " "
    next_context_str = "\n".join(next_context) if next_context else " "

    return f"""You are given three text snippets: "previous context," "caption" (current segment), and "next context" for captions from a video. Analyze the "caption" segment using the surrounding context, focusing on whether its Chinese characters contain a likely transcription error (i.e., miswritten or incorrect character) based on meaning and context.

**Instructions:**

- has_error: Determine if the caption contains a *character transcription error* (ignore punctuation and whitespace issues).
- corrected: If a character transcription error exists, provide a corrected version, only fixing character mistakes.
- word_segmentation: Segment the caption into meaningful words/phrases according to standard usage in this context.
- translation: Translate the caption precisely into English.
- explanation: Summarize the meaning of the segment in English, given the surrounding context; Provide only that meaning, without reference to this prompt, or the example or that it is a summary, or that it is about a text (i.e. DO NOT mention "caption", "context", "the text").
- Output all findings in a JSON object with the keys: `has_error`, `corrected`, `word_segmentation`, `translation`, and `explanation`.

**Do not process any text below "EXAMPLE INPUT/OUTPUT"—it is only to illustrate the required behavior.**

---

#### Actual Input:

Previous context:
`{prev_context_str}`

Caption:
`{caption_text}`

Next context:
`{next_context_str}`

---

#### EXAMPLE INPUT/OUTPUT

**(FOR REFERENCE ONLY; NOT PART OF THE TASK)**

Previous context:
` `

Caption:
`中国 多样的地理环境和气候`

Next context:
`日出而作 且落而息
人们春种
秋收
夏耘
冬藏`

Expected JSON output:

{{
  "has_error": false,
  "corrected": null,
  "word_segmentation": ["中国", "多样的", "地理环境", "和", "气候"],
  "translation": "China's diverse geographical environment and climate",
  "explanation": "China has a varied geography and climate, and seasonal agricultural practices (spring sowing, summer weeding, autumn harvest, winter storage). Environmental diversity shapes traditional farming cycles across different regions of China."
}}

---

**Begin analysis for the Actual Input only. Omit any reference to this instruction or the example.**"""


def vet_caption_with_llm(
    caption_text: str,
    prev_context: list[str],
    next_context: list[str],
    model: str = "claude-sonnet-4-5",
    use_ollama: bool = False,
) -> dict[str, Any]:
    """Vet caption text using LLM.

    Args:
        caption_text: Caption text to vet
        prev_context: Previous caption texts for context
        next_context: Next caption texts for context
        model: Model name (for Claude API or Ollama)
        use_ollama: If True, use Ollama API instead of Anthropic

    Returns:
        Dictionary with:
            - has_error: bool
            - corrected: str | None
            - word_segmentation: list[str]
            - translation: str
            - explanation: str

    Raises:
        ValueError: If LLM response cannot be parsed
    """
    prompt = caption_vetting_prompt(caption_text, prev_context, next_context)

    if use_ollama:
        try:
            import ollama  # type: ignore

            response = ollama.generate(model=model, prompt=prompt)
            response_text = response["response"]
        except ImportError as e:
            raise ImportError("Ollama package not installed. Install with: pip install ollama") from e
    else:
        try:
            import anthropic  # type: ignore

            client = anthropic.Anthropic()
            message = client.messages.create(
                model=model,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
            response_text = message.content[0].text
        except ImportError as e:
            raise ImportError("Anthropic package not installed. Install with: pip install anthropic") from e

    # Extract JSON from response
    try:
        # Find JSON object in response
        start_idx = response_text.find("{")
        end_idx = response_text.rfind("}") + 1

        if start_idx == -1 or end_idx == 0:
            raise ValueError("No JSON object found in LLM response")

        json_str = response_text[start_idx:end_idx]
        result = json.loads(json_str)

        # Validate required keys
        required_keys = ["has_error", "corrected", "word_segmentation", "translation", "explanation"]
        missing_keys = [k for k in required_keys if k not in result]
        if missing_keys:
            raise ValueError(f"Missing required keys in LLM response: {missing_keys}")

        return result

    except (json.JSONDecodeError, ValueError) as e:
        raise ValueError(f"Failed to parse LLM response: {e}\nResponse: {response_text}") from e


def vet_video_captions(
    video_dir: Path,
    output_path: Path | None = None,
    model: str = "claude-sonnet-4-5",
    use_ollama: bool = False,
    context_size: int = 5,
    batch_size: int = 100,
) -> list[dict[str, Any]]:
    """Vet all captions in a video for errors.

    Args:
        video_dir: Path to video directory
        output_path: Optional path to write JSONL results
        model: LLM model name
        use_ollama: If True, use Ollama instead of Anthropic
        context_size: Number of captions before/after for context
        batch_size: Number of captions to process per batch

    Returns:
        List of vetting results with caption info and LLM analysis
    """
    db_path = get_database_path(video_dir)

    results = []
    min_id = 0

    while True:
        # Get batch of captions
        captions = get_captions_with_text(db_path, min_id=min_id, limit=batch_size)
        if not captions:
            break

        # Vet each caption
        for i, caption in enumerate(captions):
            caption_text = caption["text"]
            caption_id = caption["id"]

            # Get context
            prev_context = [c["text"] for c in captions[max(0, i - context_size) : i]]
            next_context = [c["text"] for c in captions[i + 1 : i + 1 + context_size]]

            try:
                vetting_result = vet_caption_with_llm(
                    caption_text=caption_text,
                    prev_context=prev_context,
                    next_context=next_context,
                    model=model,
                    use_ollama=use_ollama,
                )

                result = {
                    "caption_id": caption_id,
                    "start_frame": caption["start_frame_index"],
                    "end_frame": caption["end_frame_index"],
                    "caption_text": caption_text,
                    **vetting_result,
                }

                results.append(result)

                # Write to output file if provided
                if output_path:
                    with open(output_path, "a") as f:
                        f.write(json.dumps(result, ensure_ascii=False) + "\n")

            except Exception as e:
                print(f"Error vetting caption {caption_id}: {e}")
                continue

        # Update min_id for next batch
        min_id = captions[-1]["id"]

    return results


def extract_errors_from_vetting_results(
    vetting_results_path: Path,
    output_csv_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Extract captions with errors from vetting results.

    Args:
        vetting_results_path: Path to JSONL file with vetting results
        output_csv_path: Optional path to write CSV of errors

    Returns:
        List of captions with errors
    """
    errors = []

    with open(vetting_results_path, "r") as f:
        for line in f:
            if not line.strip():
                continue

            result = json.loads(line)

            if result.get("has_error"):
                errors.append(
                    {
                        "caption_id": result["caption_id"],
                        "start_frame": result["start_frame"],
                        "end_frame": result["end_frame"],
                        "original_text": result["caption_text"],
                        "corrected_text": result.get("corrected", ""),
                    }
                )

    # Write to CSV if requested
    if output_csv_path and errors:
        with open(output_csv_path, "w") as f:
            f.write("caption_id,start_frame,end_frame,original_text,corrected_text\n")
            for error in errors:
                # Escape commas
                original = error["original_text"].replace(",", "，")
                corrected = error["corrected_text"].replace(",", "，")
                f.write(f'{error["caption_id"]},{error["start_frame"]},{error["end_frame"]},{original},{corrected}\n')

    return errors
