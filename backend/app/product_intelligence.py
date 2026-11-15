"""Evidence-aware visual product intelligence built on Oracle's local vision stack."""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Literal

import cv2
import numpy as np
import httpx
import zxingcpp
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from .tls import verified_tls
from .reading import decode_image

logger = logging.getLogger(__name__)

Status = Literal['verified', 'probable', 'uncertain', 'unknown', 'conflicting']


# A synthetic fixture ships with the offline catalog for repeatable setup checks.
SEED_RECORDS = [
    {'id': 'oracle-demo', 'barcode': '00012345678905', 'brand': 'Oracle Demo',
     'name': 'Lemon Sparkling Water', 'variant': 'Lemon', 'capacity': '330 mL',
     'verification_status': 'verified'},
]


def normalize_gtin(value: str) -> str | None:
    if not re.fullmatch(r'[0-9]{8}|[0-9]{12,14}', value):
        return None
    checksum = sum(int(digit) * (3 if index % 2 == 0 else 1)
                   for index, digit in enumerate(reversed(value[:-1])))
    return value.zfill(14) if (checksum + int(value[-1])) % 10 == 0 else None


class Evidence(BaseModel):
    kind: Literal['object_detection', 'ocr', 'barcode', 'logo', 'vlm', 'catalog']
    value: str = Field(min_length=1, max_length=400)
    confidence: float = Field(ge=0, le=1)
    source: str = Field(default='local', max_length=200)
    bounds: tuple[float, float, float, float] | None = None
    angle: int = 0


class ProductIdentity(BaseModel):
    name: str | None = None
    variant: str | None = None
    model: str | None = None
    barcode: str | None = None


class RecognitionResult(BaseModel):
    object_id: str
    object_type: str | None = None
    object_confidence: float = 0
    brand: dict[str, Any] = Field(default_factory=lambda: {'name': None, 'status': 'unknown', 'confidence': 0, 'evidence': []})
    product: ProductIdentity = Field(default_factory=ProductIdentity)
    product_status: Status = 'unknown'
    attributes: dict[str, Any] = Field(default_factory=dict)
    knowledge: dict[str, Any] = Field(default_factory=lambda: {'source_type': None, 'source_url': None, 'verified': False})
    evidence: list[Evidence] = Field(default_factory=list)
    candidates: list[dict[str, Any]] = Field(default_factory=list)
    needs_more_evidence: bool = True
    latency_ms: float = 0


