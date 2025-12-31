"""VLM-based caption text inference using fine-tuned Qwen2.5-VL.

Loads a fine-tuned Qwen2.5-VL model with LoRA and generates caption text
from cropped frames with OCR annotations and layout priors.
"""

import json
from io import BytesIO
from pathlib import Path
from typing import Any

import torch
from PIL import Image
from transformers import AutoProcessor, AutoTokenizer
from transformers.models.qwen2_5_vl import Qwen2_5_VLForConditionalGeneration


# Global model instance to avoid reloading
_model_instance: dict[str, Any] | None = None


def load_finetuned_model(checkpoint_path: Path) -> dict[str, Any]:
    """Load fine-tuned Qwen2.5-VL model from checkpoint.

    Uses 4-bit quantization with LoRA adapters matching training setup.

    Args:
        checkpoint_path: Path to Lightning checkpoint file (.ckpt)

    Returns:
        Dictionary with 'model', 'processor', 'tokenizer'

    Raises:
        RuntimeError: If checkpoint loading fails
    """
    global _model_instance

    # Return cached instance if already loaded
    if _model_instance is not None and _model_instance.get("checkpoint_path") == checkpoint_path:
        return _model_instance

    print(f"Loading fine-tuned model from checkpoint: {checkpoint_path}")

    try:
        from peft import LoraConfig, TaskType, get_peft_model
        from transformers import BitsAndBytesConfig

        print("Recreating model with quantization to match training setup...")

        # Quantization config (same as training)
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        )

        # Load base model with quantization
        base_model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            "Qwen/Qwen2.5-VL-3B-Instruct",
            quantization_config=bnb_config,
            device_map="auto",
            trust_remote_code=True,
            attn_implementation="flash_attention_2" if torch.cuda.is_available() else "eager",
        )

        processor = AutoProcessor.from_pretrained("Qwen/Qwen2.5-VL-3B-Instruct", trust_remote_code=True)
        tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-VL-3B-Instruct", trust_remote_code=True)

        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        # Apply LoRA configuration (same as training)
        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=8,
            lora_alpha=16,
            lora_dropout=0.2,
            target_modules=[
                "q_proj",
                "v_proj",
                "k_proj",
                "o_proj",
                "gate_proj",
                "up_proj",
                "down_proj",
            ],
            bias="none",
        )
        base_model = get_peft_model(base_model, lora_config)

        # Load checkpoint weights
        checkpoint = torch.load(checkpoint_path, map_location="cuda" if torch.cuda.is_available() else "cpu")

        if "state_dict" in checkpoint:
            state_dict = checkpoint["state_dict"]

            # Filter to LoRA adapter weights
            filtered_state_dict = {}
            for key, value in state_dict.items():
                if (
                    "lora" in key.lower()
                    or "adapter" in key.lower()
                    or key.startswith("model.model.lm_head")
                    or ("base_layer" not in key and "quant" not in key and "absmax" not in key)
                ):
                    # Remove Lightning wrapper prefix
                    if key.startswith("model."):
                        new_key = key[6:]  # Remove 'model.' prefix
                        filtered_state_dict[new_key] = value

            print(f"Loading {len(filtered_state_dict)} fine-tuned parameters...")

            # Load LoRA weights
            missing_keys, unexpected_keys = base_model.load_state_dict(filtered_state_dict, strict=False)

            # Check for actual missing LoRA keys
            actual_missing = [k for k in missing_keys if "lora" in k.lower() or "adapter" in k.lower()]
            if actual_missing:
                print(f"Warning: Missing LoRA keys: {actual_missing[:5]}...")

        base_model.eval()

        _model_instance = {
            "model": base_model,
            "processor": processor,
            "tokenizer": tokenizer,
            "checkpoint_path": checkpoint_path,
        }

        print("Successfully loaded quantized model with LoRA fine-tuned weights")
        return _model_instance

    except Exception as e:
        raise RuntimeError(f"Failed to load checkpoint from {checkpoint_path}: {e}") from e


