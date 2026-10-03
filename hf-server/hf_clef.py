"""Native CLEF adapter: one backbone/head pass for the complete question schema."""
import asyncio
import threading
from pathlib import Path

REVISIONS = {
    'Cloudflare/clef': '2f3de3dd85f379784083b0814d997ab627200f0c',
    'Cloudflare/clef-flash': '17f0b0ad64efb65d273590632833508766b2aae6',
}


class ClefBackend:
    native_format = 'clef-native'
    usage_accounting = 'joint_schema_sequence_tokens'

    def __init__(self, model, processor, max_tokens, **resize):
        self.model, self.processor = model, processor
        self.max_tokens, self.resize = max_tokens, resize
        self._lock = threading.Lock()

    async def classify_native(self, request):
        stop = threading.Event()
        try:
            return await asyncio.to_thread(self._classify, request, stop)
        except asyncio.CancelledError:
            stop.set()
            raise

    def _classify(self, request, stop):
        import torch
        from clef_native import encode_record, collate_records, systemone_answer
        from hf_vision import image_messages, image_resize_bounds
        with self._lock:
            if stop.is_set():
                raise asyncio.CancelledError()
            if request.tools or request.mm_processor_kwargs:
                raise ValueError('CLEF does not support tools or mm_processor_kwargs')
            if request.options.raw_logits:
                raise ValueError('CLEF raw_logits diagnostics are not supported')
            bounds = image_resize_bounds(request.media_io_kwargs, **self.resize)
            record = {'model': request.model, 'state': request.state,
                      'questions': {key: q.model_dump() for key, q in request.questions.items()}}
            if request.messages is not None:
                if any(m.role not in {'system', 'user', 'assistant'} or m.model_extra for m in request.messages):
                    raise ValueError('CLEF accepts system/user/assistant text and image messages only')
                turns, images = image_messages([m.model_dump(exclude_none=True) for m in request.messages],
                                                max_image_width=bounds[0], max_image_height=bounds[1])
                # CLEF's native context is a state, not an autoregressive conversation.
                # Preserve role/order as evidence and reference images in encounter order.
                image_index = 0
                for turn in turns:
                    if isinstance(turn['content'], list):
                        for block in turn['content']:
                            if block['type'] == 'image':
                                image_index += 1
                                block['image_index'] = image_index
                record['state'] = turns
                if images:
                    record['images'] = images
            # Upstream encode_record truncates state. Encode without that cap,
            # then enforce the complete sequence limit before any model forward.
            encoded = encode_record(self.processor.tokenizer, record,
                                    max_length=2**63 - 1, processor=self.processor)
            if len(encoded.input_ids) > self.max_tokens:
                raise ValueError(f'CLEF request exceeds {self.max_tokens} input tokens; context was not truncated')
            if stop.is_set():
                raise asyncio.CancelledError()
            device = next(self.model.parameters()).device
            with torch.inference_mode():
                logits = self.model(collate_records([encoded], self.processor.tokenizer.pad_token_id, device))[0]
            if stop.is_set():
                raise asyncio.CancelledError()
            if len(logits) != len(encoded.questions):
                raise ValueError('CLEF returned incomplete question logits')
            answers = {}
            for question, values in zip(encoded.questions, logits):
                if values.ndim != 1 or len(values) != len(question.option_ids) or not torch.isfinite(values).all():
                    raise ValueError('CLEF returned invalid option logits')
                probabilities = dict(zip(question.option_ids, values.float().softmax(-1).tolist()))
                answers[question.question_id] = systemone_answer(record['questions'][question.question_id], probabilities)
            return {'model': request.model, 'answers': answers,
                    'usage': {'input_tokens': len(encoded.input_ids), 'output_tokens': 0}}


def load_clef(model_name, *, revision, device, dtype, max_tokens, **resize):
    import torch
    from huggingface_hub import snapshot_download
    from clef_native import load_release_model
    if max_tokens < 1 or max_tokens > 65536:
        raise ValueError('CLEF max_model_len must be between 1 and 65536')
    resolved_revision = revision or REVISIONS.get(model_name)
    path = model_name
    if not Path(path).is_dir():
        if model_name not in REVISIONS:
            raise ValueError('CLEF requires Cloudflare/clef, Cloudflare/clef-flash, or a local release directory')
        path = snapshot_download(model_name, revision=resolved_revision,
                                 allow_patterns=['*.json', '*.jinja', '*.safetensors'])
    for name in ('joint_head_config.json', 'joint_head.safetensors'):
        if not (Path(path) / name).is_file():
            raise ValueError(f'CLEF release is missing {name}')
    if device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model, processor = load_release_model(path, device=device, dtype=getattr(torch, dtype))
    return ClefBackend(model, processor, max_tokens, **resize), resolved_revision
