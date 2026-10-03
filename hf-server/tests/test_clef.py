"""Native CLEF formatting, scoring, HTTP, and loader integration."""
from types import SimpleNamespace
from unittest.mock import Mock
import threading

import httpx
import pytest
import torch

from common import ClassifierRequest
from hf_clef import ClefBackend, REVISIONS
from hf_server import DecisionService, create_app, load_service
from clef_native import encode_record, JointSchemaHead, ClefModel


class Tokenizer:
    pad_token_id = 0
    def __call__(self, text, **kwargs):
        return SimpleNamespace(input_ids=list(text.encode()))


def request():
    return ClassifierRequest.model_validate({'model': 'clef', 'state': 'The invoice is overdue.', 'questions': {
        'team': {'type': 'choice', 'instructions': 'Team?', 'criteria': {'z': 'Sales', 'a': 'Billing'}},
        'severity': {'type': 'score', 'instructions': 'Severity?', 'criteria': ['Low', 'High']},
        'urgent': {'type': 'noul', 'instructions': 'Urgent?'},
    }})


class Model(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.weight = torch.nn.Parameter(torch.zeros(1))
        self.calls = 0
    def forward(self, batch):
        self.calls += 1
        # Native Choice order is sorted (a,z); Noul is (true,false).
        return [[torch.tensor([2., 0.]), torch.tensor([0., 2.]), torch.tensor([2., 0.])]]


def backend(limit=16384):
    return ClefBackend(Model(), SimpleNamespace(tokenizer=Tokenizer()), limit)


@pytest.mark.parametrize('name', REVISIONS)
@pytest.mark.parametrize('route', ['/v1/classifier', '/v1/systemone'])
async def test_http_native_types_order_and_usage(name, route):
    b = backend()
    service = DecisionService(name, None, b, advanced_metrics=True)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(service)), base_url='http://test') as client:
        response = await client.post(route, json=request().model_dump(exclude_none=True))
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['model'] == name
    assert data['answers']['team']['choice'] == 'a'
    assert list(data['answers']['team']['probabilities']) == ['z', 'a']
    assert data['answers']['severity']['score'] == pytest.approx(.8808)
    assert data['answers']['urgent']['noul'] == pytest.approx(.8808)
    assert data['usage']['output_tokens'] == 0
    assert data['metadata']['format'] == 'clef-native'
    assert b.model.calls == 1


def test_no_silent_truncation_or_forward_on_overflow():
    b = backend(20)
    with pytest.raises(ValueError, match='not truncated'):
        b._classify(request(), threading.Event())
    assert b.model.calls == 0


def test_cancelled_request_does_not_forward():
    b = backend(); stop = threading.Event(); stop.set()
    import asyncio
    with pytest.raises(asyncio.CancelledError):
        b._classify(request(), stop)
    assert b.model.calls == 0


def test_chat_preserves_roles_and_inputs():
    b = backend()
    req = request().model_copy(update={'state': None, 'messages': None}).model_dump()
    req['messages'] = [{'role': 'user', 'content': 'Invoice'}, {'role': 'assistant', 'content': 'Overdue'}]
    req = ClassifierRequest.model_validate(req)
    original = req.model_dump()
    b._classify(req, threading.Event())
    assert req.model_dump() == original


@pytest.mark.parametrize('policy', ['baseline', 'shared_repeat_state'])
def test_rejects_prompt_policy_override(policy):
    with pytest.raises(ValueError, match='native schema head'):
        load_service('Cloudflare/clef', backend='clef', prompt_policy=policy)


@pytest.mark.parametrize('name', REVISIONS)
def test_loader_pins_release_and_loads_joint_head(name, monkeypatch, tmp_path):
    import clef_native
    import huggingface_hub
    for file in ['joint_head_config.json', 'joint_head.safetensors']:
        (tmp_path / file).touch()
    download = Mock(return_value=str(tmp_path))
    load = Mock(return_value=(Model(), SimpleNamespace(tokenizer=Tokenizer())))
    monkeypatch.setattr(huggingface_hub, 'snapshot_download', download)
    monkeypatch.setattr(clef_native, 'load_release_model', load)
    service = load_service(name, backend='clef', device='cpu', dtype='float32')
    assert download.call_args.kwargs['revision'] == REVISIONS[name]
    assert load.call_args.kwargs == {'device': 'cpu', 'dtype': torch.float32}
    assert isinstance(service.backend, ClefBackend)