def generate_caption(
    model_dict: dict[str, Any],
    main_image: Image.Image,
    font_example_image: Image.Image,
    ocr_annotations: list[list[Any]],
    layout_config: dict[str, Any],
) -> str:
    """Generate caption text using VLM model.

    Args:
        model_dict: Dictionary from load_finetuned_model() with model, processor, tokenizer
        main_image: Cropped caption frame image
        font_example_image: Reference image showing caption font style
        ocr_annotations: List of [[char, confidence, [x1, y1, x2, y2]], ...] in absolute pixels
        layout_config: Layout configuration dict with:
            - frame_width, frame_height
            - anchor_position, anchor_type (left/center/right)
            - box_height (caption text height in pixels)

    Returns:
        Generated caption text
    """
    model = model_dict["model"]
    processor = model_dict["processor"]

    # Get layout parameters
    img_width = layout_config["frame_width"]
    img_height = layout_config["frame_height"]
    anchor_pixel = (layout_config["anchor_position"], img_height // 2)
    text_height_pixels = layout_config["box_height"]
    justification = layout_config["anchor_type"]

    # Construct prompt
    ocr_json = json.dumps(ocr_annotations, ensure_ascii=False)

    prompt = (
        f"Task: Read text from a caption, given two images and an OCR annotation.\n"
        f"The first image ({img_width}px by {img_height}px) contains the caption and may contain distractor text.\n"
        f"The second image is a reference for the caption style, without distractor text.\n"
        f"The caption anchor point is at pixel {anchor_pixel}, {justification}-justified, "
        f"height ~{text_height_pixels}px.\n"
        f"The OCR annotation lists [(character, confidence, bounding box: [x1, y1, x2, y2])] "
        f"for characters in the first image.\n"
        f"The OCR may include distractor text. OCR errors are usually visually similar to true characters.\n"
        f"\n"
        f"OCR annotation (JSON): {ocr_json}\n"
        f"\n"
        f"Output only the valid caption text from the first image.\n"
    )

    # Prepare conversation format
    images = [main_image, font_example_image]
    conversation = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": images[0]},
                {"type": "image", "image": images[1]},
                {"type": "text", "text": prompt},
            ],
        }
    ]

    # Apply chat template
    text = processor.apply_chat_template(conversation, tokenize=False, add_generation_prompt=True)

    # Process inputs
    inputs = processor(text=text, images=images, return_tensors="pt", padding=True)

    # Move to device
    device = next(model.parameters()).device
    for key, value in inputs.items():
        if isinstance(value, torch.Tensor):
            inputs[key] = value.to(device)

    # Generate response
    with torch.no_grad():
        generated_ids = model.generate(
            **inputs,
            max_new_tokens=512,
            do_sample=False,  # Deterministic
            temperature=0.1,
            pad_token_id=processor.tokenizer.eos_token_id,
        )

    # Decode response
    generated_ids_trimmed = [out_ids[len(in_ids) :] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)]
    response = processor.batch_decode(generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False)[
        0
    ]

    return response.strip()


def convert_ocr_bbox_to_absolute(bbox: list[float], img_width: int, img_height: int) -> list[int]:
    """Convert OCR bounding box from relative [x, y, width, height] to absolute [x1, y1, x2, y2].

    Args:
        bbox: [x, y, width, height] in relative coordinates [0-1]
        img_width: Image width in pixels
        img_height: Image height in pixels

    Returns:
        [x1, y1, x2, y2] in absolute pixel coordinates
    """
    x, y, width, height = bbox
    x1 = int(x * img_width)
    y1 = int(y * img_height)
    x2 = int((x + width) * img_width)
    y2 = int((y + height) * img_height)
    return [x1, y1, x2, y2]


def infer_caption_from_frames(
    checkpoint_path: Path,
    main_image_path: Path,
    font_example_path: Path,
    ocr_annotations: list[list[Any]],
    layout_config: dict[str, Any],
) -> str:
    """High-level function to infer caption text from frames.

    Args:
        checkpoint_path: Path to fine-tuned model checkpoint
        main_image_path: Path to cropped caption frame
        font_example_path: Path to font reference image
        ocr_annotations: OCR annotations [[char, conf, bbox], ...]
        layout_config: Layout configuration dictionary

    Returns:
        Generated caption text
    """
    # Load model
    model_dict = load_finetuned_model(checkpoint_path)

    # Load images
    main_image = Image.open(main_image_path)
    font_image = Image.open(font_example_path)

    # Generate caption
    caption = generate_caption(
        model_dict=model_dict,
        main_image=main_image,
        font_example_image=font_image,
        ocr_annotations=ocr_annotations,
        layout_config=layout_config,
    )

    return caption