@dataclass
class ProductKnowledgeService:
    engine: Any = None
    online_cache: dict[str, tuple[float, list[dict[str, Any]]]] = field(default_factory=dict)

    def ensure_schema(self) -> None:
        if self.engine is None:
            return
        with self.engine.begin() as connection:
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS product_records (
                    id VARCHAR(100) PRIMARY KEY,
                    barcode VARCHAR(80),
                    brand VARCHAR(200),
                    name VARCHAR(300) NOT NULL,
                    variant VARCHAR(300),
                    category VARCHAR(120),
                    manufacturer VARCHAR(200),
                    model VARCHAR(200),
                    packaging VARCHAR(200),
                    capacity VARCHAR(100),
                    specifications TEXT NOT NULL,
                    source_url TEXT,
                    verification_status VARCHAR(30) NOT NULL,
                    updated BIGINT NOT NULL
                )
            """))
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS product_lookup_history (
                    id VARCHAR(100) PRIMARY KEY,
                    query TEXT NOT NULL,
                    result TEXT NOT NULL,
                    created BIGINT NOT NULL
                )
            """))

    def lookup(self, *, barcode: str | None = None, terms: list[str] | None = None) -> list[dict[str, Any]]:
        return self.find_records([barcode] if barcode else [], [' '.join(terms or [])])

    def find_records(self, barcodes: list[str], terms: list[str]) -> list[dict[str, Any]]:
        queries = {term.strip().casefold() for term in terms if term.strip()}
        normalized = {code for value in barcodes if (code := normalize_gtin(value))}
        if not normalized and not queries:
            return []
        rows = []
        if self.engine is not None:
            self.ensure_schema()
            with self.engine.connect() as connection:
                rows = [dict(row) for row in connection.execute(text(
                    "SELECT * FROM product_records"
                )).mappings()]
        return [
            row for row in [*rows, *SEED_RECORDS]
            if normalize_gtin(row.get('barcode') or '') in normalized
            or any(query in ' '.join(str(row.get(key) or '')
                for key in ('brand', 'name', 'variant', 'capacity')).casefold() for query in queries)
            or _brand_on_label(row.get('brand'), queries)
        ]

    async def lookup_open_food_facts(self, barcode: str) -> list[dict[str, Any]]:
        cache_key = normalize_gtin(barcode)
        if not cache_key:
            return []
        cached = self.online_cache.get(cache_key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        try:
            async with httpx.AsyncClient(timeout=6, follow_redirects=False, verify=verified_tls()) as client:
                response = await client.get(f'https://world.openfoodfacts.org/api/v2/product/{barcode}.json',
                                            headers={'User-Agent': 'Oracle-local-product-intelligence/1.0'})
            if response.status_code != 200:
                return []
            data = response.json()
            product = data.get('product') or {}
            if data.get('status') != 1 or not product.get('product_name'):
                return []
            records = [{
                'id': f'openfoodfacts:{barcode}', 'barcode': barcode,
                'brand': product.get('brands'), 'name': product.get('product_name'),
                'variant': None, 'category': product.get('categories'),
                'manufacturer': None, 'model': None, 'packaging': product.get('packaging'),
                'capacity': product.get('quantity'), 'specifications': json.dumps({
                    'ingredients': product.get('ingredients_text'),
                    'nutriscore': product.get('nutriscore_grade'),
                }), 'source_url': f'https://world.openfoodfacts.org/product/{barcode}',
                'verification_status': 'probable',
            }]
            if len(self.online_cache) >= 128:
                self.online_cache.pop(next(iter(self.online_cache)))
            self.online_cache[cache_key] = (time.monotonic() + 3600, records)
            return records
        except (httpx.HTTPError, ValueError, TypeError):
            return []


def _tokens(value: str) -> set[str]:
    return {token for token in re.findall(r'[\w-]{2,}', value.casefold())}


def _brand_on_label(brand: str | None, lines: Iterable[str]) -> bool:
    brand_words = re.findall(r'\w+', (brand or '').casefold())
    if not brand_words:
        return False
    pattern = r'(?<!\w)' + r'[^\w]+'.join(map(re.escape, brand_words)) + r'(?!\w)'
    return any(re.search(pattern, line.casefold()) for line in lines)


def rank_candidates(evidence: list[Evidence], records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rank only evidence-supported records; never invent an exact product."""
    barcode_values = {code for item in evidence if item.kind == 'barcode'
                      if (code := normalize_gtin(item.value))}
    ocr_tokens = set().union(*(_tokens(item.value) for item in evidence if item.kind == 'ocr'))
    ranked = []
    for record in records:
        score = 0.0
        matched: list[str] = []
        if record.get('barcode') and normalize_gtin(record['barcode']) in barcode_values:
            score += 1.0
            matched.append('barcode')
        record_tokens = _tokens(' '.join(str(record.get(key) or '') for key in ('brand', 'name', 'variant', 'model')))
        overlap = ocr_tokens & record_tokens
        if overlap:
            score += min(0.65, 0.15 * len(overlap))
            matched.append('ocr:' + ','.join(sorted(overlap)))
        if score:
            ranked.append({'record': record, 'score': round(min(score, 1), 3), 'matched': matched})
    return sorted(ranked, key=lambda item: item['score'], reverse=True)


def _extract_evidence(picture, detections: list[dict[str, Any]]) -> list[Evidence]:
    evidence = [
        Evidence(kind='object_detection', value=str(item['class']), confidence=float(item['confidence']))
        for item in detections[:10] if not item.get('ambiguous')
    ]
    pixels = cv2.cvtColor(np.asarray(picture), cv2.COLOR_RGB2BGR)
    regions = [(pixels, 0, 0, 1.0, 1.0)]
    height, width = pixels.shape[:2]

    def bounds(points, left, top, scale_x, scale_y):
        xs, ys = zip(*points)
        return (
            (left + min(xs) / scale_x) / width, (top + min(ys) / scale_y) / height,
            (max(xs) - min(xs)) / scale_x / width, (max(ys) - min(ys)) / scale_y / height,
        )
    for detection in detections[:8]:
        try:
            x, y, w, h = (int(value) for value in detection['box'])
            padding_x, padding_y = max(4, int(w * .12)), max(4, int(h * .12))
            left, top = max(0, x - padding_x), max(0, y - padding_y)
            right, bottom = min(width, x + w + padding_x), min(height, y + h + padding_y)
            if right - left >= 24 and bottom - top >= 24:
                crop = pixels[top:bottom, left:right]
                # Small labels are commonly unreadable at the detector crop's
                # native size; upscale without changing the source evidence.
                if crop.shape[1] < 900:
                    scale = min(3.0, 900 / crop.shape[1])
                    crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
                regions.insert(0, (crop, left, top, crop.shape[1] / (right - left), crop.shape[0] / (bottom - top)))
        except (KeyError, TypeError, ValueError):
            continue
    try:
        from rapidocr_onnxruntime import RapidOCR
        ocr = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1, print_verbose=False)
        seen_text: set[str] = set()
        for region, left, top, scale_x, scale_y in regions[:9]:
            lines, _ = ocr(region)
            for line in (lines or [])[:20]:
                text_value, confidence = str(line[1]).strip(), float(line[2])
                key = text_value.casefold()
                if text_value and key not in seen_text:
                    seen_text.add(key)
                    evidence.append(Evidence(kind='ocr', value=text_value[:400],
                                             confidence=max(0, min(1, confidence)),
                                             source='local_frame' if region is pixels else 'local_crop',
                                             bounds=bounds(line[0], left, top, scale_x, scale_y)))
    except Exception:
        pass
    formats = (zxingcpp.BarcodeFormat.EAN8, zxingcpp.BarcodeFormat.EAN13,
               zxingcpp.BarcodeFormat.UPCA, zxingcpp.BarcodeFormat.ITF)
    seen_codes: set[str] = set()
    for region, left, top, scale_x, scale_y in regions:
        for barcode in zxingcpp.read_barcodes(region, formats=formats):
            code = normalize_gtin(barcode.text)
            if code and code not in seen_codes:
                seen_codes.add(code)
                position = barcode.position
                points = [(point.x, point.y) for point in
                          (position.top_left, position.top_right, position.bottom_right, position.bottom_left)]
                evidence.append(Evidence(kind='barcode', value=barcode.text, confidence=.98, source='zxing',
                                         bounds=bounds(points, left, top, scale_x, scale_y)))
    return evidence


def resolve_product(evidence: list[Evidence], records: list[dict[str, Any]]) -> RecognitionResult:
    detections = [item for item in evidence if item.kind == 'object_detection']
    product_detections = [
        item for item in detections
        if item.value.casefold() not in {'person', 'people', 'face'}
    ]
    if product_detections:
        detections = product_detections
    object_item = max(detections, key=lambda item: item.confidence, default=None)
    visible_text = [item.value for item in evidence if item.kind == 'ocr']
    visual_summaries = [item.value for item in evidence if item.kind == 'vlm']
    object_type = object_item.value if object_item else None
    observable_attributes: dict[str, Any] = {}
    if object_type:
        observable_attributes['category'] = object_type
        if object_type.casefold() in {'bottle', 'wine glass', 'cup'}:
            observable_attributes['packaging'] = 'bottle' if object_type.casefold() == 'bottle' else object_type
    if visible_text:
        observable_attributes['visible_text'] = visible_text
    if visual_summaries:
        observable_attributes['visual_summary'] = visual_summaries[-1]
    ranked = rank_candidates(evidence, records)
    top = ranked[0] if ranked else None
    second = ranked[1] if len(ranked) > 1 else None
    conflicting = bool(top and second and top['score'] >= .65 and top['score'] - second['score'] < .12)
    barcodes = {item.value for item in evidence if item.kind == 'barcode' and normalize_gtin(item.value)}
    reliable_text = [item.value for item in evidence if item.kind == 'ocr' and item.confidence >= .65]
    brands = {
        record['brand'].casefold(): record['brand']
        for record in records if _brand_on_label(record.get('brand'), reliable_text)
    }
    conflicting = conflicting or len({normalize_gtin(code) for code in barcodes}) > 1
    if top and 'barcode' in top['matched'] and brands:
        conflicting = conflicting or any(
            brand != (top['record'].get('brand') or '').casefold() for brand in brands
        )
    if top and top['score'] >= .95 and not conflicting:
        record = top['record']
        status: Status = 'verified' if record.get('verification_status') == 'verified' else 'probable'
        return RecognitionResult(
            object_id=str(uuid.uuid4()), object_type=object_item.value if object_item else record.get('category'),
            object_confidence=object_item.confidence if object_item else 0,
            brand={'name': record.get('brand'), 'status': status, 'confidence': top['score'],
                   'evidence': top['matched']},
            product=ProductIdentity(name=record.get('name'), variant=record.get('variant'),
                                    model=record.get('model'), barcode=record.get('barcode')),
            product_status=status, attributes={**observable_attributes, 'category': record.get('category'),
                                              'packaging': record.get('packaging') or observable_attributes.get('packaging'),
                                              'capacity': record.get('capacity'), 'specifications': record.get('specifications')},
            knowledge={'source_type': 'local_catalog', 'source_url': record.get('source_url'),
                       'verified': status == 'verified'},
            evidence=evidence, candidates=ranked[:5], needs_more_evidence=status != 'verified')
    return RecognitionResult(
        object_id=str(uuid.uuid4()),         object_type=object_type,
        object_confidence=object_item.confidence if object_item else 0,
        brand={'name': next(iter(brands.values())), 'status': 'probable', 'evidence': reliable_text} if len(brands) == 1 else
              {'name': None, 'status': 'unknown', 'evidence': []},
        product=ProductIdentity(barcode=min(barcodes) if barcodes and not conflicting else None),
        product_status='conflicting' if conflicting else ('uncertain' if evidence else 'unknown'),
        attributes=observable_attributes, evidence=evidence, candidates=ranked[:5], needs_more_evidence=True)


def product_router(detector, ollama=None, knowledge=None, everyday=None):
    router = APIRouter(prefix='/api/v1/vision/products')
    service = knowledge or ProductKnowledgeService()
    everyday = everyday

    @router.get('/capabilities')
    def capabilities():
        return {'offline_detection': detector is not None, 'ocr': True, 'retail_barcode': True, 'local_catalog': True,
                'online_enrichment': True, 'vlm': ollama is not None}

    @router.post('/inspect')
    async def inspect(request: Request):
        content_type = request.headers.get('content-type', '').split(';')[0]
        previous = None
        if content_type == 'multipart/form-data':
            async with request.form(max_files=2, max_fields=0) as form:
                first, current = form.get('first'), form.get('current')
                if any(not isinstance(image, UploadFile) or image.content_type not in {'image/png', 'image/jpeg'}
                       for image in (first, current)):
                    raise HTTPException(415, 'Send two PNG or JPEG images')
                previous = await first.read(6_000_001)
                payload = await current.read(6_000_001)
        elif content_type in {'image/png', 'image/jpeg'}:
            payload = await request.body()
        else:
            raise HTTPException(415, 'Send a still PNG or JPEG image')
        if len(payload) > 6_000_000 or (previous is not None and len(previous) > 6_000_000):
            raise HTTPException(413, 'Each image must be 6 MB or smaller')
        inspection_mode = request.headers.get('x-oracle-product-mode', 'angle').strip().lower()
        if inspection_mode not in {'angle', 'barcode', 'auto'}:
            inspection_mode = 'angle'
        picture = decode_image(payload)
        started = time.perf_counter()
        try:
            detected = (await run_in_threadpool(detector.detect, picture, .25, include_masks=False)
                        if detector is not None and inspection_mode != 'barcode' else {})
        except Exception:
            logger.warning('Object detection unavailable during product scan', exc_info=True)
            detected = {}
        detections = detected.get('detections', [])
        if everyday is not None and everyday.available:
            try:
                detected = await run_in_threadpool(everyday.detect, picture, [], .25, True)
                detections = detected.get('detections', detections)
            except Exception:
                pass
        evidence = await run_in_threadpool(_extract_evidence, picture, detections)
        if previous is not None:
            first_evidence = await run_in_threadpool(_extract_evidence, decode_image(previous), [])
            evidence = first_evidence + [item.model_copy(update={'angle': 1}) for item in evidence]
        barcodes = [item.value for item in evidence if item.kind == 'barcode']
        label_text = [item.value for item in evidence
                      if item.kind == 'ocr' and item.confidence >= .65 and len(item.value.strip()) >= 3]
        try:
            records = await run_in_threadpool(service.find_records, barcodes, label_text)
        except Exception:
            logger.exception('Local product catalog lookup failed')
            records = []
        result = resolve_product(evidence, records)
        needs_visual_hint = inspection_mode != 'barcode' and not (result.product.name or barcodes or label_text)
        if ollama is not None and needs_visual_hint:
            try:
                visual_summary = await ollama.analyze_image(
                    payload,
                    'List only visually observable object type, brand text, packaging, color, and model text. '
                    'Use unknown when not visible. Do not guess exact products or numbers.'
                )
                if visual_summary.strip():
                    evidence.append(Evidence(kind='vlm', value=visual_summary[:400], confidence=.55,
                                             source=getattr(ollama, 'vision_model', 'local vision model')))
                    result = resolve_product(evidence, records)
            except Exception as error:
                logger.exception('Optional visual-language enrichment failed')
                if inspection_mode == 'angle':
                    result.attributes['visual_error'] = str(error)[:240] or 'The vision model could not describe this image.'
        elif needs_visual_hint and inspection_mode == 'angle':
            result.attributes['visual_error'] = 'Local vision model is not enabled.'
        result.latency_ms = round((time.perf_counter() - started) * 1000, 2)
        return result.model_dump()

    @router.post('/lookup')
    async def lookup(request: Request):
        body = await request.json()
        barcode = str(body.get('barcode') or '').strip() or None
        terms = body.get('terms') if isinstance(body.get('terms'), list) else []
        results = service.lookup(barcode=barcode, terms=[str(item) for item in terms])
        if not results and body.get('online') is True and barcode:
            results = await service.lookup_open_food_facts(barcode)
        return {'source': 'local_catalog' if results and not results[0]['id'].startswith('openfoodfacts:') else ('open_food_facts' if results else None),
                'results': results}

    return router