def test_real_joint_head_forward():
    # Exercise native attention/routing and option spans, not only a response mock.
    torch.manual_seed(7)
    encoded = encode_record(Tokenizer(), request().model_dump())
    head = JointSchemaHead(hidden_size=16, width=16, routing_layers=1, layers=1, heads=2, feedforward=32).eval()
    ids = torch.tensor([encoded.input_ids])
    with torch.inference_mode():
        logits = head(torch.randn(1, ids.shape[1], 16), ids, torch.ones_like(ids), [encoded], torch.randn(256, 16))
    assert len(logits[0]) == 3
    assert all(v.shape == (2,) and torch.isfinite(v).all() for v in logits[0])

@pytest.mark.parametrize('name', REVISIONS)
@pytest.mark.parametrize('vision', [False, True])
async def test_release_processor_with_tiny_real_backbone(name, vision, tmp_path):
    """Optional cached release processors + real Qwen/head forward (not accuracy)."""
    from huggingface_hub import snapshot_download
    from transformers import AutoProcessor, AutoConfig, Qwen3_5ForConditionalGeneration
    from test_vision import tiny_model, payload
    try:
        path = snapshot_download(name, revision=REVISIONS[name], local_files_only=True, allow_patterns=['*.json', '*.jinja', 'joint_head.safetensors'])
    except Exception:
        pytest.skip('CLEF release metadata is not cached')
    processor = AutoProcessor.from_pretrained(path, local_files_only=True)
    native = AutoConfig.from_pretrained(path, local_files_only=True).to_dict()
    config = tiny_model('qwen3_5').config.to_dict()
    config['text_config']['vocab_size'] = native['text_config']['vocab_size']
    for key, value in native.items():
        if key.endswith('_token_id'):
            config[key] = value
    for key in ['patch_size', 'temporal_patch_size', 'spatial_merge_size']:
        config['vision_config'][key] = native['vision_config'][key]
    backbone = Qwen3_5ForConditionalGeneration(AutoConfig.for_model('qwen3_5', **{k: v for k, v in config.items() if k != 'model_type'})).eval()
    head = JointSchemaHead(hidden_size=32, width=16, routing_layers=1, layers=1, heads=2, feedforward=32).eval()
    if vision:
        b = ClefBackend(ClefModel(backbone, head).eval(), processor, 16384)
        service = DecisionService(name, None, b)
    else:
        import json
        from safetensors.torch import save_file
        backbone.save_pretrained(tmp_path)
        processor.save_pretrained(tmp_path)
        save_file(head.state_dict(), tmp_path / 'joint_head.safetensors')
        (tmp_path / 'joint_head_config.json').write_text(json.dumps(dict(
            hidden_size=32, width=16, routing_layers=1, layers=1, heads=2, feedforward=32)))
        service = load_service(str(tmp_path), backend='clef', device='cpu', dtype='float32', served_model_name=name)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(service)), base_url='http://test') as client:
        r = await client.post('/v1/classifier', json=payload() if vision else request().model_dump(exclude_none=True))
    assert r.status_code == 200, r.text
    assert len(r.json()['answers']) == 3
    assert r.json()['usage']['input_tokens'] > 0

@pytest.mark.parametrize('name', REVISIONS)
def test_reject_backbone_only_loading(name):
    with pytest.raises(ValueError, match='--backend clef'):
        load_service(name)


def test_nonfinite_logits_rejected():
    b = backend()
    b.model.forward = lambda batch: [[torch.tensor([float('nan'), 0.])]*3]
    with pytest.raises(ValueError, match='invalid option logits'):
        b._classify(request(), threading.Event())


@pytest.mark.parametrize('name', REVISIONS)
def test_released_head_weights_match_native_implementation(name):
    import json
    from pathlib import Path
    from huggingface_hub import snapshot_download
    from safetensors.torch import load_file
    try:
        path = Path(snapshot_download(name, revision=REVISIONS[name], local_files_only=True,
                                     allow_patterns=['joint_head_config.json', 'joint_head.safetensors']))
    except Exception:
        pytest.skip('Released CLEF head is not cached')
    head = JointSchemaHead(**json.loads((path / 'joint_head_config.json').read_text()))
    head.load_state_dict(load_file(path / 'joint_head.safetensors'), strict=True)
    assert all(torch.isfinite(value).all() for value in head.state_dict().values())
